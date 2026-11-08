"""Music analysis: what the player draws and syncs from (SPEC-music.md §11, PR 3)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from sestudio.config import load_config
from sestudio.music import (
    builder,
    libraries,
    modes,
    online,
    proximity,
    runner,
    search,
    store,
)
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
    """Several analyses at once (``?ids=a,b,c``); unanalysed ids are left out.

    A track being analysed comes as ``partial: true`` with its bands so far and a ``progress``.
    """
    wanted = [i for i in ids.split(",") if i]
    found = await asyncio.to_thread(_analyses, wanted)
    rest = [i for i in wanted if i not in found]
    return found | (await asyncio.to_thread(store.partial, rest) if rest else {})


SUMMARY_KEYS = (
    "bpm",
    "key",
    "camelot",
    "keyConf",
    "genre",
    "genreConf",
    "genreSource",
    "energyScale",
    "harmony",
    "balance",
)


@router.get("/music/tracks/summary")
async def tracks_summary(ids: str = Query(...)) -> dict[str, Any]:
    """What the track rows show (tempo, key, genre, balance) without the curves."""
    wanted = [i for i in ids.split(",") if i]
    found = await asyncio.to_thread(_analyses, wanted)
    return {tid: {k: a[k] for k in SUMMARY_KEYS if k in a} for tid, a in found.items()}


@router.get("/music/tracks/{track_id}/analysis")
async def track_analysis(track_id: str) -> dict[str, Any]:
    found = await asyncio.to_thread(_analyses, [track_id])
    if track_id not in found:
        raise HTTPException(status_code=404, detail="Not analysed (yet)")
    return found[track_id]


@router.get("/music/search")
async def music_search(
    q: str = Query(...),
    source: str = Query("all"),
    limit: int = Query(12, ge=1, le=30),
) -> dict[str, Any]:
    """The libraries and the online sources for one query, or one source of them."""
    if source not in search.SOURCES:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")
    root = load_config().output_root
    return await asyncio.to_thread(search.search, q, source, limit, root)


@router.post("/music/tracks/{track_id}/analyse")
async def analyse_online(track_id: str) -> dict[str, bool]:
    """Analyse an online track on request (the playlist editor's Analyse button)."""
    if online.video_id(track_id) is None:
        raise HTTPException(
            status_code=400, detail="Only online tracks are analysed on request"
        )
    if not runner.enabled():
        raise HTTPException(
            status_code=409, detail="Music analysis is off on this server"
        )
    online.kick_analysis(track_id)
    return {"ok": True}


class GenreBody(BaseModel):
    genre: str | None = None


@router.put("/music/tracks/{track_id}/genre")
async def track_genre(track_id: str, body: GenreBody) -> dict[str, bool]:
    """Confirm or fix a track's genre (None clears the choice)."""
    genre = (body.genre or "").strip()[:60] or None
    if not await asyncio.to_thread(store.set_genre, track_id, genre):
        raise HTTPException(status_code=404, detail="Not analysed (yet)")
    return {"ok": True}


class ModeBody(BaseModel):
    tonic: str | None = None
    mode: str | None = None


@router.put("/music/tracks/{track_id}/mode")
async def track_mode(track_id: str, body: ModeBody) -> dict[str, bool]:
    """Settle a track's tonic and mode by ear (both None clears the choice)."""
    if (body.tonic or body.mode) and not (
        body.tonic and body.mode and modes.valid(body.tonic, body.mode)
    ):
        raise HTTPException(status_code=400, detail="Unknown tonic or mode")
    if not await asyncio.to_thread(store.set_mode, track_id, body.tonic, body.mode):
        raise HTTPException(status_code=404, detail="Not analysed (yet)")
    return {"ok": True}


@router.get("/music/analysis/unsure")
async def unsure_modes() -> dict[str, Any]:
    """Tracks whose mode the analysis is unsure of and the user has not settled yet."""
    ids = await asyncio.to_thread(store.unsure)
    return {"count": len(ids), "ids": ids}


def _pool(ids: list[str] | None) -> list[dict[str, Any]]:
    """The tracks to rank: the given ids, or every analysed local track."""
    ids = list(store.stamps()) if ids is None else ids
    found: dict[str, Any] = {}
    for i in range(0, len(ids), 200):
        found |= _analyses(ids[i : i + 200])
    return [found[i] for i in ids if i in found]


def _track(track_id: str, pool: list[dict[str, Any]]) -> dict[str, Any]:
    t = next((t for t in pool if t["id"] == track_id), None) or _analyses(
        [track_id]
    ).get(track_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Not analysed (yet): {track_id}")
    return t


class FitsBody(BaseModel):
    track: str
    #: Track ids to rank among; omitted means every analysed local track.
    pool: list[str] | None = None
    #: harmony safe|any, tempo near|any, mood up|down|same, energy lift|hold|ease, genre any|same|<name>.
    filters: dict[str, Any] = {}
    limit: int = Field(50, ge=1, le=500)
    exclude: list[str] = []


@router.post("/music/proximity/fits-after")
async def fits_after(body: FitsBody) -> dict[str, Any]:
    """Tracks that follow one track, best first, each with its explained join."""

    def run() -> list[dict[str, Any]]:
        pool = _pool(body.pool)
        return proximity.fits_after(
            _track(body.track, pool), pool, body.filters, body.limit, body.exclude
        )

    return {"track": body.track, "results": await asyncio.to_thread(run)}


class BridgeBody(BaseModel):
    a: str
    b: str
    pool: list[str] | None = None
    exclude: list[str] = []
    limit: int = Field(10, ge=1, le=100)
    #: Most in-between tracks a path may use (bridge-path only).
    steps: int = Field(3, ge=1, le=5)


@router.post("/music/proximity/bridges")
async def bridges(body: BridgeBody) -> dict[str, Any]:
    """Single tracks safe after a and before b, each with both joins."""

    def run() -> list[dict[str, Any]]:
        pool = _pool(body.pool)
        a, b = _track(body.a, pool), _track(body.b, pool)
        return proximity.bridges(a, b, pool, body.limit, body.exclude)

    return {"results": await asyncio.to_thread(run)}


@router.post("/music/proximity/bridge-path")
async def bridge_path(body: BridgeBody) -> dict[str, Any]:
    """The shortest safe chain of in-between track ids from a to b; ``path`` is null when none exists."""

    def run() -> list[str] | None:
        pool = _pool(body.pool)
        a, b = _track(body.a, pool), _track(body.b, pool)
        return proximity.bridge_path(a, b, pool, body.steps, body.exclude)

    return {"path": await asyncio.to_thread(run)}


@router.get("/music/proximity/join")
async def proximity_join(a: str = Query(...), b: str = Query(...)) -> dict[str, Any]:
    """The explained join from track a to track b."""
    return await asyncio.to_thread(lambda: proximity.join(_track(a, []), _track(b, [])))


@router.get("/music/set/presets")
async def set_presets() -> dict[str, Any]:
    """The ready-made arcs (energy 0..1, mood -3..3, genre segments) the set builder starts from."""
    return builder.PRESETS


class BuildBody(BaseModel):
    #: Arcs: ``energy`` and ``mood`` are evenly spaced points, ``genre`` is ``[{"g", "x1"}]``.
    arc: dict[str, Any] | None = None
    #: A name from ``/music/set/presets``, used when no ``arc`` is given.
    preset: str | None = None
    #: Wanted length in seconds.
    length: float = Field(..., gt=0, le=6 * 3600)
    #: "Try another" is a new seed; the same seed gives the same set.
    seed: int = 0
    #: A track the set opens with.
    start: str | None = None
    pool: list[str] | None = None
    skip: list[str] = []


@router.post("/music/set/build")
async def build_set(body: BuildBody) -> dict[str, Any]:
    """A set following the arcs: ``slots`` (id and join from the previous one), duration and flag counts."""
    arc = body.arc or builder.PRESETS.get(body.preset or "")
    if not arc or not arc.get("energy") or not arc.get("mood") or not arc.get("genre"):
        raise HTTPException(status_code=400, detail="Give an arc or a known preset")

    def run() -> dict[str, Any]:
        pool = _pool(body.pool)
        start = _track(body.start, pool) if body.start else None
        return builder.build_arc(pool, arc, body.length, body.seed, start, body.skip)

    return await asyncio.to_thread(run)


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
