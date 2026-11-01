from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio.sites.base import SiteError
from sestudio.sites.creators import _YtDlpSite

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
