from __future__ import annotations

import asyncio
import dataclasses
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio.scraper import search_seasons

router = APIRouter()


@router.get("/search")
async def search(q: str, request: Request) -> list[dict[str, Any]]:
    live_domain: str = request.app.state.live_domain
    anime_domain: str = request.app.state.anime_domain
    try:
        cards = await asyncio.to_thread(search_seasons, q, live_domain, anime_domain)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [dataclasses.asdict(c) for c in cards]
