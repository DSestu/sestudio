"""Storages as the client sees and manages them (SPEC-storage §8): the Media
switcher reads them, Settings › Storage adds, edits and removes them."""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sestudio import remotefs, storage, transfers
from sestudio.config import load_config, save_config
from sestudio.music import libraries, runner
from sestudio.web.ranged import ranged

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
    # An FTP, SFTP or SMB server (SPEC-storage §9); the password goes to the vault.
    host: str = ""
    port: int | None = None
    share: str = ""
    username: str = ""
    domain: str = ""
    tls: bool = False
    password: str = ""

    def network(self) -> dict[str, Any]:
        return self.model_dump(
            include={"host", "port", "share", "username", "domain", "tls", "password"}
        )


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


@router.post("/storages/test")
async def test_server(body: NewStorage) -> dict[str, Any]:
    """The add form's Test: connect to an FTP, SFTP or SMB server and list its folder,
    without adding anything."""
    if body.kind not in storage.NETWORK:
        raise HTTPException(400, "Only a server is tested this way")

    def attempt() -> dict[str, Any]:
        probe = {"id": "test", "kind": body.kind}
        probe |= _run(storage._network_fields, body.kind, body.path, body.network())
        try:
            return remotefs.check_with(probe, body.password)
        except Exception as exc:  # noqa: BLE001 - the server's own words are the answer
            raise HTTPException(400, f"Could not connect: {exc}") from None

    try:
        return await asyncio.wait_for(asyncio.to_thread(attempt), CHECK_SECONDS * 2)
    except TimeoutError:
        raise HTTPException(400, "The server did not answer in time") from None


@router.post("/storages")
def add_storage(body: NewStorage) -> dict[str, Any]:
    s = _run(
        storage.add,
        body.kind,
        body.roles,
        body.label,
        body.path,
        body.url,
        body.token,
        body.network() if body.kind in storage.NETWORK else None,
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


@router.api_route("/storages/{storage_id}/raw/{path:path}", methods=["GET", "HEAD"])
async def relay(storage_id: str, path: str, request: Request) -> Response:
    """A file on an FTP, SFTP or SMB storage, served with byte ranges (spec §9.1):
    what ffmpeg, the browser, a cast and a TV read it through."""
    from sestudio import downloaded
    from sestudio.web.routes.downloaded import _resolved_remote

    s = _run(storage.get, storage_id)
    if s["kind"] == storage.REMOTE and "video" in s["roles"]:
        return await peer_stream(s, path, request)
    if s["kind"] not in storage.NETWORK:
        raise HTTPException(404, "Only a server's files are relayed")
    target = await asyncio.to_thread(_resolved_remote, s, path)
    return ranged(
        request,
        target,
        downloaded.media_type_for(target),
        {"Access-Control-Allow-Origin": "*"},
    )


#: What a file's answer from another sestudio passes on: what a player needs to seek.
_PASS = ("content-type", "content-length", "content-range", "accept-ranges")


async def peer_stream(s: dict[str, Any], remote_key: str, request: Request) -> Response:
    """A film on another sestudio (spec §9, X3), asked of it with the share token
    and streamed on, ranges and all: what the relay answers for it."""
    import httpx

    headers = {
        "Authorization": f"Bearer {s.get('token', '')}",
        "Accept-Encoding": "identity",
    }
    if rng := request.headers.get("range"):
        headers["Range"] = rng
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))
    req = client.build_request(
        request.method, f"{s['url']}/api/share/video/file",
        params={"path": remote_key}, headers=headers,
    )  # fmt: skip
    try:
        r = await client.send(req, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(502, f"{s['label']} is not reachable") from None
    if r.status_code >= 400:
        await r.aclose()
        await client.aclose()
        raise HTTPException(502 if r.status_code in (401, 403) else r.status_code,
                            f"{s['label']} did not give the file")  # fmt: skip

    async def body():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    passed = {k: v for k, v in r.headers.items() if k.lower() in _PASS}
    passed["Access-Control-Allow-Origin"] = "*"
    return StreamingResponse(body(), status_code=r.status_code, headers=passed)


# --- copy and move between storages (SPEC-storage §9, X2) -----------------------


class NewTransfer(BaseModel):
    #: The files, by the key the listing gives them.
    files: list[str]
    to: str
    mode: str = "copy"
    on_conflict: str = "skip"
    #: Where they land on the destination; omitted, each keeps its path.
    folder: str | None = None
    label: str = ""


def _transfer(fn, *args):
    try:
        return fn(*args)
    except (transfers.Invalid, storage.Invalid, ValueError) as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/transfers")
def start_transfer(body: NewTransfer) -> dict[str, Any]:
    job = _transfer(
        transfers.create,
        body.files,
        body.to,
        body.mode,
        body.on_conflict,
        body.folder,
        body.label,
    )
    return job.public()


@router.get("/transfers")
def list_transfers() -> list[dict[str, Any]]:
    return transfers.all_jobs()


@router.post("/transfers/{job_id}/{action}")
def control_transfer(job_id: str, action: str) -> dict[str, Any]:
    if action not in ("pause", "resume", "cancel", "clear"):
        raise HTTPException(404, "Pause, resume, cancel or clear")
    return _transfer(transfers.control, job_id, action)
