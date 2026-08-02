from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from sestudio import tmdb

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/tmdb/enrich")
async def enrich(
    title: str, year: int = 0, is_film: bool = False
) -> dict[str, Any] | None:
    """Metadata for a title, or null when TMDB has no match.

    Null (rather than a 404) keeps the client simple: enrichment is optional
    polish, so "no match" and "matched" take the same code path.
    """
    try:
        return await asyncio.to_thread(tmdb.enrich, title, year, is_film)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/tmdb/trending")
async def trending() -> list[dict[str, Any]]:
    """Trending titles this week, for the home screen browse row."""
    try:
        return await asyncio.to_thread(tmdb.catalog)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
