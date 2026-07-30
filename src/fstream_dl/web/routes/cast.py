from __future__ import annotations

import logging
import socket
import urllib.parse
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from fstream_dl import dlna

logger = logging.getLogger(__name__)

router = APIRouter()

_MIME_BY_KIND = {"mp4": "video/mp4", "hls": "application/vnd.apple.mpegurl"}


def _local_ip_for(host: str) -> str:
    """Return this host's IP on the interface that routes to *host*.

    The renderer fetches the stream itself, so it must be handed our LAN IP —
    not whatever the browser used (often localhost, which points the TV at
    itself and yields UPnP 716 "Resource not found").
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect((host, 80))
        return sock.getsockname()[0]
    finally:
        sock.close()


@router.get("/tls-permission")
async def tls_permission() -> Response:
    """Allow-any permission endpoint for Caddy's on-demand TLS (see start.bat).

    Caddy calls this before minting a self-signed cert for whatever host/IP a
    client connects by, so the HTTPS front works over a port-forward regardless
    of the address used. This is a trusted single-user LAN tool, so any host is
    allowed (a 200 response means "issue the cert").
    """
    return Response(status_code=200)


@router.get("/cast/http-port")
async def http_port(request: Request) -> dict[str, int]:
    """The direct HTTP port cast devices should fetch media on (see app.state.http_port).

    Used by the browser to build a plain-HTTP media URL for Chromecast even when
    the UI itself is served over HTTPS (Caddy) — Chromecast can't verify a local
    CA, so the media must not go through the HTTPS proxy.
    """
    return {"http_port": request.app.state.http_port}


@router.get("/cast/dlna/renderers")
async def list_renderers(request: Request) -> list[dict[str, str]]:
    """Discover DLNA renderers and cache their control locations for /play."""
    renderers = await dlna.discover_renderers()
    request.app.state.dlna_renderers = {r["udn"]: r["location"] for r in renderers}
    return [{"name": r["name"], "udn": r["udn"]} for r in renderers]


class DlnaPlayRequest(BaseModel):
    renderer_udn: str
    proxy_url: str
    kind: str = "mp4"
    title: str = "fstream-dl"


@router.post("/cast/dlna/play")
async def dlna_play(body: DlnaPlayRequest, request: Request) -> dict[str, Any]:
    """Push a (proxied) stream URL to a previously discovered renderer."""
    renderers: dict[str, str] = getattr(request.app.state, "dlna_renderers", {})
    location = renderers.get(body.renderer_udn)
    if location is None:
        raise HTTPException(status_code=404, detail="Unknown renderer — re-scan and try again")

    # The renderer fetches the stream itself, so build an absolute HTTP URL on
    # our LAN IP facing the renderer (browsing via localhost would otherwise
    # point the TV at itself). DLNA is plain HTTP on the direct server port.
    renderer_host = urllib.parse.urlparse(location).hostname or ""
    lan_ip = _local_ip_for(renderer_host)
    port = request.app.state.http_port
    media_url = f"http://{lan_ip}:{port}{body.proxy_url}"
    mime_type = _MIME_BY_KIND.get(body.kind, "video/mp4")

    try:
        await dlna.play_on_renderer(location, media_url, body.title, mime_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DLNA play failed: {exc}") from exc
    return {"status": "playing", "renderer": body.renderer_udn, "media_url": media_url}
