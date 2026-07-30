from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from fstream_dl.providers.netu import NetuProvider
from fstream_dl.providers.uqload import UqloadProvider
from fstream_dl.providers.vidzy import VidzyProvider
from fstream_dl.web.routes import cast, downloads, search, seasons, settings, stream
from fstream_dl.web.worker import JobStore

_PROVIDERS = {
    "uqload": UqloadProvider(),
    "vidzy": VidzyProvider(),
    "netu": NetuProvider(),
}

# app.py lives at src/fstream_dl/web/app.py → 4 parents up = repo root
_REPO_ROOT = Path(__file__).parent.parent.parent.parent
_FRONTEND_DIST = _REPO_ROOT / "frontend" / "dist"


def create_app(live_domain: str | None = None) -> FastAPI:
    app = FastAPI(title="fstream-dl", docs_url="/api/docs")

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
    # The direct HTTP port uvicorn listens on. Cast devices fetch media over
    # plain HTTP on this port even when the UI is fronted by HTTPS (Caddy), so
    # it must be the real listen port, not whatever the browser connected to.
    app.state.http_port = 8080
    app.state.job_store = JobStore(provider_registry=_PROVIDERS)

    app.include_router(search.router, prefix="/api")
    app.include_router(seasons.router, prefix="/api")
    app.include_router(downloads.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(stream.router, prefix="/api")
    app.include_router(cast.router, prefix="/api")

    # Serve built frontend if available
    dist = _FRONTEND_DIST
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            return FileResponse(str(dist / "index.html"))

    return app
