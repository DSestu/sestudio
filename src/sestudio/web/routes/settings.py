from __future__ import annotations

import dataclasses
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from sestudio.config import DEFAULT_DOWNLOAD_ORDER, load_config, save_config, tmdb_key

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
    autoplay_on_open: bool | None = None
    preferred_hosts: list[str] | None = None
    preferred_sites: list[str] | None = None
    collapse_seasons: bool | None = None
    watcher_max_concurrent: int | None = None
    notifications_enabled: bool | None = None
    callmebot_phone: str | None = None
    callmebot_apikey: str | None = None


def _known_hosts(request: Request) -> list[str]:
    """Every host a download could use, preferred ones first.

    Sites that serve their own files (senpai) resolve under their own id, so
    they belong on this list beside the third-party hosts — ranking is one
    chain, not two.
    """
    hosts = set(request.app.state.providers)
    for site in request.app.state.sites.values():
        hosts.update(site.provider_order())
    ranked = [h for h in DEFAULT_DOWNLOAD_ORDER if h in hosts]
    return ranked + sorted(hosts - set(ranked))


def _public(cfg, request: Request) -> dict[str, Any]:
    """Settings for the client, with the API key replaced by a set/unset flag."""
    data = dataclasses.asdict(cfg)
    data.pop("tmdb_api_key", None)
    data["tmdb_configured"] = bool(tmdb_key())
    # Same treatment as the TMDB key: a secret the client sets but never reads
    # back. The phone number is not secret and stays, so the field can show what
    # it will message.
    data.pop("callmebot_apikey", None)
    data["callmebot_configured"] = bool(cfg.callmebot_apikey and cfg.callmebot_phone)
    # What the client can offer to rank, and what "reset" restores.
    data["known_hosts"] = _known_hosts(request)
    data["default_hosts"] = list(DEFAULT_DOWNLOAD_ORDER)
    return data


@router.get("/settings")
async def get_settings(request: Request) -> dict[str, Any]:
    return _public(load_config(), request)


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
    if body.autoplay_on_open is not None:
        cfg.autoplay_on_open = body.autoplay_on_open
    if body.collapse_seasons is not None:
        cfg.collapse_seasons = body.collapse_seasons
    if body.preferred_hosts is not None:
        # Order is the whole content here, so it is stored as sent — deduped,
        # since a host listed twice would only confuse the fallback chain.
        cfg.preferred_hosts = list(dict.fromkeys(body.preferred_hosts))
    known = set(request.app.state.sites)
    if body.preferred_sites is not None:
        # Unlike hosts, sites are a closed set this build knows, so a stale
        # client cannot rank one that no longer exists.
        cfg.preferred_sites = [
            s for s in dict.fromkeys(body.preferred_sites) if s in known
        ]
    if body.disabled_sites is not None:
        # Only ids this build actually registers, so a stale client cannot
        # silently disable a site that no longer exists.
        cfg.disabled_sites = sorted(known.intersection(body.disabled_sites))
    if body.preferred_site is not None and body.preferred_site in known:
        cfg.preferred_site = body.preferred_site
    if body.watcher_max_concurrent is not None:
        # Clamped rather than rejected: the point of the lane is that background
        # work stays a small fraction of the pool, so an unbounded value would
        # defeat it. Applied to the live store too, so it takes effect now
        # instead of at the next restart.
        cfg.watcher_max_concurrent = max(1, min(8, body.watcher_max_concurrent))
        request.app.state.job_store.set_lane_limit(cfg.watcher_max_concurrent)
    if body.notifications_enabled is not None:
        cfg.notifications_enabled = body.notifications_enabled
    if body.callmebot_phone is not None:
        # Digits only, so a pasted "+33 6 12..." still works. CallMeBot wants the
        # international form without the plus.
        cfg.callmebot_phone = "".join(ch for ch in body.callmebot_phone if ch.isdigit())
    if body.callmebot_apikey is not None:
        cfg.callmebot_apikey = body.callmebot_apikey.strip()
    save_config(cfg)
    return _public(cfg, request)
