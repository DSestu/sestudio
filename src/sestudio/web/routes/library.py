from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sestudio import library

router = APIRouter()

_LISTS = ("watchlist", "favourites")
_PREF_KEYS = ("player", "playlist_collapsed", "library_layout")


class PrefBody(BaseModel):
    value: Any


class CollectionRefBody(BaseModel):
    """One (list, key) pair. ``list`` on the wire, renamed to avoid shadowing
    the builtin."""

    list_name: str = Field(alias="list")
    key: str


class CollectionPutBody(CollectionRefBody):
    entry: dict[str, Any]


class WatchPutBody(BaseModel):
    key: str
    entry: dict[str, Any]


class BatchBody(BaseModel):
    watch_delete: list[str] = []
    watch_put: list[WatchPutBody] = []
    collections_delete: list[CollectionRefBody] = []
    collections_put: list[CollectionPutBody] = []


@router.get("/library")
async def get_library() -> dict[str, Any]:
    """The full library snapshot, for hydrating the client stores on load."""
    return await asyncio.to_thread(library.get_snapshot)


@router.put("/library/watch/{key:path}")
async def put_watch(key: str, entry: dict[str, Any]) -> dict[str, str]:
    """Upsert one watch entry (stored verbatim; last-write-wins by updatedAt)."""
    await asyncio.to_thread(library.upsert_watch, key, entry)
    return {"status": "ok"}


@router.delete("/library/watch/{key:path}")
async def delete_watch(key: str) -> dict[str, str]:
    await asyncio.to_thread(library.delete_watch, key)
    return {"status": "ok"}


@router.put("/library/collections/{list_name}/{key:path}")
async def put_collection(
    list_name: str, key: str, entry: dict[str, Any]
) -> dict[str, str]:
    if list_name not in _LISTS:
        raise HTTPException(status_code=400, detail=f"Unknown list: {list_name}")
    await asyncio.to_thread(library.upsert_collection, list_name, key, entry)
    return {"status": "ok"}


@router.delete("/library/collections/{list_name}/{key:path}")
async def delete_collection(list_name: str, key: str) -> dict[str, str]:
    if list_name not in _LISTS:
        raise HTTPException(status_code=400, detail=f"Unknown list: {list_name}")
    await asyncio.to_thread(library.delete_collection, list_name, key)
    return {"status": "ok"}


@router.post("/library/batch")
async def batch(body: BatchBody) -> dict[str, str]:
    """Apply many mutations at once, in one transaction.

    Used by batch selection in the library and by the one-time fold of legacy
    episode-level collection entries. List names are validated up front, so a
    bad request applies nothing.
    """
    for ref in (*body.collections_delete, *body.collections_put):
        if ref.list_name not in _LISTS:
            raise HTTPException(
                status_code=400, detail=f"Unknown list: {ref.list_name}"
            )
    await asyncio.to_thread(
        library.apply_batch,
        body.watch_delete,
        [(r.list_name, r.key) for r in body.collections_delete],
        [(p.list_name, p.key, p.entry) for p in body.collections_put],
        [(w.key, w.entry) for w in body.watch_put],
    )
    return {"status": "ok"}


@router.put("/library/preferences/{key}")
async def put_preference(key: str, body: PrefBody) -> dict[str, str]:
    if key not in _PREF_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown preference: {key}")
    await asyncio.to_thread(library.set_pref, key, body.value)
    return {"status": "ok"}


@router.post("/library/import")
async def import_library(payload: dict[str, Any]) -> dict[str, bool]:
    """One-time migration of a browser's localStorage. Idempotent: no-ops once
    the server already holds any data, so replaying it is harmless."""
    if not await asyncio.to_thread(library.is_empty):
        return {"imported": False}
    await asyncio.to_thread(library.import_bulk, payload)
    return {"imported": True}
