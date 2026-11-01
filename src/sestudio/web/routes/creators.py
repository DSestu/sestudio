from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio import library
from sestudio.sites.base import SiteError
from sestudio.sites.creators import _YtDlpSite, twitch_live

router = APIRouter()


def _creator_site(request: Request, url: str) -> _YtDlpSite:
    for site in request.app.state.sites.values():
        if isinstance(site, _YtDlpSite) and site.owns_url(url):
            return site
    raise HTTPException(status_code=400, detail="Not a YouTube or Twitch link")


@router.get("/link")
async def get_link(url: str, request: Request) -> dict[str, Any]:
    """What a pasted YouTube or Twitch link points at, for its card."""
    site = _creator_site(request, url)
    try:
        return await asyncio.to_thread(site.video, url)
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/channel")
async def get_channel(url: str, request: Request) -> dict[str, Any]:
    """A YouTube or Twitch channel and its latest videos."""
    site = _creator_site(request, url)
    try:
        return await asyncio.to_thread(site.channel, url)
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/live")
async def get_live() -> list[dict[str, Any]]:
    """The followed channels live now (Twitch; YouTube has no cheap live check)."""
    logins = [
        str(w["config"].get("channel_url") or "").rstrip("/").rsplit("/", 1)[-1].lower()
        for w in await asyncio.to_thread(library.watcher_list)
        if w["kind"] == "channel" and w["config"].get("source") == "twitch"
    ]
    try:
        return await asyncio.to_thread(
            twitch_live, [login for login in logins if login]
        )
    except SiteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
