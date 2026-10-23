from __future__ import annotations

import asyncio
import datetime
import logging
import socket
import urllib.parse
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from sestudio import dlna, downloaded
from sestudio.web.routes.downloaded import _resolved
from sestudio.web.routes.stream import transcode_source

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
async def http_port(request: Request) -> dict[str, int | None]:
    """The direct HTTP port cast devices should fetch media on (see app.state.http_port).

    Used by the browser to build a plain-HTTP media URL for Chromecast even when
    the UI itself is served over HTTPS (Caddy) — Chromecast can't verify a local
    CA, so the media must not go through the HTTPS proxy.

    ``null`` when there is no HTTP server at all (``serve --no-http``): the
    browser must then keep the media on the page's own HTTPS origin. Handing out
    an ``http://`` URL on the TLS port instead — what this used to do — leaves
    the receiver fetching plaintext from a TLS socket, so it buffers at 00:00
    until it times out.
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
    title: str = "sestudio"
    #: The browser player's caption language, burnt in for a stored file.
    subtitle_lang: str | None = None
    #: A lighter rung's height (see ``downloaded.HLS_LADDER``) for a stored
    #: file, re-encoded down to it; 0 sends the best the TV takes.
    quality: int = 0


@router.post("/cast/dlna/play")
async def dlna_play(body: DlnaPlayRequest, request: Request) -> dict[str, Any]:
    """Push a (proxied) stream URL to a previously discovered renderer."""
    renderers: dict[str, str] = getattr(request.app.state, "dlna_renderers", {})
    location = renderers.get(body.renderer_udn)
    if location is None:
        raise HTTPException(
            status_code=404, detail="Unknown renderer — re-scan and try again"
        )

    mime_type = _MIME_BY_KIND.get(body.kind, "video/mp4")
    proxy_url = body.proxy_url
    duration: float | None = None
    parsed = urllib.parse.urlparse(proxy_url)
    if parsed.path == "/api/downloaded/file":
        query = urllib.parse.parse_qs(parsed.query)
        stored = query.get("path", [""])[0]
        target = _resolved(stored)
        lang = body.subtitle_lang or ""
        burn = (
            bool(lang)
            and (await asyncio.to_thread(downloaded.tv_subtitle, target, lang))
            is not None
        )
        # What a browser cannot play is what a TV is least likely to, and a
        # caption can only reach the TV inside the picture: both are re-encoded.
        # A lighter quality is an encode too: the file as stored is the best one.
        lighter = 0 < body.quality < downloaded.TV_HEIGHT
        if (
            burn
            or lighter
            or not await asyncio.to_thread(downloaded.browser_can_play, target)
        ):
            audio = int(query.get("audio", ["0"])[0])
            proxy_url = (
                f"/api/downloaded/tv?path={urllib.parse.quote(stored)}&audio={audio}"
            )
            if burn:
                proxy_url += f"&lang={urllib.parse.quote(lang)}"
            if lighter:
                proxy_url += f"&rung={body.quality}"
            mime_type = downloaded.TV_MEDIA_TYPE
            duration = await asyncio.to_thread(downloaded.duration_of, target)
        else:
            # Sent as it is — mkv, avi… — and a TV told "video/mp4" for one
            # answers "file cannot be recognized", so declare what it really is.
            mime_type = downloaded.media_type_for(stored)
    elif parsed.path == "/api/stream/proxy":
        token = urllib.parse.parse_qs(parsed.query).get("token", [""])[0]
        source, hls = transcode_source(request, token)
        lighter = 0 < body.quality < downloaded.TV_HEIGHT
        # Few TVs follow HLS, and a lighter quality is an encode: both get the
        # provider's stream re-encoded into one continuous one.
        if hls or lighter:
            proxy_url = "/api/stream/tv?" + urllib.parse.urlencode({"token": token})
            if lighter:
                proxy_url += f"&rung={body.quality}"
            mime_type = downloaded.TV_MEDIA_TYPE
            probe = await asyncio.to_thread(downloaded.probe_stream, source, hls=hls)
            duration = probe.duration if probe else None

    # The renderer fetches the stream itself, so build an absolute HTTP URL on
    # our LAN IP facing the renderer (browsing via localhost would otherwise
    # point the TV at itself). DLNA is plain HTTP on the direct server port.
    renderer_host = urllib.parse.urlparse(location).hostname or ""
    lan_ip = _local_ip_for(renderer_host)
    http_port = request.app.state.http_port
    if http_port is not None:
        media_url = f"http://{lan_ip}:{http_port}{proxy_url}"
    else:
        # HTTPS-only (serve --no-http). A renderer that rejects the self-signed
        # cert cannot play this, but an https URL is at least well-formed —
        # http:// on the TLS port never is.
        media_url = f"https://{lan_ip}:{request.app.state.https_port}{proxy_url}"

    try:
        dmr = await dlna.play_on_renderer(
            location, media_url, body.title, mime_type, duration
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DLNA play failed: {exc}") from exc

    # Cache the device so the session can be controlled (play/pause/seek/etc).
    request.app.state.dlna_dmr = dmr
    request.app.state.dlna_title = body.title
    return {"status": "playing", "renderer": body.renderer_udn, "media_url": media_url}


def _active_dmr(request: Request):
    dmr = getattr(request.app.state, "dlna_dmr", None)
    if dmr is None:
        raise HTTPException(status_code=409, detail="No active DLNA session")
    return dmr


@router.get("/cast/dlna/status")
async def dlna_status(request: Request) -> dict[str, Any]:
    """Current DLNA session state for the control UI. Reports disconnected when
    there is no session or the renderer is unreachable."""
    dmr = getattr(request.app.state, "dlna_dmr", None)
    if dmr is None:
        return {"connected": False}
    try:
        await dmr.async_update()
        state = dmr.transport_state
        return {
            "connected": True,
            "title": getattr(request.app.state, "dlna_title", "")
            or (dmr.media_title or ""),
            "state": getattr(state, "value", str(state)) if state is not None else "",
            "position": dmr.media_position or 0,
            "duration": dmr.media_duration or 0,
            "volume": dmr.volume_level if dmr.volume_level is not None else 1.0,
            "muted": bool(dmr.is_volume_muted),
            "can_pause": bool(dmr.can_pause),
        }
    except Exception as exc:  # noqa: BLE001 — renderer gone/unreachable
        logger.debug("DLNA status update failed: %s", exc)
        return {"connected": False}


class DlnaSeekRequest(BaseModel):
    seconds: float


class DlnaVolumeRequest(BaseModel):
    level: float  # 0..1


class DlnaMuteRequest(BaseModel):
    muted: bool


@router.post("/cast/dlna/pause")
async def dlna_pause(request: Request) -> dict[str, Any]:
    await _active_dmr(request).async_pause()
    return {"status": "paused"}


@router.post("/cast/dlna/resume")
async def dlna_resume(request: Request) -> dict[str, Any]:
    await _active_dmr(request).async_play()
    return {"status": "playing"}


@router.post("/cast/dlna/seek")
async def dlna_seek(body: DlnaSeekRequest, request: Request) -> dict[str, Any]:
    # DLNA REL_TIME seek targets the absolute position within the track.
    await _active_dmr(request).async_seek_rel_time(
        datetime.timedelta(seconds=max(0, body.seconds))
    )
    return {"status": "ok"}


@router.post("/cast/dlna/volume")
async def dlna_volume(body: DlnaVolumeRequest, request: Request) -> dict[str, Any]:
    await _active_dmr(request).async_set_volume_level(max(0.0, min(1.0, body.level)))
    return {"status": "ok"}


@router.post("/cast/dlna/mute")
async def dlna_mute(body: DlnaMuteRequest, request: Request) -> dict[str, Any]:
    await _active_dmr(request).async_mute_volume(body.muted)
    return {"status": "ok"}


@router.post("/cast/dlna/stop")
async def dlna_stop(request: Request) -> dict[str, Any]:
    dmr = getattr(request.app.state, "dlna_dmr", None)
    if dmr is not None:
        try:
            await dmr.async_stop()
        except Exception as exc:  # noqa: BLE001 — best-effort; clear regardless
            logger.debug("DLNA stop failed: %s", exc)
    request.app.state.dlna_dmr = None
    request.app.state.dlna_title = ""
    return {"status": "stopped"}
