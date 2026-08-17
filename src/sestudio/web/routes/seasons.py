from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio.sites import site_for

router = APIRouter()


@router.get("/season")
async def get_season(
    url: str, request: Request, lang: str = "vf", source: str | None = None
) -> dict[str, Any]:
    sites = request.app.state.sites
    try:
        site = site_for(sites, source, url)
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source}")

    try:
        page = await asyncio.to_thread(site.fetch_page, url, lang)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "season": page.season,
        "is_film": page.is_film,
        "available_langs": page.available_langs,
        "source": site.id,
        "provider_order": list(site.provider_order()),
        "episodes": [
            {
                "number": ep.number,
                "title": ep.title,
                "filename": ep.filename,
                "providers": list(ep.embed_urls.keys()),
                "embed_urls": ep.embed_urls,
                # Every language this episode exists in, not just the fetched
                # one; empty when the site cannot say. An episode with no
                # embeds but a non-empty list exists in another language only.
                "langs": ep.langs,
            }
            for ep in page.episodes
        ],
    }
