from __future__ import annotations

import asyncio
import dataclasses
from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import APIRouter, HTTPException, Request

from sestudio import tmdb
from sestudio.catalogs import Catalog
from sestudio.config import load_config
from sestudio.sites import SiteError

router = APIRouter()

T = TypeVar("T")


def _enabled(request: Request) -> dict[str, Catalog]:
    """The catalogues that can answer now: a disabled site's is hidden with it,
    and TMDB's needs an API key."""
    disabled = set(load_config().disabled_sites)
    return {
        cid: cat
        for cid, cat in request.app.state.catalogs.items()
        if cid not in disabled and cat.available()
    }


def _catalog(request: Request, catalog_id: str) -> Catalog:
    cat = _enabled(request).get(catalog_id)
    if cat is None:
        raise HTTPException(status_code=404, detail=f"Unknown catalogue: {catalog_id}")
    return cat


def _values(request: Request) -> dict[str, str]:
    return {k: v for k, v in request.query_params.items() if k != "page"}


async def _call(fn: Callable[..., T], *args: Any) -> T:
    try:
        return await asyncio.to_thread(fn, *args)
    except tmdb.TmdbDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/catalogs")
async def list_catalogs(request: Request) -> list[dict[str, str]]:
    """The catalogues to browse, in the order the UI lists them."""
    return [
        {
            "id": cid,
            "label": cat.label,
            "description": cat.description,
            "url": cat.home_url,
        }
        for cid, cat in _enabled(request).items()
    ]


@router.get("/catalogs/{catalog_id}/schema")
async def catalog_schema(catalog_id: str, request: Request) -> list[dict[str, Any]]:
    """The catalogue's filters for the current values (query string)."""
    cat = _catalog(request, catalog_id)
    fields = await _call(cat.schema, _values(request))
    return [dataclasses.asdict(f) for f in fields]


@router.get("/catalogs/{catalog_id}/shelves")
async def catalog_shelves(catalog_id: str, request: Request) -> list[dict[str, Any]]:
    return await _call(_catalog(request, catalog_id).shelves)


@router.get("/catalogs/{catalog_id}/discover")
async def catalog_discover(
    catalog_id: str, request: Request, page: int = 1
) -> dict[str, Any]:
    """One page of the catalogue under the filters in the query string."""
    cat = _catalog(request, catalog_id)
    return await _call(cat.discover, _values(request), max(1, page))
