"""The station's routes: start and stop it, ask how it is, and pull its stream (SPEC-music §7)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from sestudio import downloaded
from sestudio.config import load_config
from sestudio.music import queue, station
from sestudio.music.station import BrowserCapture, Station
from sestudio.web.streaming import ClosingStreamingResponse

router = APIRouter(prefix="/music/station")

STREAM_PATH = "/api/music/station/stream"
HLS_PATH = "/api/music/station/hls/live.m3u8"


class StartBody(BaseModel):
    #: A frame rate for this run; absent, the setting (20 by default, 30 on a machine that keeps up).
    fps: int | None = Field(default=None, ge=10, le=30)


def _tv_url(request: Request) -> str:
    """The ``?tv`` page as this server serves it to a browser on the same machine."""
    state = request.app.state
    if getattr(state, "http_port", None):
        return f"http://127.0.0.1:{state.http_port}/?tv"
    if getattr(state, "https_port", None):
        return f"https://127.0.0.1:{state.https_port}/?tv"
    return f"{request.base_url}?tv"


def make_station(request: Request, fps: int | None) -> Station:
    cfg = load_config()
    return Station(
        BrowserCapture(_tv_url(request), cfg.station_browser),
        fps=fps or cfg.station_fps,
    )


def _status(request: Request) -> dict[str, Any]:
    st = station.current()
    return {
        **(st.status() if st else {"running": False}),
        "path": STREAM_PATH,
        "hls_path": HLS_PATH,
        "url": f"{request.base_url}{STREAM_PATH.lstrip('/')}",
    }


@router.post("/start")
async def start(request: Request, body: StartBody | None = None) -> dict[str, Any]:
    """Open the station (or find it open) and say where its stream is."""
    fps = body.fps if body else None
    await asyncio.to_thread(station.start, lambda: make_station(request, fps))
    return _status(request)


@router.post("/stop")
async def stop() -> dict[str, bool]:
    return {"stopped": await asyncio.to_thread(station.stop)}


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    return _status(request)


async def _stream(st: Station) -> AsyncIterator[bytes]:
    sub = st.subscribe()
    try:
        while data := await sub[1].get():
            yield data
    finally:
        st.unsubscribe(sub)


@router.api_route("/stream", methods=["GET", "HEAD"])
async def stream(request: Request) -> Response:
    """The station as one live MPEG-TS stream (H.264 + AAC), from where it is now."""
    st = station.current()
    if st is None:
        raise HTTPException(status_code=409, detail="No station is running")
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "contentFeatures.dlna.org": downloaded.TV_CONTENT_FEATURES,
        "transferMode.dlna.org": request.headers.get(
            "transferMode.dlna.org", "Streaming"
        ),
    }
    if request.method == "HEAD":
        return Response(media_type=downloaded.TV_MEDIA_TYPE, headers=headers)
    return ClosingStreamingResponse(
        _stream(st), media_type=downloaded.TV_MEDIA_TYPE, headers=headers
    )


class VolumeBody(BaseModel):
    level: float = Field(ge=0, le=1)
    muted: bool = False


@router.post("/volume")
async def volume(body: VolumeBody) -> dict[str, Any]:
    """The player moved the TV's volume: the TV page shows its pill for it."""
    queue.publish_volume(body.level, body.muted)
    return {"level": body.level, "muted": body.muted}


@router.get("/hls/{name}")
async def hls(name: str) -> FileResponse:
    """The station as a live HLS playlist (what a Chromecast plays) and its segments."""
    st = station.current()
    path = st.hls_dir / name if st else None
    # Only the files ffmpeg writes: a bare name, no path.
    if path is None or name != Path(name).name or not path.is_file():
        raise HTTPException(status_code=404, detail="No such part of the station")
    kind = "application/vnd.apple.mpegurl" if name.endswith(".m3u8") else "video/mp2t"
    return FileResponse(
        path,
        media_type=kind,
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"},
    )
