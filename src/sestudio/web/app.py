from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from sestudio.providers.filmoon import FilmoonProvider
from sestudio.providers.luluvid import LuluvidProvider
from sestudio.providers.netu import NetuProvider
from sestudio.providers.premium import PremiumProvider
from sestudio.providers.uqload import UqloadProvider
from sestudio.providers.vidzy import VidzyProvider
from sestudio.providers.voe import VoeProvider
from sestudio.sites import build_sites
from sestudio.web.routes import (
    cast,
    downloads,
    library,
    downloaded,
    search,
    seasons,
    settings,
    sites,
    stream,
    tmdb,
)
from sestudio.web.worker import JobStore

logger = logging.getLogger(__name__)

# How often the rotating site domains are re-resolved while the server runs.
SITE_REFRESH_SECONDS = 900

_PROVIDERS = {
    "uqload": UqloadProvider(),
    "vidzy": VidzyProvider(),
    "premium": PremiumProvider(),
    "netu": NetuProvider(),
    "luluvid": LuluvidProvider(),
    "filmoon": FilmoonProvider(),
    "voe": VoeProvider(),
}

# An installed wheel bundles the built frontend at sestudio/web/static (via
# force-include); a source checkout has no such dir and uses frontend/dist at
# the repo root (app.py is 4 parents deep) instead.
_MODULE_STATIC = Path(__file__).parent / "static"
_REPO_DIST = Path(__file__).parent.parent.parent.parent / "frontend" / "dist"


def _frontend_dist() -> Path | None:
    for candidate in (_MODULE_STATIC, _REPO_DIST):
        if candidate.exists():
            return candidate
    return None


async def _refresh_sites(app: FastAPI) -> None:
    """Re-resolve every site's rotating domain, tolerating failures."""
    sites = list(app.state.sites.values())
    results = await asyncio.gather(
        *(asyncio.to_thread(site.refresh) for site in sites),
        return_exceptions=True,
    )
    for site, result in zip(sites, results):
        if isinstance(result, BaseException):
            logger.warning("Could not refresh site %s: %s", site.id, result)


async def _refresh_loop(app: FastAPI) -> None:
    while True:
        await asyncio.sleep(SITE_REFRESH_SECONDS)
        await _refresh_sites(app)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Resolve rotating domains up front, then keep them fresh.

    Senpai moves to a new TLD often enough that resolving once per process is
    not enough on a server left running for days. Doing it at startup also
    means the first search does not pay for the lookup.

    Startup is not blocked by a failure: a site that cannot be reached now
    falls back to resolving on demand.
    """
    await _refresh_sites(app)
    task = asyncio.create_task(_refresh_loop(app))
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app(live_domain: str | None = None) -> FastAPI:
    app = FastAPI(title="sestudio", docs_url="/api/docs", lifespan=_lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],  # Vite dev server
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.sites = build_sites(live_domain)
    app.state.providers = _PROVIDERS
    app.state.proxy_secret = secrets.token_bytes(32)
    app.state.dlna_renderers = {}  # udn -> control location, populated by discovery
    app.state.dlna_dmr = None  # active DmrDevice for the current cast session
    app.state.dlna_title = ""
    # The direct HTTP port uvicorn listens on. Cast devices fetch media over
    # plain HTTP on this port even when the UI is fronted by HTTPS (Caddy), so
    # it must be the real listen port, not whatever the browser connected to.
    app.state.http_port = 8080
    app.state.job_store = JobStore(provider_registry=_PROVIDERS, sites=app.state.sites)

    app.include_router(search.router, prefix="/api")
    app.include_router(seasons.router, prefix="/api")
    app.include_router(downloads.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(library.router, prefix="/api")
    app.include_router(downloaded.router, prefix="/api")
    app.include_router(stream.router, prefix="/api")
    app.include_router(cast.router, prefix="/api")
    app.include_router(tmdb.router, prefix="/api")
    app.include_router(sites.router, prefix="/api")

    # Serve built frontend if available (installed static dir or source dist)
    dist = _frontend_dist()
    if dist is not None:
        app.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            return FileResponse(str(dist / "index.html"))

    return app
