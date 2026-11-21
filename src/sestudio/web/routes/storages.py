"""Storages as the client sees and manages them (SPEC-storage §8): the Media
switcher reads them, Settings › Storage adds, edits and removes them."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sestudio import storage
from sestudio.config import load_config, save_config
from sestudio.music import libraries, runner

router = APIRouter()

#: How long the add form's live check of a folder may take.
CHECK_SECONDS = 5.0


class NewStorage(BaseModel):
    kind: str
    roles: list[str]
    label: str = ""
    path: str = ""
    url: str = ""
    token: str = ""
    download: bool = False


class StorageEdit(BaseModel):
    label: str | None = None
    roles: list[str] | None = None
    #: Only `true`: downloads move *to* a storage, never away to nowhere.
    download: bool | None = None


def public(s: dict[str, Any]) -> dict[str, Any]:
    """A storage without its secrets: another server's token never leaves this one."""
    return {k: v for k, v in s.items() if k != "token"}


def _usage(s: dict[str, Any], state: dict[str, Any]) -> dict[str, int] | None:
    if s["kind"] != storage.FOLDER or state["state"] != "online":
        return None
    try:
        du = shutil.disk_usage(s["path"])
    except OSError:
        return None
    return {"total": du.total, "free": du.free}


def _row(s: dict[str, Any]) -> dict[str, Any]:
    state = storage.state(s)
    return public(s) | state | {"usage": _usage(s, state)}


def _run(fn, *args):
    try:
        return fn(*args)
    except storage.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/storages")
async def list_storages() -> list[dict[str, Any]]:
    return await asyncio.to_thread(lambda: [_row(s) for s in storage.all_storages()])


def _check(path: str) -> dict[str, Any]:
    folder = Path(path.strip()).expanduser()
    if not path.strip() or not folder.is_dir():
        raise storage.Invalid("That folder does not exist on this machine")
    try:
        folders = sum(1 for e in folder.iterdir() if e.is_dir())
        du = shutil.disk_usage(folder)
    except OSError as exc:
        raise storage.Invalid(
            f"That folder cannot be read: {exc.strerror or exc}"
        ) from None
    return {"path": str(folder), "name": folder.name or str(folder), "folders": folders,
            "total": du.total, "free": du.free}  # fmt: skip


@router.get("/storages/check")
async def check_folder(path: str) -> dict[str, Any]:
    """What the add form says under the folder field: found, how many folders, how much room."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_run, _check, path), CHECK_SECONDS
        )
    except TimeoutError:
        raise HTTPException(
            400, "That folder did not answer: is its server on?"
        ) from None


@router.post("/storages")
def add_storage(body: NewStorage) -> dict[str, Any]:
    s = _run(
        storage.add, body.kind, body.roles, body.label, body.path, body.url, body.token
    )
    if body.download:
        s = _run(storage.set_download, s["id"])
    if "music" in s["roles"]:
        runner.kick(load_config().output_root)
    return _row(s)


@router.patch("/storages/{storage_id}")
def edit_storage(storage_id: str, body: StorageEdit) -> dict[str, Any]:
    s = _run(storage.get, storage_id)
    if body.label is not None:
        s = _run(storage.rename, storage_id, body.label)
    if body.roles is not None:
        s = _run(storage.set_roles, storage_id, body.roles)
        if "music" in s["roles"]:
            runner.kick(load_config().output_root)
    if body.download:
        s = _run(storage.set_download, storage_id)
    return _row(s)


@router.delete("/storages/{storage_id}")
def remove_storage(storage_id: str) -> dict[str, bool]:
    """Forget a storage; its files are never touched."""
    gone = _run(storage.remove, storage_id)
    if gone["kind"] == storage.FOLDER:
        # The Android app's standard folders are not added back by themselves.
        cfg = load_config()
        if gone["path"] not in cfg.music_dismissed:
            cfg.music_dismissed.append(gone["path"])
            save_config(cfg)
    libraries.forget(storage_id)
    return {"ok": True}
