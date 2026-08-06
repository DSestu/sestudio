from __future__ import annotations

import asyncio
import dataclasses
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio.config import load_config
from sestudio.sites import ContentSite

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/search")
async def search(q: str, request: Request) -> list[dict[str, Any]]:
    """Search every enabled site; one site being down never kills the page."""
    registered: dict[str, ContentSite] = request.app.state.sites
    cfg = load_config()
    disabled = set(cfg.disabled_sites)
    sites = [s for sid, s in registered.items() if sid not in disabled]
    if not sites:
        return []
    # Results are appended per site, so ordering the sites is what puts the
    # preferred one's listings at the top.
    sites.sort(key=lambda s: s.id != cfg.preferred_site)

    results = await asyncio.gather(
        *(asyncio.to_thread(site.search, q) for site in sites),
        return_exceptions=True,
    )

    cards: list[dict[str, Any]] = []
    errors: list[str] = []
    for site, result in zip(sites, results):
        if isinstance(result, BaseException):
            logger.warning("Search failed for site %s: %s", site.id, result)
            errors.append(f"{site.id}: {result}")
            continue
        cards.extend(dataclasses.asdict(c) for c in result)

    if errors and len(errors) == len(sites):
        raise HTTPException(status_code=502, detail="; ".join(errors))
    return cards
