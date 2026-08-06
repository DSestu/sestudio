from __future__ import annotations

import dataclasses
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from sestudio.config import load_config, save_config, tmdb_key

router = APIRouter()


class SettingsBody(BaseModel):
    output_root: str | None = None
    lang: str | None = None
    download_destination: str | None = None
    tmdb_api_key: str | None = None
    tmdb_merge: bool | None = None
    tmdb_posters: bool | None = None
    disabled_sites: list[str] | None = None
    preferred_site: str | None = None


def _public(cfg) -> dict[str, Any]:
    """Settings for the client, with the API key replaced by a set/unset flag."""
    data = dataclasses.asdict(cfg)
    data.pop("tmdb_api_key", None)
    data["tmdb_configured"] = bool(tmdb_key())
    return data


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return _public(load_config())


@router.put("/settings")
async def put_settings(body: SettingsBody, request: Request) -> dict[str, Any]:
    cfg = load_config()
    if body.output_root is not None:
        cfg.output_root = body.output_root
    if body.lang is not None and body.lang in ("vf", "vostfr", "vo"):
        cfg.lang = body.lang
    if body.download_destination is not None and body.download_destination in (
        "server",
        "device",
    ):
        cfg.download_destination = body.download_destination
    if body.tmdb_api_key is not None:
        cfg.tmdb_api_key = body.tmdb_api_key.strip()
    if body.tmdb_merge is not None:
        cfg.tmdb_merge = body.tmdb_merge
    if body.tmdb_posters is not None:
        cfg.tmdb_posters = body.tmdb_posters
    known = set(request.app.state.sites)
    if body.disabled_sites is not None:
        # Only ids this build actually registers, so a stale client cannot
        # silently disable a site that no longer exists.
        cfg.disabled_sites = sorted(known.intersection(body.disabled_sites))
    if body.preferred_site is not None and body.preferred_site in known:
        cfg.preferred_site = body.preferred_site
    save_config(cfg)
    return _public(cfg)
