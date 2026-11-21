"""Storages: every place this server's files live (SPEC-storage).

A storage is a folder the OS can open (a disk, a network share such as
``\\\\nas\\films``, an rclone mount of an FTP server) or one of the music-only
sources (another sestudio server, a YouTube Music account). Each says what it
holds (``roles``: video, music) and exactly one folder takes new downloads.

The list lives in the config as ``storages``; ``local`` is the download root the
app always had and cannot be removed. ``config.reconcile`` keeps the older
``output_root`` and ``music_libraries`` keys in step with it.
"""

from __future__ import annotations

import dataclasses
import json
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from sestudio import remotefs, vault
from sestudio.config import (
    FOLDER_STORAGE,
    LOCAL_STORAGE,
    ROLES,
    config_dir,
    load_config,
    save_config,
)

LOCAL, FOLDER = LOCAL_STORAGE, FOLDER_STORAGE
REMOTE, YTMUSIC = "remote_sestudio", "ytmusic_account"
#: Servers read in the app over their protocol (SPEC-storage §9, X1).
NETWORK = ("ftp", "sftp", "smb")
KINDS = (FOLDER, REMOTE, YTMUSIC, *NETWORK)
#: Kinds that only hold music for now (SPEC-storage phase 2, X3).
MUSIC_ONLY = (REMOTE, YTMUSIC)
_PREFIX = {FOLDER: "f", REMOTE: "r", YTMUSIC: "y", "ftp": "n", "sftp": "n", "smb": "n"}


class Invalid(ValueError):
    pass


def all_storages() -> list[dict[str, Any]]:
    """``local`` first, then the others in the order they were added."""
    return list(load_config().storages)


def get(storage_id: str) -> dict[str, Any]:
    for s in all_storages():
        if s["id"] == storage_id:
            return s
    raise Invalid(f"unknown storage: {storage_id}")


def download_target() -> dict[str, Any]:
    return next(s for s in all_storages() if s["download"])


def _roles(kind: str, roles: list[str]) -> list[str]:
    clean = [r for r in ROLES if r in roles]
    if not clean or len(clean) != len(set(roles)):
        raise Invalid("Say what it holds: video, music, or both")
    if kind in MUSIC_ONLY and clean != ["music"]:
        raise Invalid("This kind of storage can only hold music for now")
    return clean


def add(
    kind: str,
    roles: list[str],
    label: str = "",
    path: str = "",
    url: str = "",
    token: str = "",
    network: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Add a storage. *network* carries an FTP, SFTP or SMB server's fields
    (host, port, share, username, domain, tls) and its password, which goes to
    the vault, never the config."""
    label = label.strip()
    s: dict[str, Any] = {"kind": kind}
    password = ""
    if kind == FOLDER:
        folder = Path(path.strip()).expanduser()
        if not path.strip() or not folder.is_dir():
            raise Invalid("That folder does not exist on this machine")
        s["path"] = str(folder)
        label = label or folder.name or str(folder)
    elif kind == REMOTE:
        url = url.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise Invalid("The server address must start with http:// or https://")
        if not token.strip():
            raise Invalid("A token from the other server is needed")
        s |= {"url": url, "token": token.strip()}
        label = label or url.split("//", 1)[1]
    elif kind == YTMUSIC:
        if any(x["kind"] == YTMUSIC for x in all_storages()):
            raise Invalid("A YouTube Music account is already added")
        label = label or "YouTube Music"
    elif kind in NETWORK:
        s |= _network_fields(kind, path, network or {})
        password = str((network or {}).get("password") or "")
        label = label or f"{s['host']}{'/' + s['share'] if kind == 'smb' else ''}"
    else:
        raise Invalid(f"unknown storage kind: {kind}")
    s |= {
        "id": _PREFIX[kind] + secrets.token_hex(3),
        "label": label,
        "roles": _roles(kind, roles),
        "download": False,
    }
    if password:
        vault.put(s["id"], {"password": password})
    cfg = load_config()
    cfg.storages.append(s)
    save_config(cfg)
    return s


def _network_fields(kind: str, path: str, net: dict[str, Any]) -> dict[str, Any]:
    host = str(net.get("host") or "").strip()
    if not host or "/" in host or " " in host:
        raise Invalid(
            "The server's name or address is needed, like nas.local or 192.168.1.20"
        )
    out: dict[str, Any] = {"host": host, "path": "/" + path.strip().strip("/")}
    port = net.get("port")
    if port not in (None, ""):
        try:
            out["port"] = int(port)
        except (TypeError, ValueError):
            raise Invalid("The port is a number, like 21") from None
        if not 0 < out["port"] < 65536:
            raise Invalid("The port is a number from 1 to 65535")
    if net.get("username"):
        out["username"] = str(net["username"]).strip()
    if kind == "smb":
        share = str(net.get("share") or "").strip().strip("/\\")
        if not share:
            raise Invalid("The share's name is needed, like films")
        out["share"] = share
        if net.get("domain"):
            out["domain"] = str(net["domain"]).strip()
    if kind == "ftp":
        out["tls"] = bool(net.get("tls"))
    return out


def _edit(storage_id: str, change) -> dict[str, Any]:
    cfg = load_config()
    for s in cfg.storages:
        if s["id"] == storage_id:
            change(cfg, s)
            save_config(cfg)
            return s
    raise Invalid(f"unknown storage: {storage_id}")


def rename(storage_id: str, label: str) -> dict[str, Any]:
    def change(_cfg, s):
        s["label"] = label.strip() or s["label"]

    return _edit(storage_id, change)


def set_roles(storage_id: str, roles: list[str]) -> dict[str, Any]:
    def change(_cfg, s):
        s["roles"] = _roles(s["kind"], roles)

    return _edit(storage_id, change)


def set_download(storage_id: str) -> dict[str, Any]:
    """Make *storage_id* the one storage new downloads go to."""

    def change(cfg, s):
        if s["kind"] != FOLDER:
            raise Invalid("Downloads can only go to a folder")
        for other in cfg.storages:
            other["download"] = other is s

    return _edit(storage_id, change)


def remove(storage_id: str) -> dict[str, Any]:
    """Forget a storage; its files are never touched. The download target moves to ``local``."""
    if storage_id == LOCAL:
        raise Invalid("This PC cannot be removed")
    cfg = load_config()
    gone = next((s for s in cfg.storages if s["id"] == storage_id), None)
    if gone is None:
        raise Invalid(f"unknown storage: {storage_id}")
    cfg.storages = [s for s in cfg.storages if s is not gone]
    save_config(cfg)  # with no target left, `reconcile` gives it back to `local`
    _forget(storage_id)
    vault.drop(storage_id)
    remotefs.forget(storage_id)
    return gone


# --- reachability and listings (SPEC-storage PR 4) ------------------------------
#
# A share whose server is off can hold `is_dir()` for 20–60 s on Windows, so a
# storage is checked off the request thread with a timeout, and a listing never
# waits on one that is away: it gets the storage's last listing, kept on disk so
# it survives a restart (S13–S15).

#: How long a reachability check may take before the storage counts as offline.
CHECK_TIMEOUT = 3.0
#: The same for a server reached over FTP, SFTP or SMB: a handshake takes longer.
NET_CHECK_TIMEOUT = 8.0
#: How long a check's answer is trusted.
STATE_TTL = 15.0
#: How long another storage's listing is trusted; it is refreshed in the background.
#: `local` keeps `downloaded.scan`'s own 10 s cache.
OTHER_TTL = 60.0
#: How long a first listing (nothing kept yet) is waited for.
FIRST_WAIT = 5.0

_lock = threading.Lock()
_state: dict[str, dict[str, Any]] = {}
_lists: dict[str, dict[str, Any]] = {}


def _reachable(s: dict[str, Any]) -> bool:
    if s["kind"] == FOLDER:
        return Path(s["path"]).is_dir()
    try:  # a server: connect and list its top folder
        remotefs.filesystem(s).ls(remotefs.root(s))
        return True
    except Exception:  # noqa: BLE001 - any failure to answer is "away"
        remotefs.forget(s["id"])  # a dropped connection is not reused
        return False


def _probe(
    s: dict[str, Any], previous: dict[str, Any] | None
) -> tuple[bool, threading.Thread | None]:
    """Whether *s* answers, decided within its timeout; a check still running
    from before is not doubled, and counts as offline."""
    if previous and previous.get("probe") and previous["probe"].is_alive():
        return False, previous["probe"]
    found: list[bool] = []
    probe = threading.Thread(
        target=lambda: found.append(_reachable(s)), daemon=True, name="storage-probe"
    )
    probe.start()
    probe.join(CHECK_TIMEOUT if s["kind"] == FOLDER else NET_CHECK_TIMEOUT)
    return (bool(found and found[0]), None if found else probe)


def _where(s: dict[str, Any]) -> tuple:
    """What a check's answer is about: a changed address is checked again."""
    return (s.get("host"), s.get("share"), s.get("port"), s.get("path"))


def state(s: dict[str, Any]) -> dict[str, Any]:
    """``{state: online | offline, since}``: ``since`` is when it went away."""
    if s["kind"] != FOLDER and s["kind"] not in NETWORK:
        return {"state": "online", "since": None}
    now = time.time()
    with _lock:
        known = _state.get(s["id"])
        if known and known["path"] == _where(s) and now - known["checked"] < STATE_TTL:
            return {"state": known["state"], "since": known["since"]}
    ok, probe = _probe(s, known)
    since = None if ok else ((known or {}).get("since") or now)
    with _lock:
        _state[s["id"]] = {
            "state": "online" if ok else "offline",
            "since": since,
            "checked": time.time(),
            "path": _where(s),
            "probe": probe,
        }
    return {"state": "online" if ok else "offline", "since": since}


def online(s: dict[str, Any]) -> bool:
    return state(s)["state"] == "online"


def _list_file(storage_id: str) -> Path:
    return config_dir() / "storage" / f"{storage_id}.json"


def _kept(storage_id: str) -> list[Any]:
    from sestudio import downloaded

    try:
        rows = json.loads(_list_file(storage_id).read_text("utf-8"))
        return [downloaded.DownloadedFile(**r) for r in rows]
    except (OSError, ValueError, TypeError):
        return []


def _keep(storage_id: str, files: list[Any]) -> None:
    path = _list_file(storage_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps([dataclasses.asdict(f) for f in files]), "utf-8")
        tmp.replace(path)
    except OSError:
        pass  # only the copy kept for when it is away is lost


def _entry(s: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        entry = _lists.get(s["id"])
        if entry is None or entry["path"] != s["path"]:
            entry = _lists[s["id"]] = {
                "files": None, "at": 0.0, "scan": None, "path": s["path"],
            }  # fmt: skip
    if entry["files"] is None:
        entry["files"] = _kept(s["id"]) if s["id"] != LOCAL else []
    return entry


def _scan_into(s: dict[str, Any], entry: dict[str, Any]) -> None:
    from sestudio import downloaded

    files = downloaded.scan(s["path"])
    if files != entry["files"]:
        _keep(s["id"], files)
    entry["files"], entry["at"] = files, time.monotonic()


def files_of(s: dict[str, Any]) -> list[Any]:
    """Every file of a folder storage: scanned when reachable, else its last listing."""
    entry = _entry(s)
    if not online(s):
        if s["id"] == LOCAL and not entry["files"]:
            entry["files"] = _kept(LOCAL)
        return entry["files"]
    if s["id"] == LOCAL:
        # As before: scanned on the spot, under `downloaded.scan`'s own short cache.
        _scan_into(s, entry)
        return entry["files"]
    if time.monotonic() - entry["at"] < OTHER_TTL:
        return entry["files"]
    with _lock:
        scan = entry["scan"]
        if scan is None or not scan.is_alive():
            scan = entry["scan"] = threading.Thread(
                target=_scan_into, args=(s, entry), daemon=True, name="storage-scan"
            )
            scan.start()
    if not entry["files"]:
        scan.join(FIRST_WAIT)
    return entry["files"]


def invalidate(storage_id: str | None = None) -> None:
    """Listings are read again on next use (after a download or a delete)."""
    with _lock:
        for sid, entry in _lists.items():
            if storage_id in (None, sid):
                entry["at"] = 0.0


def _forget(storage_id: str) -> None:
    with _lock:
        _state.pop(storage_id, None)
        _lists.pop(storage_id, None)
    _list_file(storage_id).unlink(missing_ok=True)
