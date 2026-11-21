"""Copy and move files between storages (SPEC-storage §9, X2).

A transfer is a list of files (by the key the listing gives them) going to one
storage: a folder or an FTP, SFTP or SMB server. One runs at a time, in a
background thread; each file is written under a temporary name, checked by size,
then renamed. A move deletes the original only after its copy checked out, and
carries the file's recorded metadata (and its sidecar subtitles) along.
"""

from __future__ import annotations

import itertools
import logging
import secrets
import shutil
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from sestudio import downloaded, library, remotefs, storage

logger = logging.getLogger(__name__)

CHUNK = 1024 * 1024
MODES = ("copy", "move")
ON_CONFLICT = ("skip", "replace", "keep_both")


class Invalid(ValueError):
    pass


@dataclass
class Item:
    source: str  # the listing's key
    dest: str  # path inside the destination storage
    size: int
    status: str = "waiting"  # waiting | done | skipped | failed
    error: str = ""


@dataclass
class Transfer:
    id: str
    mode: str
    to: str
    to_label: str
    label: str
    on_conflict: str
    items: list[Item]
    total_bytes: int
    done_bytes: int = 0
    status: str = "queued"  # queued | running | paused | done | failed | cancelled
    started: float = 0.0
    finished: float = 0.0
    created: float = field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        out = asdict(self)
        out["counts"] = {
            s: sum(i.status == s for i in self.items)
            for s in ("done", "skipped", "failed")
        }
        elapsed = (self.finished or time.time()) - self.started if self.started else 0
        out["bytes_per_second"] = int(self.done_bytes / elapsed) if elapsed > 0 else 0
        return out


_lock = threading.Lock()
_wake = threading.Condition(_lock)
_jobs: dict[str, Transfer] = {}
_worker: threading.Thread | None = None


# --- reading and writing any storage --------------------------------------------


def _split(key: str) -> tuple[str, str]:
    head, colon, rest = key.partition(":")
    if (
        colon
        and head != storage.LOCAL
        and any(s["id"] == head for s in storage.all_storages())
    ):
        return head, rest
    return storage.LOCAL, key


def _opener(s: dict[str, Any], rel: str) -> Any:
    """Something with ``open``, ``stat``, ``unlink`` for a file of storage *s*."""
    if s["kind"] == storage.FOLDER:
        return downloaded.resolve(s["path"], rel)
    if s["kind"] in storage.NETWORK:
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        if not parts or ".." in parts:
            raise Invalid("Path outside the storage")
        return remotefs.top(s).joinpath(*parts)
    raise Invalid(f"Files cannot be written to or read from {s['label']} here")


def _free(s: dict[str, Any]) -> int | None:
    if s["kind"] != storage.FOLDER:
        return None  # a server says nothing portable about its room
    try:
        return shutil.disk_usage(s["path"]).free
    except OSError:
        return None


def _exists(target: Any) -> bool:
    try:
        return target.exists()
    except OSError:
        return False


def _beside(target: Any) -> Any:
    """``name (2).ext``, ``name (3).ext``…: the first that is free, for Keep both."""
    for n in itertools.count(2):
        other = target.with_name(f"{target.stem} ({n}){target.suffix}")
        if not _exists(other):
            return other
    raise AssertionError  # unreachable


def _mkdirs(target: Any) -> None:
    if isinstance(target, remotefs.RemoteFile):
        target.fs.makedirs(str(target.parent), exist_ok=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)


def _rename(tmp: Any, target: Any) -> None:
    if isinstance(target, remotefs.RemoteFile):
        if _exists(target):
            target.unlink()
        target.fs.mv(str(tmp), str(target))
    else:
        tmp.replace(target)


def _sidecars(source: Any) -> list[Any]:
    try:
        return [c for _lang, c in downloaded.sidecar_subtitles(source)]
    except Exception:  # noqa: BLE001 - a listing that fails costs only the subtitles
        return []


# --- planning -------------------------------------------------------------------


def create(
    keys: list[str],
    to: str,
    mode: str,
    on_conflict: str = "skip",
    folder: str | None = None,
    label: str = "",
) -> Transfer:
    """Plan a transfer and queue it. *folder*, when given, is where the files land
    in the destination (each keeps its name); otherwise each keeps its path."""
    if mode not in MODES:
        raise Invalid("Copy or move")
    if on_conflict not in ON_CONFLICT:
        raise Invalid("Skip, replace or keep both")
    if not keys:
        raise Invalid("Nothing to copy")
    dest = storage.get(to)
    if dest["kind"] not in (storage.FOLDER, *storage.NETWORK):
        raise Invalid(f"Files cannot be written to {dest['label']}")
    if not storage.online(dest):
        raise Invalid(f"{dest['label']} is offline")
    items: list[Item] = []
    for key in dict.fromkeys(keys):
        sid, rel = _split(key)
        src = storage.get(sid)
        if sid == to:
            raise Invalid(f"Already on {dest['label']}")
        if src["kind"] == storage.REMOTE:
            raise Invalid("Files on another sestudio are read only here")
        if not storage.online(src):
            raise Invalid(f"{src['label']} is offline")
        source = _opener(src, rel)
        size = source.stat().st_size
        name = PurePosixPath(rel).name
        if folder is None:
            dest_rel = rel  # the same place it has where it is
        else:
            dest_rel = f"{folder.strip('/')}/{name}".lstrip("/")
        items.append(Item(key, dest_rel, size))
    total = sum(i.size for i in items)
    free = _free(dest)
    if free is not None and free < total:
        raise Invalid(
            f"Not enough room on {dest['label']}: needs {total / 1e9:.1f} GB, "
            f"{free / 1e9:.1f} GB free"
        )
    job = Transfer(
        id=secrets.token_hex(4), mode=mode, to=to, to_label=dest["label"],
        label=label or (PurePosixPath(items[0].dest).name if len(items) == 1 else f"{len(items)} files"),
        on_conflict=on_conflict, items=items, total_bytes=total,
    )  # fmt: skip
    with _wake:
        _jobs[job.id] = job
        _start_worker()
        _wake.notify_all()
    return job


def all_jobs() -> list[dict[str, Any]]:
    with _lock:
        return [
            j.public()
            for j in sorted(_jobs.values(), key=lambda j: j.created, reverse=True)
        ]


def control(job_id: str, action: str) -> dict[str, Any]:
    with _wake:
        job = _jobs.get(job_id)
        if job is None:
            raise Invalid("No such transfer")
        if action == "pause" and job.status in ("queued", "running"):
            job.status = "paused"
        elif action == "resume" and job.status == "paused":
            job.status = "running" if job.started else "queued"
        elif action == "cancel" and job.status in ("queued", "running", "paused"):
            job.status = "cancelled"
            job.finished = time.time()
        elif action == "clear" and job.status in ("done", "failed", "cancelled"):
            del _jobs[job_id]
            return {"ok": True}
        _wake.notify_all()
        return job.public()


# --- running --------------------------------------------------------------------


def _start_worker() -> None:
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_run, daemon=True, name="transfers")
        _worker.start()


def _next() -> Transfer | None:
    for job in sorted(_jobs.values(), key=lambda j: j.created):
        if job.status in ("queued", "running"):
            return job
    return None


def _run() -> None:
    while True:
        with _wake:
            job = _next()
            while job is None:
                _wake.wait(timeout=30)
                job = _next()
            if not job.started:
                job.started = time.time()
            job.status = "running"
        _run_job(job)


def _halted(job: Transfer) -> bool:
    """Waits out a pause; True when the job was cancelled."""
    with _wake:
        while job.status == "paused":
            _wake.wait(timeout=1)
        return job.status == "cancelled"


def _copy_one(job: Transfer, source: Any, target: Any) -> bool:
    """Copy *source* to *target* under a temporary name, checked by size. False
    when cancelled midway (the temporary file is removed)."""
    _mkdirs(target)
    tmp = target.with_name(f".{target.name}.{job.id}.part")
    expected = source.stat().st_size
    with source.open("rb") as src, tmp.open("wb") as out:
        while chunk := src.read(CHUNK):
            if _halted(job):
                out.close()
                tmp.unlink(missing_ok=True)
                return False
            out.write(chunk)
            with _lock:
                job.done_bytes += len(chunk)
    written = (
        tmp.stat().st_size
        if not isinstance(tmp, remotefs.RemoteFile)
        else (tmp.fs.info(str(tmp)).get("size"))
    )
    if written != expected:
        tmp.unlink(missing_ok=True)
        raise OSError(f"copy came out {written} bytes, the original is {expected}")
    _rename(tmp, target)
    return True


def _run_job(job: Transfer) -> None:
    dest = storage.get(job.to)
    for item in job.items:
        if item.status != "waiting":
            continue
        if _halted(job):
            break
        try:
            sid, rel = _split(item.source)
            src = storage.get(sid)
            source = _opener(src, rel)
            target = _opener(dest, item.dest)
            if _exists(target):
                if job.on_conflict == "skip":
                    item.status, item.error = "skipped", "already there"
                    with _lock:
                        job.done_bytes += item.size
                    continue
                if job.on_conflict == "keep_both":
                    target = _beside(target)
            if not _copy_one(job, source, target):
                break
            for sidecar in _sidecars(source):
                twin = target.with_name(target.stem + sidecar.name[len(source.stem) :])
                if not _exists(twin):
                    _copy_one(job, sidecar, twin)
            new_key = _key(job.to, _relative(dest, target))
            meta = library.downloaded_files().get(item.source)
            if meta:
                library.set_downloaded_file(new_key, meta)
            if job.mode == "move":
                for sidecar in _sidecars(source):
                    sidecar.unlink(missing_ok=True)
                source.unlink()
                if meta:
                    library.delete_downloaded_file(item.source)
            item.status = "done"
        except Exception as exc:  # noqa: BLE001 - one file failing does not stop the rest
            logger.warning("Transfer %s: %s failed: %s", job.id, item.source, exc)
            item.status, item.error = "failed", str(exc) or type(exc).__name__
    with _wake:
        if job.status != "cancelled":
            job.status = (
                "failed" if any(i.status == "failed" for i in job.items) else "done"
            )
        job.finished = time.time()
    downloaded.invalidate()


def _relative(s: dict[str, Any], target: Any) -> str:
    if isinstance(target, remotefs.RemoteFile):
        return target.relative()
    return Path(target).resolve().relative_to(Path(s["path"]).resolve()).as_posix()


def _key(storage_id: str, rel: str) -> str:
    return rel if storage_id == storage.LOCAL else f"{storage_id}:{rel}"
