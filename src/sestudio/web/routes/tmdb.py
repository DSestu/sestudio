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


@router.get("/tmdb/discover")
async def discover(
    kind: str = "movie",
    sort_by: str = "popularity.desc",
    genres: str = "",
    min_score: float = 0.0,
    max_score: float = 10.0,
    min_votes: int = 0,
    page: int = 1,
) -> dict[str, Any]:
    """Browse the catalogue with the TMDB site's own sort/filter options."""
    try:
        return await asyncio.to_thread(
            tmdb.discover, kind, sort_by, genres, min_score, max_score, min_votes, page
        )
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/tmdb/genres")
async def genre_list(kind: str = "movie") -> list[dict[str, Any]]:
    """Genre ids and names, for the discover filter chips."""
    try:
        return await asyncio.to_thread(tmdb.genres, kind)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/tmdb/people")
async def people(q: str) -> list[dict[str, Any]]:
    """People matching a name, for the search view's People section."""
    try:
        return await asyncio.to_thread(tmdb.search_people, q)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/tmdb/person/{person_id}")
async def person(person_id: int) -> dict[str, Any] | None:
    """A person's profile and filmography, or null when TMDB has no match."""
    try:
        return await asyncio.to_thread(tmdb.person, person_id)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
