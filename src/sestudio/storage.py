"""Storages: every place this server's files live (SPEC-storage).

A storage is a folder the OS can open (a disk, a network share such as
``\\\\nas\\films``, an rclone mount of an FTP server) or one of the music-only
sources (another sestudio server, a YouTube Music account). Each says what it
holds (``roles``: video, music) and exactly one folder takes new downloads.

The list lives in the config as ``storages``; ``local`` is the download root the
app always had and cannot be removed. ``config._reconcile`` keeps the older
``output_root`` and ``music_libraries`` keys in step with it.
"""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

from sestudio.config import (
    FOLDER_STORAGE,
    LOCAL_STORAGE,
    ROLES,
    load_config,
    save_config,
)

LOCAL, FOLDER = LOCAL_STORAGE, FOLDER_STORAGE
REMOTE, YTMUSIC = "remote_sestudio", "ytmusic_account"
KINDS = (FOLDER, REMOTE, YTMUSIC)
#: Kinds that only hold music for now (SPEC-storage phase 2, X3).
MUSIC_ONLY = (REMOTE, YTMUSIC)
_PREFIX = {FOLDER: "f", REMOTE: "r", YTMUSIC: "y"}


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
) -> dict[str, Any]:
    label = label.strip()
    s: dict[str, Any] = {"kind": kind}
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
    else:
        raise Invalid(f"unknown storage kind: {kind}")
    s |= {
        "id": _PREFIX[kind] + secrets.token_hex(3),
        "label": label,
        "roles": _roles(kind, roles),
        "download": False,
    }
    cfg = load_config()
    cfg.storages.append(s)
    save_config(cfg)
    return s


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
    save_config(cfg)  # with no target left, `_reconcile` gives it back to `local`
    return gone
