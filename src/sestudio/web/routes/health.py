from __future__ import annotations

import asyncio
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from sestudio import library
from sestudio.config import load_config
from sestudio.http_client import BROWSER_UA, new_client

router = APIRouter()

# Home asks on every visit; the sites shouldn't hear from us that often.
SITE_TTL_SECONDS = 600
PROBE_TIMEOUT_SECONDS = 5
LOW_DISK_BYTES = 10 * 10**9
LOW_DISK_RATIO = 0.05


def _iso(ts: float | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts, UTC).isoformat()


def _probe(url: str) -> str | None:
    """Fetch a site's front page; None when it answered, else why not.

    A 4xx still counts as up: a Cloudflare challenge or a bot 403 means the
    site is there, and the scrapers deal with those on their own.
    """
    try:
        with new_client(
            timeout=PROBE_TIMEOUT_SECONDS, headers={"User-Agent": BROWSER_UA}
        ) as client:
            status = client.get(url).status_code
    except Exception as exc:
        return str(exc) or type(exc).__name__
    return f"HTTP {status}" if status >= 500 else None


async def _check_site(request: Request, site: Any) -> dict[str, Any]:
    now = time.time()
    error = await asyncio.to_thread(_probe, site.home_url)
    entry = {
        "id": site.id,
        "label": site.display_name,
        "up": error is None,
        "checked_at": _iso(now),
        "error": error,
    }
    request.app.state.site_health[site.id] = (time.monotonic(), entry)
    return entry


async def _sites(request: Request) -> list[dict[str, Any]]:
    disabled = set(load_config().disabled_sites)
    cache = request.app.state.site_health
    sites = [
        s
        for s in request.app.state.sites.values()
        if s.id not in disabled and s.home_url
    ]

    async def one(site: Any) -> dict[str, Any]:
        hit = cache.get(site.id)
        if hit and time.monotonic() - hit[0] < SITE_TTL_SECONDS:
            return hit[1]
        return await _check_site(request, site)

    return list(await asyncio.gather(*(one(s) for s in sites)))


def _watchers() -> dict[str, Any]:
    watchers = [w for w in library.watcher_list() if w["enabled"]]
    polled = [w["last_polled_at"] for w in watchers if w["last_polled_at"]]
    return {
        "count": len(watchers),
        "last_run_at": _iso(max(polled)) if polled else None,
        "failing": [
            {
                "id": w["id"],
                "label": w["label"]
                or w["config"].get("series_name")
                or w["config"].get("name")
                or f"#{w['id']}",
                "error": w["last_error"],
                # The table keeps no first-failure time; the last failed poll
                # is the closest it can tell.
                "since": _iso(w["last_polled_at"]),
            }
            for w in watchers
            if w["last_error"]
        ],
    }


def _disk(output_root: str) -> dict[str, Any]:
    path = Path(output_root).resolve()
    # Not created until the first download; its drive is what fills up anyway.
    while not path.exists() and path != path.parent:
        path = path.parent
    try:
        usage = shutil.disk_usage(path)
    except OSError as exc:  # an unmounted or inaccessible drive
        return {
            "path": str(path),
            "free_bytes": None,
            "total_bytes": None,
            "low": False,
            "error": str(exc) or type(exc).__name__,
        }
    return {
        "path": str(path),
        "free_bytes": usage.free,
        "total_bytes": usage.total,
        "low": usage.free < LOW_DISK_BYTES or usage.free < usage.total * LOW_DISK_RATIO,
    }


@router.get("/health")
async def get_health(request: Request) -> dict[str, Any]:
    """What Home's Health widget and footer line show: sites up, watchers
    failing, disk free, and the issues among them, worst first."""
    sites = await _sites(request)
    watchers = await asyncio.to_thread(_watchers)
    disk = await asyncio.to_thread(_disk, load_config().output_root)

    # Worst first: a full disk fails every download, a site down fails
    # everything on it, a failing watcher is often just its site being down.
    issues: list[dict[str, Any]] = []
    if "error" in disk:
        issues.append(
            {
                "kind": "disk",
                "id": None,
                "message": "Downloads folder unavailable",
                "retry": None,
            }
        )
    if disk["low"]:
        issues.append(
            {
                "kind": "disk",
                "id": None,
                "message": f"Disk almost full: {disk['free_bytes'] // 10**9} GB free",
                "retry": None,
            }
        )
    issues += [
        {
            "kind": "site",
            "id": s["id"],
            "message": f"{s['label']} is down",
            "retry": "site",
        }
        for s in sites
        if not s["up"]
    ]
    issues += [
        {
            "kind": "watcher",
            "id": str(w["id"]),
            "message": f"Watcher '{w['label']}' failed",
            "retry": "watcher",
        }
        for w in watchers["failing"]
    ]
    return {
        "ok": not issues,
        "checked_at": _iso(time.time()),
        "sites": sites,
        "watchers": watchers,
        "disk": disk,
        "issues": issues,
    }


@router.post("/health/sites/{site_id}/retry")
async def retry_site(site_id: str, request: Request) -> dict[str, Any]:
    """Probe one site now, past the cache: the Health widget's Retry."""
    site = request.app.state.sites.get(site_id)
    if site is None or not site.home_url:
        raise HTTPException(status_code=404, detail="Unknown site")
    return await _check_site(request, site)
