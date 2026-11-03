"""Music libraries, and the read-only share API other sestudio servers use (SPEC-music §13.1).

``/music/share/*`` is the only part of the app that asks for credentials: a bearer
token issued under ``/music/share-tokens``, kept hashed, revocable.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from sestudio import downloaded
from sestudio.config import load_config
from sestudio.music import folders, libraries, runner, store

router = APIRouter(prefix="/music")

_PASS = ("content-type", "content-length", "content-range", "accept-ranges")


class LibraryBody(BaseModel):
    kind: str
    label: str = ""
    path: str = ""
    url: str = ""
    token: str = ""


class RenameBody(BaseModel):
    label: str


class TokenBody(BaseModel):
    label: str = ""


def _run(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except libraries.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


def _file(track_id: str, library_id: str | None = None):
    path = libraries.file_for(track_id, library_id)
    if path is None:
        raise HTTPException(404, "No such track")
    return FileResponse(path, media_type=downloaded.media_type_for(path))


# --- this server's libraries --------------------------------------------------


@router.get("/libraries")
def list_libraries() -> list[dict]:
    runner.kick(load_config().output_root)
    return libraries.status(runner.status()["running"])


@router.post("/libraries")
def add_library(body: LibraryBody) -> dict:
    lib = _run(libraries.add, body.kind, body.label, body.path, body.url, body.token)
    runner.kick(load_config().output_root)
    return libraries.public(lib)


@router.patch("/libraries/{library_id}")
def rename_library(library_id: str, body: RenameBody) -> dict:
    return libraries.public(_run(libraries.rename, library_id, body.label))


@router.delete("/libraries/{library_id}")
def remove_library(library_id: str) -> dict[str, bool]:
    _run(libraries.remove, library_id)
    return {"ok": True}


@router.get("/folders")
def browse_folders(path: str = "") -> dict:
    """Subfolders of *path* for the library picker; with no path, the suggested starting points."""
    if not path.strip():
        return {"roots": folders.roots()}
    try:
        return folders.browse(path.strip())
    except folders.Unreadable as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/libraries/tracks")
def other_tracks() -> list[dict]:
    """The tracks of every library but ``local`` (that one is in the downloads listing)."""
    runner.kick(load_config().output_root)
    return libraries.other_tracks()


@router.get("/libraries/{library_id}/tracks/{track_id}/audio")
async def library_audio(library_id: str, track_id: str, request: Request) -> Response:
    lib = _run(libraries.get, library_id)
    if lib["kind"] != libraries.REMOTE:
        return _file(track_id, library_id)
    remote = libraries.split_remote(track_id)
    if remote is None or remote[0]["id"] != library_id:
        raise HTTPException(404, "No such track")
    client, req = libraries.remote_request(lib, remote[1], request.headers.get("range"))
    try:
        r = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        libraries.mark_offline(library_id, str(exc) or type(exc).__name__)
        raise HTTPException(502, "The other server is not reachable") from None
    if r.status_code >= 400:
        await r.aclose()
        await client.aclose()
        raise HTTPException(
            502 if r.status_code in (401, 403) else r.status_code,
            "The other server did not give the audio",
        )

    async def body():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    headers = {k: v for k, v in r.headers.items() if k.lower() in _PASS}
    return StreamingResponse(body(), status_code=r.status_code, headers=headers)


# --- tokens this server issues ------------------------------------------------


@router.get("/share-tokens")
def list_tokens() -> list[dict]:
    return libraries.tokens()


@router.post("/share-tokens")
def create_token(body: TokenBody) -> dict:
    record, secret = libraries.issue_token(body.label)
    return {**record, "token": secret}


@router.delete("/share-tokens/{token_id}")
def revoke_token(token_id: str) -> dict[str, bool]:
    _run(libraries.revoke_token, token_id)
    return {"ok": True}


# --- what other servers read (bearer token) -----------------------------------


def require_token(authorization: str | None = Header(default=None)) -> None:
    scheme, _, secret = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not libraries.token_valid(secret.strip()):
        raise HTTPException(
            401, "A valid music token is needed", headers={"WWW-Authenticate": "Bearer"}
        )


share = APIRouter(prefix="/music/share", dependencies=[Depends(require_token)])


@share.get("/tracks")
def share_tracks() -> dict[str, list[dict]]:
    return {"tracks": libraries.share_tracks()}


@share.get("/tracks/{track_id}/analysis")
def share_analysis(track_id: str) -> dict:
    found = store.get([track_id])
    if track_id not in found:
        raise HTTPException(404, "Not analysed (yet)")
    return found[track_id]


@share.get("/tracks/{track_id}/audio")
def share_audio(track_id: str) -> FileResponse:
    return _file(track_id)
