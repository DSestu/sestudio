from __future__ import annotations

import asyncio
import dataclasses
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio.config import load_config
from sestudio.sites import ContentSite

logger = logging.getLogger(__name__)

router = APIRouter()


# How long one site may take before it is reported as timed out. Its thread
# keeps running (threads can't be cancelled); the page just stops waiting.
SITE_TIMEOUT_S = 8.0


async def _search_site(site: ContentSite, q: str) -> tuple[list[Any], str, int]:
    """One site's cards, its status (ok / empty / failed / timeout) and the
    milliseconds it took."""
    start = time.monotonic()
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(site.search, q), SITE_TIMEOUT_S
        )
        status = "ok" if result else "empty"
    except TimeoutError:
        logger.warning(
            "Search timed out for site %s after %ss", site.id, SITE_TIMEOUT_S
        )
        result, status = [], "timeout"
    except Exception as exc:
        logger.warning("Search failed for site %s: %s", site.id, exc)
        result, status = [], "failed"
    return result, status, round((time.monotonic() - start) * 1000)


@router.get("/search")
async def search(q: str, request: Request, sites: str = "") -> dict[str, Any]:
    """Search every enabled site, or only `sites` (comma-separated ids, to retry
    one), and report how each fared; one site being down never kills the page."""
    registered: dict[str, ContentSite] = request.app.state.sites
    cfg = load_config()
    disabled = set(cfg.disabled_sites)
    wanted = set(filter(None, sites.split(",")))
    chosen = [
        s
        for sid, s in registered.items()
        if sid not in disabled and (not wanted or sid in wanted)
    ]
    # Results are appended per site, so ordering the sites is what puts the
    # preferred one's listings at the top.
    chosen.sort(key=lambda s: s.id != cfg.preferred_site)

    outcomes = await asyncio.gather(*(_search_site(site, q) for site in chosen))

    cards: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    for site, (result, status, ms) in zip(chosen, outcomes):
        cards.extend(dataclasses.asdict(c) for c in result)
        report.append(
            {
                "id": site.id,
                "name": site.display_name,
                "status": status,
                "count": len(result),
                "ms": ms,
            }
        )

    if report and all(r["status"] in ("failed", "timeout") for r in report):
        raise HTTPException(
            status_code=502,
            detail="; ".join(f"{r['id']}: {r['status']}" for r in report),
        )
    return {"cards": cards, "sources": report}


@router.get("/browse")
async def browse(request: Request) -> list[dict[str, Any]]:
    """Home rows straight from the enabled sites, for titles TMDB never lists."""
    registered: dict[str, ContentSite] = request.app.state.sites
    disabled = set(load_config().disabled_sites)
    sites = [s for sid, s in registered.items() if sid not in disabled]
    results = await asyncio.gather(
        *(asyncio.to_thread(site.browse) for site in sites),
        return_exceptions=True,
    )
    rows: list[dict[str, Any]] = []
    for site, result in zip(sites, results):
        if isinstance(result, BaseException):
            # Optional rows: a site being down just hides its own.
            logger.warning("Browse failed for site %s: %s", site.id, result)
            continue
        rows.extend(
            {
                "source": site.id,
                "title": row.title,
                "cards": [dataclasses.asdict(c) for c in row.cards],
            }
            for row in result
        )
    return rows
