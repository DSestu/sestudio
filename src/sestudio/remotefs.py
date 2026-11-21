"""FTP, SFTP and SMB storages, read in the app (SPEC-storage §9, X1).

One fsspec filesystem per storage, made from its fields and its password in the
vault. Everything that touches the network goes through here, so a test swaps
``filesystem`` for an in-memory one.
"""

from __future__ import annotations

import posixpath
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
