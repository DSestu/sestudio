from __future__ import annotations

from typing import Any

import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from sestudio.config import load_config

router = APIRouter()


@router.get("/sites")
async def list_sites(request: Request) -> list[dict[str, Any]]:
    """The registered content sites, so the UI can offer one toggle per source."""
    disabled = set(load_config().disabled_sites)
    return [
        {
            "id": site.id,
            "display_name": site.display_name,
            "url": site.home_url,
            "is_anime": site.is_anime,
            "enabled": site.id not in disabled,
        }
        for site in request.app.state.sites.values()
    ]


@router.get("/sites/{site_id}/open")
async def open_on_site(site_id: str, url: str, request: Request) -> RedirectResponse:
    """Send the browser to a title's page on its own site."""
    site = request.app.state.sites.get(site_id)
    # Only the site's own pages: this must not redirect anywhere it's told to.
    if site is None or not site.owns_url(url):
        raise HTTPException(status_code=404, detail="Not a page of this site")
    return RedirectResponse(await asyncio.to_thread(site.web_url, url))
