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


@router.get("/tmdb/suggest")
async def suggest(q: str) -> dict[str, Any] | None:
    """The title a mistyped search most likely meant ("dnue" → Dune), or null."""
    try:
        return await asyncio.to_thread(tmdb.suggest, q)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
