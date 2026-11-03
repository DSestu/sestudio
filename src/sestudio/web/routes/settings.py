from __future__ import annotations

import asyncio
import dataclasses
import os
import subprocess
import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from sestudio import interpolate, restart
from sestudio.web.routes import downloaded as downloaded_route
from sestudio.config import DEFAULT_DOWNLOAD_ORDER, load_config, save_config, tmdb_key
from sestudio.dlna import _local_ipv4s
from sestudio.downloader import js_runtime
from sestudio.logging_config import LOG_BUFFER

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
    allow_file_deletion: bool | None = None
    frame_interpolation: bool | None = None
    ai_max_hold: int | None = Field(default=None, ge=0, le=4)
    ytmusic_cookies: str | None = None
    station_fps: int | None = Field(default=None, ge=10, le=30)
    station_browser: str | None = None
    music_genre_model: bool | None = None


def _known_hosts(request: Request) -> list[str]:
    """Every host a download could use, preferred ones first.

    Sites that serve their own files resolve under their own id, so they belong
    on this list beside the third-party hosts — ranking is one chain, not two.
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
    # Libraries carry other servers' tokens, and the share tokens' hashes are not the client's either:
    # both are read through /music/libraries and /music/share-tokens.
    data.pop("music_libraries", None)
    data.pop("music_dismissed", None)
    data.pop("music_share_tokens", None)
    data["tmdb_configured"] = bool(tmdb_key())
    # Same treatment as the TMDB key: a secret the client sets but never reads
    # back. The phone number is not secret and stays, so the field can show what
    # it will message.
    data.pop("callmebot_apikey", None)
    data["callmebot_configured"] = bool(cfg.callmebot_apikey and cfg.callmebot_phone)
    # What the client can offer to rank, and what "reset" restores.
    data["known_hosts"] = _known_hosts(request)
    data["default_hosts"] = list(DEFAULT_DOWNLOAD_ORDER)
    # Empty when YouTube can't be extracted properly; Settings warns about it.
    data["js_runtime"] = js_runtime()
    # Unfinished pages (the music lab) show only on an instance started for them.
    data["lab"] = os.environ.get("SESTUDIO_LAB") == "1"
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
    if body.ytmusic_cookies is not None:
        cfg.ytmusic_cookies = body.ytmusic_cookies.strip().strip('"')
    if body.station_fps is not None:
        cfg.station_fps = body.station_fps
    if body.station_browser is not None:
        cfg.station_browser = body.station_browser.strip().strip('"')
    if body.music_genre_model is not None:
        cfg.music_genre_model = body.music_genre_model
    if body.allow_file_deletion is not None:
        cfg.allow_file_deletion = body.allow_file_deletion
    if body.frame_interpolation is not None:
        cfg.frame_interpolation = body.frame_interpolation
    if body.ai_max_hold is not None and body.ai_max_hold != cfg.ai_max_hold:
        cfg.ai_max_hold = body.ai_max_hold
        # Drawn with the old one: forgotten, so what plays is drawn again.
        for media in list(downloaded_route.DRAWN.built):
            downloaded_route.DRAWN.call_off(media)
    save_config(cfg)
    return _public(cfg, request)


@router.get("/settings/ai")
async def get_ai() -> dict[str, Any]:
    """Frame interpolation: on or off, its setup's progress, what it found."""
    return await asyncio.to_thread(interpolate.info)


@router.post("/settings/ai/setup")
async def post_ai_setup() -> dict[str, Any]:
    """Run the frame interpolation setup again, from scratch."""
    await asyncio.to_thread(interpolate.setup)
    return await asyncio.to_thread(interpolate.info)


# When the routes were loaded, at startup. Not psutil's create_time: it reads
# /proc/stat, which Android keeps from apps, and the Server log then gave 500.
_STARTED = time.time()


@router.get("/server/log")
async def get_server_log(after: int = 0) -> dict[str, Any]:
    """What the server logged since line *after* (0: all it still holds), and
    when it started (Unix seconds), for its uptime."""
    return {"lines": LOG_BUFFER.since(after), "started": _STARTED}


@router.get("/server/lan")
async def get_server_lan(request: Request, recheck: bool = False) -> dict[str, Any]:
    """Where phones and TVs reach the server now and what is in the way
    (``lan.state``; null until known, or when bound to one address), and
    whether the asking browser runs on this machine: a page there can always
    fall back to localhost when the LAN address moves. *recheck* checks again
    first, after a firewall change say."""
    state = request.app.state
    if recheck and getattr(state, "lan", None) is not None:
        state.lan = await asyncio.to_thread(state.lan_check)
    client = request.client.host if request.client else ""
    here = (
        client.startswith("127.")
        or client == "::1"
        or client in await asyncio.to_thread(_local_ipv4s)
    )
    return {"lan": getattr(request.app.state, "lan", None), "here": here}


@router.get("/server")
async def get_server() -> dict[str, str]:
    """How a restart would start the server again, and the command it would run
    (see ``restart.command``)."""
    argv, how, _cwd = await asyncio.to_thread(restart.command)
    return {"restart": how, "command": subprocess.list2cmdline(argv)}


@router.post("/server/restart")
async def restart_server(request: Request) -> dict[str, str]:
    """Start the server again on newer code: the checkout's as it is now, or
    the latest release through uvx. The next one is started first and waits
    for this one to let go of its ports; this one stops once it has answered."""
    servers = getattr(request.app.state, "servers", None)
    if not servers:
        raise HTTPException(status_code=409, detail="Not started by `sestudio`")
    how = await asyncio.to_thread(restart.spawn)

    def stop() -> None:
        request.app.state.restarting = True
        for server in servers:
            server.should_exit = True
        # A TV's stream never ends and a segment being drawn can take minutes:
        # past a few seconds, out regardless, so the next one can start.
        threading.Timer(10, os._exit, (0,)).start()

    # After this answer has gone out.
    asyncio.get_running_loop().call_later(0.5, stop)
    return {"restart": how}
