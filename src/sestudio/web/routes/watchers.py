from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from sestudio import library
from sestudio.watchers.models import (
    DEFAULT_INTERVALS,
    WATCHER_KINDS,
    Watcher,
    normalise_interval,
    validate_config,
)
from sestudio.watchers.poller import (
    initial_next_poll,
    maybe_auto_download,
    run_watcher,
)

router = APIRouter()


class WatcherCreateBody(BaseModel):
    kind: str
    config: dict[str, Any]
    label: str = ""
    auto_download: bool = False
    interval_seconds: int | None = None


class WatcherPatchBody(BaseModel):
    label: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None
    auto_download: bool | None = None
    interval_seconds: int | None = None


class MarkReadBody(BaseModel):
    ids: list[int] | None = None
    all: bool = False


@router.get("/watchers")
async def list_watchers() -> list[dict[str, Any]]:
    return await asyncio.to_thread(library.watcher_list)


@router.post("/watchers", status_code=201)
async def create_watcher(body: WatcherCreateBody) -> dict[str, Any]:
    if body.kind not in WATCHER_KINDS:
        raise HTTPException(
            status_code=400, detail=f"Unknown watcher kind: {body.kind}"
        )
    try:
        config = validate_config(body.kind, body.config)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    interval = normalise_interval(
        body.kind,
        body.interval_seconds
        if body.interval_seconds is not None
        else DEFAULT_INTERVALS.get(body.kind, 3600),
    )
    return await asyncio.to_thread(
        library.watcher_create,
        body.kind,
        config,
        label=body.label,
        auto_download=body.auto_download,
        interval_seconds=interval,
        # Jittered rather than immediate, so creating several watchers at once
        # does not fire them all in the same tick.
        next_poll_at=initial_next_poll(),
    )


@router.patch("/watchers/{watcher_id}")
async def patch_watcher(watcher_id: int, body: WatcherPatchBody) -> dict[str, Any]:
    existing = await asyncio.to_thread(library.watcher_get, watcher_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="No such watcher")

    updates: dict[str, Any] = {}
    if body.label is not None:
        updates["label"] = body.label
    if body.enabled is not None:
        updates["enabled"] = body.enabled
    if body.auto_download is not None:
        updates["auto_download"] = body.auto_download
    if body.interval_seconds is not None:
        updates["interval_seconds"] = normalise_interval(
            existing["kind"], body.interval_seconds
        )
    if body.config is not None:
        try:
            updates["config"] = validate_config(existing["kind"], body.config)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    updated = await asyncio.to_thread(library.watcher_update, watcher_id, **updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="No such watcher")
    return updated


@router.delete("/watchers/{watcher_id}")
async def delete_watcher(watcher_id: int) -> dict[str, str]:
    """Delete a watcher and its baseline. Its past events stay in the timeline."""
    removed = await asyncio.to_thread(library.watcher_delete, watcher_id)
    if not removed:
        raise HTTPException(status_code=404, detail="No such watcher")
    return {"status": "ok"}


@router.post("/watchers/{watcher_id}/poll")
async def poll_watcher(watcher_id: int, request: Request) -> dict[str, Any]:
    """Poll one watcher now.

    Goes through the same run_watcher() the background loop uses, so a manual
    check records failures and advances the schedule identically. A watcher that
    has never been polled records its baseline here and reports zero events —
    that is the intended behaviour, not an empty result.
    """
    row = await asyncio.to_thread(library.watcher_get, watcher_id)
    if row is None:
        raise HTTPException(status_code=404, detail="No such watcher")
    watcher = Watcher.from_row(row)
    outcome = await asyncio.to_thread(run_watcher, watcher, request.app.state.sites)
    # Same follow-up as a background tick, so "Check now" is not a weaker check.
    await maybe_auto_download(watcher, outcome, request.app)
    return {
        "events": outcome.events,
        "error": outcome.error,
        "failures": outcome.failures,
        "disabled": outcome.disabled,
    }


@router.get("/notifications")
async def list_notifications(
    limit: int = 50, offset: int = 0, unread_only: bool = False
) -> dict[str, Any]:
    events = await asyncio.to_thread(
        library.watcher_event_list,
        limit=min(max(limit, 1), 200),
        offset=max(offset, 0),
        unread_only=unread_only,
    )
    unread = await asyncio.to_thread(library.watcher_unread_count)
    return {"events": events, "unread": unread}


@router.get("/notifications/unread")
async def unread_notifications() -> dict[str, int]:
    return {"count": await asyncio.to_thread(library.watcher_unread_count)}


@router.post("/notifications/read")
async def mark_notifications_read(body: MarkReadBody) -> dict[str, int]:
    """Mark specific events read, or every unread one with ``all``."""
    if not body.all and body.ids is None:
        raise HTTPException(status_code=422, detail="Provide ids or all=true")
    marked = await asyncio.to_thread(
        library.watcher_mark_read, None if body.all else (body.ids or [])
    )
    unread = await asyncio.to_thread(library.watcher_unread_count)
    return {"marked": marked, "unread": unread}
