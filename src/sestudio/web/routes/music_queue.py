"""The server-side music queue and its change feed (SPEC-music §6).

Mutations take the revision the client last saw as ``If-Match`` (or ``?rev=``)
and answer 409 with the current state when it is stale. Every change is pushed
on ``/queue/events`` as a Server-Sent Event named after the op.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from sestudio import downloaded
from sestudio.music import libraries, online, queue, runner, store
from sestudio.sites import SiteError

router = APIRouter(prefix="/music/queue")

PING_SECONDS = 15.0


class TrackRef(BaseModel):
    library: str = downloaded.LOCAL_LIBRARY
    track_id: str
    # Streamed tracks carry what the queue shows; a bare one is looked up.
    source: str | None = None
    title: str | None = None
    artist: str | None = None
    duration: float | None = None


class AddBody(BaseModel):
    tracks: list[TrackRef]
    index: int | None = None
    play_now: bool = False
    replace: bool = False
    # With replace: the index of the track to start at.
    start: int = 0


class MoveBody(BaseModel):
    item_id: str
    to: int


class OrderBody(BaseModel):
    item_ids: list[str]


class PlayBody(BaseModel):
    item_id: str
    position: float | None = Field(default=None, ge=0)


class TransportBody(BaseModel):
    action: Literal["play", "pause", "seek", "next", "prev", "repeat"]
    position: float | None = Field(default=None, ge=0)
    repeat: bool | None = None


class MixBody(BaseModel):
    mode: str = "sync"
    bars: int = 8
    tempo: bool = True
    swap: bool = True
    nudge: int = 0


class DefaultMixBody(BaseModel):
    mode: str


def _known_tracks() -> set[tuple[str, str]]:
    return libraries.known_tracks()


def _rev(if_match: str | None, rev: int | None) -> int | None:
    raw = if_match.strip().removeprefix("W/").strip('"') if if_match else rev
    try:
        return None if raw is None else int(raw)
    except ValueError:
        raise HTTPException(400, "If-Match must be a revision number") from None


def _run(fn: Callable[[], dict[str, Any]]) -> Any:
    try:
        return fn()
    except queue.StaleRev:
        return JSONResponse(queue.get_state(), status_code=409)
    except queue.Invalid as exc:
        raise HTTPException(400, str(exc)) from None


def _online_item(ref: dict[str, Any]) -> dict[str, Any]:
    try:
        return online.complete(ref)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None
    except SiteError as exc:
        raise HTTPException(502, str(exc)) from None


def _check_tracks(pairs: list[tuple[str, str]]) -> None:
    known = _known_tracks()
    missing = [t for lib, t in pairs if (lib, t) not in known]
    if missing:
        raise HTTPException(404, f"unknown tracks: {', '.join(missing)}")


@router.get("")
def get_queue() -> dict[str, Any]:
    return queue.get_state()


@router.post("")
def add_tracks(
    body: AddBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    local = [t for t in body.tracks if t.library != online.ONLINE_LIBRARY]
    _check_tracks([(t.library, t.track_id) for t in local])
    refs = [
        _online_item(t.model_dump(exclude_none=True))
        if t.library == online.ONLINE_LIBRARY
        else {"library": t.library, "track_id": t.track_id}
        for t in body.tracks
    ]
    # Analysed now rather than when first played, so the timeline draws them before they play.
    # A local file the runner has not reached yet shows as being analysed until it does.
    known = store.stamps()
    for t in body.tracks:
        if t.library == online.ONLINE_LIBRARY:
            online.kick_analysis(t.track_id)
        elif (
            runner.enabled()
            and t.track_id not in known
            and not libraries.split_remote(t.track_id)
        ):
            store.set_partial(t.track_id)
    return _run(
        lambda: queue.add(
            refs,
            body.index,
            body.play_now,
            body.replace,
            _rev(if_match, rev),
            body.start,
        )
    )


@router.delete("/{item_id}")
def remove_item(
    item_id: str,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    return _run(lambda: queue.remove(item_id, _rev(if_match, rev)))


@router.post("/move")
def move_item(
    body: MoveBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    return _run(lambda: queue.move(body.item_id, body.to, _rev(if_match, rev)))


@router.post("/order")
def order_items(
    body: OrderBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    return _run(lambda: queue.order(body.item_ids, _rev(if_match, rev)))


@router.post("/play")
def play_item(
    body: PlayBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    return _run(lambda: queue.play(body.item_id, body.position, _rev(if_match, rev)))


@router.post("/transport")
def transport(
    body: TransportBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    return _run(
        lambda: queue.transport(
            body.action, body.position, body.repeat, _rev(if_match, rev)
        )
    )


@router.put("/mix/default")
def put_default_mix(
    body: DefaultMixBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    return _run(lambda: queue.set_default_mix(body.mode, _rev(if_match, rev)))


@router.put("/mix/{from_track}/{to_track}")
def put_mix(
    from_track: str,
    to_track: str,
    body: MixBody,
    if_match: str | None = Header(default=None),
    rev: int | None = Query(default=None),
) -> Any:
    known = {t for _, t in _known_tracks()}
    missing = [
        t
        for t in (from_track, to_track)
        if online.video_id(t) is None and t not in known
    ]
    if missing:
        raise HTTPException(404, f"unknown tracks: {', '.join(missing)}")
    return _run(
        lambda: queue.set_mix(
            from_track, to_track, body.model_dump(), _rev(if_match, rev)
        )
    )


def _sse(event: str, data: dict[str, Any], rev: int | None = None) -> str:
    head = f"id: {rev}\n" if rev is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data)}\n\n"


async def event_stream(
    is_disconnected: Callable[[], Awaitable[bool]], ping: float = PING_SECONDS
) -> AsyncIterator[str]:
    """The snapshot, then one event per change, with a comment ping when idle.

    Subscribing before the snapshot means a change made in between is queued,
    and ones the snapshot already contains are dropped by revision.
    """
    sub = queue.subscribe()
    try:
        state = await asyncio.to_thread(queue.get_state)
        yield _sse("state", state, state["rev"])
        seen = state["rev"]
        while True:
            try:
                event = await asyncio.wait_for(sub[1].get(), ping)
            except asyncio.TimeoutError:
                if await is_disconnected():
                    return
                yield ": ping\n\n"
                continue
            if event["op"] in (
                "station",
                "volume",
            ):  # signals, not changes: no revision
                yield _sse(event["op"], event)
            elif event["rev"] > seen:
                seen = event["rev"]
                yield _sse(event["op"], event, event["rev"])
    finally:
        queue.unsubscribe(sub)


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    return StreamingResponse(
        event_stream(request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
