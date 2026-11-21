"""FTP, SFTP and SMB storages, read in the app (SPEC-storage §9, X1).

One fsspec filesystem per storage, made from its fields and its password in the
vault. Everything that touches the network goes through here, so a test swaps
``filesystem`` for an in-memory one.
"""

from __future__ import annotations

import posixpath
from pathlib import PurePosixPath
from urllib.parse import quote
import threading
from typing import Any

import fsspec

from sestudio import vault

FTP, SFTP, SMB = "ftp", "sftp", "smb"
KINDS = (FTP, SFTP, SMB)
DEFAULT_PORT = {FTP: 21, SFTP: 22, SMB: 445}
#: Connection timeout, seconds: a server that is off must not hold a request.
TIMEOUT = 5.0

_lock = threading.Lock()
_cache: dict[str, tuple[tuple, Any]] = {}


def root(s: dict[str, Any]) -> str:
    """The storage's top folder, as its filesystem names it."""
    path = "/" + str(s.get("path", "")).strip("/")
    if s["kind"] == SMB:
        return posixpath.join(f"/{s['share']}", path.lstrip("/")).rstrip("/") or "/"
    return path


def _open(s: dict[str, Any], secret: str | None = None) -> Any:
    secret = (
        secret if secret is not None else vault.get(s["id"]).get("password") or None
    )
    host, port, user = (
        s["host"],
        int(s.get("port") or DEFAULT_PORT[s["kind"]]),
        s.get("username") or None,
    )
    if s["kind"] == FTP:
        return fsspec.filesystem(
            "ftp", host=host, port=port, username=user or "anonymous",
            password=secret or "", tls=bool(s.get("tls")), timeout=TIMEOUT,
            skip_instance_cache=True,
        )  # fmt: skip
    if s["kind"] == SFTP:
        return fsspec.filesystem(
            "sftp", host=host, port=port, username=user, password=secret,
            timeout=TIMEOUT, skip_instance_cache=True,
        )  # fmt: skip
    return fsspec.filesystem(
        "smb", host=host, port=port, username=user, password=secret,
        timeout=TIMEOUT, skip_instance_cache=True,
    )  # fmt: skip


def filesystem(s: dict[str, Any]) -> Any:
    """The storage's filesystem, opened once and kept while its settings hold."""
    key = (s["kind"], s["host"], s.get("port"), s.get("username"), s.get("share"),
           s.get("tls"), vault.get(s["id"]).get("password"))  # fmt: skip
    with _lock:
        hit = _cache.get(s["id"])
        if hit and hit[0] == key:
            return hit[1]
    fs = _open(s)
    with _lock:
        _cache[s["id"]] = (key, fs)
    return fs


def forget(storage_id: str) -> None:
    with _lock:
        _cache.pop(storage_id, None)


def check(s: dict[str, Any]) -> dict[str, Any]:
    """Connect and list the top folder: what the add form says before adding."""
    fs = filesystem(s)
    entries = fs.ls(root(s), detail=True)
    return {"folders": sum(1 for e in entries if e.get("type") == "directory")}


def check_with(s: dict[str, Any], password: str) -> dict[str, Any]:
    """``check`` for a server not added yet: its password is not in the vault."""
    fs = _open(s, password or None)
    entries = fs.ls(root(s), detail=True)
    return {"folders": sum(1 for e in entries if e.get("type") == "directory")}


# --- a file on a server, as the media code sees it ------------------------------

#: This server's own address for the relay (``/api/storages/{id}/raw/...``), set
#: when it starts serving: ffmpeg reads a remote file there (spec §9.1).
RELAY = "http://127.0.0.1:8080"


def _mtime(info: dict[str, Any]) -> float:
    """A listing entry's modification time: each protocol words it its own way."""
    for key in ("mtime", "modified", "LastModified"):
        value = info.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if hasattr(value, "timestamp"):
            return float(value.timestamp())
    modify = str(info.get("modify") or "")  # FTP's MLSD: YYYYMMDDHHMMSS
    if len(modify) >= 14 and modify[:14].isdigit():
        import calendar
        import time

        return float(calendar.timegm(time.strptime(modify[:14], "%Y%m%d%H%M%S")))
    return 0.0


class _Stat:
    def __init__(self, size: int, mtime: float) -> None:
        self.st_size, self.st_mtime = size, mtime


class RemoteFile(PurePosixPath):
    """A path on an FTP, SFTP or SMB storage (spec §9.1).

    A pure POSIX path, so name, stem, suffix, parent and relative_to work as on a
    local file; ``stat``, ``iterdir`` and the rest ask the server (or answer from
    the listing entry it came with). ffmpeg reads ``url``: the relay on this
    server. ``str()`` stays the path, so comparing and hashing stay paths.
    """

    def __init__(self, *args: Any, storage: dict[str, Any] | None = None,
                 info: dict[str, Any] | None = None) -> None:  # fmt: skip
        super().__init__(*args)
        self.storage = storage or {}
        self._info = info

    def with_segments(self, *segments: Any) -> RemoteFile:
        return type(self)(*segments, storage=self.storage)

    @property
    def fs(self) -> Any:
        return filesystem(self.storage)

    def _entry(self) -> dict[str, Any]:
        if self._info is None:
            self._info = self.fs.info(str(self))
        return self._info

    def stat(self) -> _Stat:
        info = self._entry()
        return _Stat(int(info.get("size") or 0), _mtime(info))

    def exists(self) -> bool:
        try:
            self._entry()
            return True
        except (OSError, FileNotFoundError):
            return False

    def is_dir(self) -> bool:
        return self.exists() and self._entry().get("type") == "directory"

    def is_file(self) -> bool:
        return self.exists() and self._entry().get("type") != "directory"

    def is_symlink(self) -> bool:
        return False

    def iterdir(self) -> Any:
        for entry in self.fs.ls(str(self), detail=True):
            yield type(self)(entry["name"], storage=self.storage, info=entry)

    def glob(self, pattern: str) -> Any:  # type: ignore[override]
        """The entries of this folder whose name matches *pattern* (one level only:
        what sidecar subtitles need)."""
        import fnmatch

        for child in self.iterdir():
            if fnmatch.fnmatchcase(child.name, pattern):
                yield child

    def read_bytes(self) -> bytes:
        with self.open("rb") as handle:
            return handle.read()

    def relative(self) -> str:
        """Where it sits inside its storage, POSIX: the listing's ``rel``."""
        return self.relative_to(root(self.storage)).as_posix()

    @property
    def url(self) -> str:
        return f"{RELAY}/api/storages/{quote(self.storage['id'])}/raw/{quote(self.relative())}"

    def open(self, mode: str = "rb", **kw: Any) -> Any:  # type: ignore[override]
        return self.fs.open(str(self), mode, **kw)

    def unlink(self, missing_ok: bool = False) -> None:
        try:
            self.fs.rm(str(self))
        except FileNotFoundError:
            if not missing_ok:
                raise


def top(s: dict[str, Any]) -> RemoteFile:
    """A storage's top folder, to scan from."""
    return RemoteFile(root(s), storage=s)


def media_input(file: Any) -> str:
    """What ffmpeg is given for a stored file: its relay URL when it is on a server."""
    return getattr(file, "url", None) or str(file)


class ServerFile(RemoteFile):
    """A film on another sestudio (spec §9, X3): known from that server's listing
    and read through this one's relay, which asks it with the share token. Read
    only: nothing here deletes another server's files."""

    def stat(self) -> _Stat:
        info = self._info or {}
        return _Stat(int(info.get("size") or 0), float(info.get("mtime") or 0))

    def exists(self) -> bool:
        return self._info is not None

    def is_dir(self) -> bool:
        return False

    def is_file(self) -> bool:
        return self._info is not None

    def iterdir(self) -> Any:
        return iter(())

    def glob(self, pattern: str) -> Any:  # type: ignore[override]
        return iter(())  # sidecars stay on that server; embedded tracks still play

    def relative(self) -> str:
        return self.as_posix().lstrip("/")

    def open(self, mode: str = "rb", **kw: Any) -> Any:  # type: ignore[override]
        raise PermissionError("Read through the relay, not opened here")

    def unlink(self, missing_ok: bool = False) -> None:
        raise PermissionError("Files on another sestudio are read only here")
