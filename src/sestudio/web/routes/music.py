"""Music analysis: what the player draws and syncs from (SPEC-music.md §11, PR 3)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from sestudio.music import libraries, online, runner, store
from sestudio.sites import SiteError
from sestudio.web.routes.stream import _proxy_url

router = APIRouter()


def _analyses(ids: list[str]) -> dict[str, Any]:
    """Stored analyses; a remote library's tracks are asked of their own server."""
    found = store.get(ids)
    for tid in ids:
        remote = None if tid in found else libraries.split_remote(tid)
        if remote and (a := libraries.remote_analysis(*remote)):
            found[tid] = a
    return found


@router.get("/music/analysis/status")
async def analysis_status() -> dict[str, Any]:
    return runner.status()


@router.post("/music/analysis/renormalise")
async def renormalise() -> dict[str, Any]:
    state = await asyncio.to_thread(store.renormalise)
    return {"tracks": state["n"]}


@router.get("/music/tracks/analysis")
async def tracks_analysis(ids: str = Query(...)) -> dict[str, Any]:
    """Several analyses at once (``?ids=a,b,c``); unanalysed ids are left out."""
    wanted = [i for i in ids.split(",") if i]
    return await asyncio.to_thread(_analyses, wanted)


@router.get("/music/tracks/{track_id}/analysis")
async def track_analysis(track_id: str) -> dict[str, Any]:
    found = await asyncio.to_thread(_analyses, [track_id])
    if track_id not in found:
        raise HTTPException(status_code=404, detail="Not analysed (yet)")
    return found[track_id]


@router.get("/music/online/link")
async def online_link(url: str = Query(...)) -> dict[str, Any]:
    """A pasted YouTube / YouTube Music link as queue items (a playlist: all its entries)."""
    link = online.parse_url(url)
    if link is None:
        raise HTTPException(
            status_code=400, detail="Not a YouTube or YouTube Music link"
        )
    try:
        found = await asyncio.to_thread(online.expand, link)
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"kind": link.kind, **found}


@router.get("/music/online/{track_id}/audio")
async def online_audio(track_id: str, request: Request) -> RedirectResponse:
    """The track's audio, through the stream proxy (same origin, so Web Audio may read it)."""
    vid = online.video_id(track_id)
    if vid is None:
        raise HTTPException(status_code=404, detail="Not a YouTube track")
    try:
        stream = await asyncio.to_thread(online.resolve, vid)
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not stream["url"]:
        raise HTTPException(status_code=502, detail="No audio stream")
    online.kick_analysis(track_id)
    target = _proxy_url(
        request.app.state.proxy_secret, stream["url"], stream["referer"], "youtube"
    )
    return RedirectResponse(target, status_code=307)
