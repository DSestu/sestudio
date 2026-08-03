from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from sestudio.providers.luluvid import LuluvidProvider
from sestudio.providers.netu import NetuProvider
from sestudio.providers.premium import PremiumProvider
from sestudio.providers.uqload import UqloadProvider
from sestudio.providers.vidzy import VidzyProvider
from sestudio.web.routes import (
    cast,
    downloads,
    library,
    search,
    seasons,
    settings,
    stream,
    tmdb,
)
from sestudio.web.worker import JobStore

_PROVIDERS = {
    "uqload": UqloadProvider(),
    "vidzy": VidzyProvider(),
    "premium": PremiumProvider(),
    "netu": NetuProvider(),
    "luluvid": LuluvidProvider(),
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


def create_app(live_domain: str | None = None) -> FastAPI:
    app = FastAPI(title="sestudio", docs_url="/api/docs")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],  # Vite dev server
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.live_domain = live_domain or "https://fstream.top"
    app.state.anime_domain = "https://french-manga.net"
    app.state.providers = _PROVIDERS
    app.state.proxy_secret = secrets.token_bytes(32)
    app.state.dlna_renderers = {}  # udn -> control location, populated by discovery
    app.state.dlna_dmr = None  # active DmrDevice for the current cast session
    app.state.dlna_title = ""
    # The direct HTTP port uvicorn listens on. Cast devices fetch media over
    # plain HTTP on this port even when the UI is fronted by HTTPS (Caddy), so
    # it must be the real listen port, not whatever the browser connected to.
    app.state.http_port = 8080
    app.state.job_store = JobStore(provider_registry=_PROVIDERS)

    app.include_router(search.router, prefix="/api")
    app.include_router(seasons.router, prefix="/api")
    app.include_router(downloads.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(library.router, prefix="/api")
    app.include_router(stream.router, prefix="/api")
    app.include_router(cast.router, prefix="/api")
    app.include_router(tmdb.router, prefix="/api")

    # Serve built frontend if available (installed static dir or source dist)
    dist = _frontend_dist()
    if dist is not None:
        app.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            return FileResponse(str(dist / "index.html"))

    return app
