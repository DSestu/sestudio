"""Storages as the client sees and manages them (SPEC-storage §8): the Media
switcher reads them, Settings › Storage adds, edits and removes them."""

from __future__ import annotations

import asyncio
import shutil

import httpx
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sestudio import bridge, nearby, remotefs, storage, transfers
from sestudio.config import load_config, save_config
from sestudio.music import libraries, runner
from sestudio.web.ranged import ranged
from sestudio.web.routes.music_libraries import require_token

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
    #: Another sestudio that opens shares on its own network (SPEC-storage §10).
    bridge: bool = False
    #: A share opened through that bridge: which bridge, which protocol, whether it
    #: opens by itself on the same Wi-Fi.
    via: str = ""
    proto: str = ""
    auto: bool = True
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
            include={
                "host",
                "port",
                "share",
                "username",
                "domain",
                "tls",
                "password",
                "proto",
            }
        )


class StorageEdit(BaseModel):
    label: str | None = None
    roles: list[str] | None = None
    #: Only `true`: downloads move *to* a storage, never away to nowhere.
    download: bool | None = None
    bridge: bool | None = None
    #: A share opened through a bridge: open it again, or disconnect it (B14).
    connected: bool | None = None
    auto: bool | None = None


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
    row = public(s) | state | {"usage": _usage(s, state)}
    if s["kind"] == storage.BRIDGED:
        try:
            row["via_label"] = storage.get(s["via"])["label"]
        except storage.Invalid:
            row["via_label"] = ""
    return row


def _run(fn, *args):
    try:
        return fn(*args)
    except storage.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/storages")
async def list_storages() -> list[dict[str, Any]]:
    # A share opened here as a bridge belongs to the sestudio that asked for it.
    return await asyncio.to_thread(
        lambda: [_row(s) for s in storage.all_storages() if not s.get("temporary")]
    )


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
        body.network() if body.kind in (*storage.NETWORK, storage.BRIDGED) else None,
        body.bridge,
        body.via,
        body.auto,
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
    if body.bridge is not None:
        s = _run(storage.set_bridge, storage_id, body.bridge)
    if body.connected is not None:
        s = _run(storage.set_connected, storage_id, body.connected)
    if body.auto is not None:
        s = _run(storage.set_auto, storage_id, body.auto)
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
    if s["kind"] in (storage.REMOTE, storage.BRIDGED) and "video" in s["roles"]:
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
    peer = storage.peer_of(s)
    remote_key = storage.remote_key(s, remote_key)
    headers = {
        "Authorization": f"Bearer {peer.get('token', '')}",
        "Accept-Encoding": "identity",
    }
    if rng := request.headers.get("range"):
        headers["Range"] = rng
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None))
    req = client.build_request(
        request.method, f"{peer['url']}/api/share/video/file",
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
    #: Where each file lands, in the order of *files*; overrides *folder*.
    dests: list[str] | None = None
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
        body.dests,
    )
    return job.public()


@router.get("/storages/{storage_id}/folders")
async def list_folders(storage_id: str, path: str = "") -> dict[str, Any]:
    """The folders inside *path* on a storage: the copy picker's folder chooser."""
    return {
        "folders": await asyncio.to_thread(
            _transfer, transfers.folders, storage_id, path
        )
    }


@router.get("/transfers")
def list_transfers() -> list[dict[str, Any]]:
    return transfers.all_jobs()


@router.post("/transfers/{job_id}/{action}")
def control_transfer(job_id: str, action: str) -> dict[str, Any]:
    if action not in ("pause", "resume", "cancel", "clear"):
        raise HTTPException(404, "Pause, resume, cancel or clear")
    return _transfer(transfers.control, job_id, action)


# --- this server as a bridge to the network it is on (SPEC-storage §10) ---------

bridge_share = APIRouter(prefix="/share/bridge", dependencies=[Depends(require_token)])


@bridge_share.get("")
async def bridge_info() -> dict[str, Any]:
    """Its name, the Wi-Fi it is on, and the shares it holds open for the
    sestudio that uses it as a bridge."""
    return {**await asyncio.to_thread(bridge.info), "open": storage.temporary_ids()}


class BridgeOpen(BaseModel):
    #: The asking sestudio's id for the share: the bridge calls it ``t<key>``.
    key: str
    kind: str
    label: str = ""
    host: str = ""
    port: int | None = None
    share: str = ""
    path: str = ""
    username: str = ""
    domain: str = ""
    tls: bool = False
    password: str = ""
    #: A media server's description address.
    url: str = ""


@bridge_share.post("/open")
async def bridge_open(body: BridgeOpen) -> dict[str, Any]:
    """Open a share on this network for the sestudio that asked, in memory only."""
    net = body.model_dump(exclude={"key", "kind", "label"})
    s = await asyncio.to_thread(
        _run, storage.open_temporary, body.key, body.kind, net, body.label
    )
    return public(s)


@bridge_share.delete("/open/{storage_id}")
def bridge_close(storage_id: str) -> dict[str, bool]:
    if storage_id in storage.temporary_ids():
        storage.close_temporary(storage_id)
    return {"ok": True}


@bridge_share.get("/nearby")
async def bridge_nearby() -> dict[str, Any]:
    """What holds files on this bridge's network (B3–B5)."""
    return await asyncio.to_thread(nearby.scan)


# --- looking around (SPEC-storage §10, B3–B5) -----------------------------------

#: A bridge looks for a few seconds, then answers over Tailscale.
NEARBY_SECONDS = 30.0


@router.get("/nearby")
async def look_around() -> dict[str, Any]:
    """What holds files on this server's own network."""
    return await asyncio.to_thread(nearby.scan)


@router.get("/storages/{storage_id}/nearby")
async def look_around_bridge(storage_id: str) -> dict[str, Any]:
    """What a bridge finds on the network it is on."""
    s = _run(storage.get, storage_id)
    if not s.get("bridge"):
        raise HTTPException(400, "Only a bridge looks around its network")
    try:
        async with httpx.AsyncClient(timeout=NEARBY_SECONDS) as client:
            r = await client.get(
                f"{s['url']}/api/share/bridge/nearby", headers=storage._bearer(s)
            )
    except httpx.HTTPError:
        raise HTTPException(503, f"{s['label']} did not answer") from None
    if r.status_code == 404:
        raise HTTPException(
            409, f"{s['label']} runs an older sestudio: update it to look around"
        )
    if r.status_code != 200:
        raise HTTPException(
            502, f"{s['label']} could not look around ({r.status_code})"
        )
    return r.json()


# --- files of a share held here, for the sestudio that opened it (SPEC-storage §10, B12, B13)
#
# What its copy engine needs to write into the share, or move out of it: whether a
# file is there, writing one, renaming one, deleting one. Only a share held here
# for it: never this server's own storages.


def _held(key: str) -> remotefs.RemoteFile:
    sid, colon, rel = key.partition(":")
    if not colon or sid not in storage.temporary_ids():
        raise HTTPException(404, "No such share open here")
    parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or ".." in parts:
        raise HTTPException(403, "Path outside the share")
    return storage.top_of(storage.get(sid)).joinpath(*parts)


@bridge_share.get("/stat")
def held_stat(path: str) -> dict[str, Any]:
    target = _held(path)
    try:
        st = target.stat()
    except (OSError, FileNotFoundError):
        return {"exists": False}
    return {"exists": True, "size": st.st_size, "mtime": st.st_mtime}


@bridge_share.put("/file")
async def held_write(path: str, request: Request) -> dict[str, Any]:
    """The request's body, written to *path*; its folders are made first."""
    target = _held(path)
    await asyncio.to_thread(target.fs.makedirs, str(target.parent), exist_ok=True)
    out = await asyncio.to_thread(target.open, "wb")
    size = 0
    try:
        async for chunk in request.stream():
            if chunk:
                await asyncio.to_thread(out.write, chunk)
                size += len(chunk)
    finally:
        await asyncio.to_thread(out.close)
    return {"size": size}


@bridge_share.delete("/file")
def held_delete(path: str) -> dict[str, bool]:
    _held(path).unlink(missing_ok=True)
    return {"ok": True}


class HeldMove(BaseModel):
    source: str
    target: str


@bridge_share.post("/move")
def held_move(body: HeldMove) -> dict[str, bool]:
    """Rename inside one share held here; whatever was at *target* is replaced."""
    src, dst = _held(body.source), _held(body.target)
    if src.storage["id"] != dst.storage["id"]:
        raise HTTPException(400, "Both inside the same share")
    if dst.exists():
        dst.unlink()
    src.fs.mv(str(src), str(dst))
    return {"ok": True}


# --- what a found place lets in ---------------------------------------------------


class Probe(BaseModel):
    kind: str
    host: str
    port: int | None = None
    #: Empty: anonymous, then guest, are tried.
    username: str = ""
    password: str = ""


def _probe(body: Probe) -> dict[str, Any]:
    return nearby.probe(
        body.kind, body.host.strip(), body.port, body.username, body.password
    )


@bridge_share.post("/probe")
async def bridge_probe(body: Probe) -> dict[str, Any]:
    """On a bridge: who gets into a place on its network, and its shares."""
    return await asyncio.to_thread(_probe, body)


@router.post("/nearby/probe")
async def probe_here(body: Probe) -> dict[str, Any]:
    """Who gets into a place on this server's network, and what each share allows."""
    return await asyncio.to_thread(_probe, body)


@router.post("/storages/{storage_id}/nearby/probe")
async def probe_through(storage_id: str, body: Probe) -> dict[str, Any]:
    """The same, asked of a bridge on its own network."""
    s = _run(storage.get, storage_id)
    if not s.get("bridge"):
        raise HTTPException(400, "Only a bridge looks around its network")
    try:
        async with httpx.AsyncClient(timeout=NEARBY_SECONDS) as client:
            r = await client.post(
                f"{s['url']}/api/share/bridge/probe",
                headers=storage._bearer(s),
                json=body.model_dump(),
            )
    except httpx.HTTPError:
        raise HTTPException(503, f"{s['label']} did not answer") from None
    if r.status_code == 404:
        raise HTTPException(409, f"{s['label']} runs an older sestudio: update it")
    if r.status_code != 200:
        raise HTTPException(502, f"{s['label']} could not check it ({r.status_code})")
    return r.json()
