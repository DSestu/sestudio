"""Music analysis: what the player draws and syncs from (SPEC-music.md §11, PR 3)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from sestudio.music import runner, store

router = APIRouter()


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
    return await asyncio.to_thread(store.get, wanted)


@router.get("/music/tracks/{track_id}/analysis")
async def track_analysis(track_id: str) -> dict[str, Any]:
    found = await asyncio.to_thread(store.get, [track_id])
    if track_id not in found:
        raise HTTPException(status_code=404, detail="Not analysed (yet)")
    return found[track_id]
