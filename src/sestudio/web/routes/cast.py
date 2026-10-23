from __future__ import annotations

import asyncio
import datetime
import logging
import socket
import urllib.parse
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from sestudio import dlna, downloaded, interpolate
from sestudio.web.routes.downloaded import _resolved, check_fps, offered_rung
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
    #: A frame rate (see ``downloaded.FRAME_RATES``); 0 for the source's own.
    fps: int = 0


def _other_rate(fps: int, source_fps: float) -> bool:
    """Whether *fps* asks for a rate other than the source's own."""
    return bool(fps and source_fps and abs(fps - source_fps) > 0.5)


@router.post("/cast/dlna/play")
async def dlna_play(body: DlnaPlayRequest, request: Request) -> dict[str, Any]:
    """Push a (proxied) stream URL to a previously discovered renderer."""
    renderers: dict[str, str] = getattr(request.app.state, "dlna_renderers", {})
    location = renderers.get(body.renderer_udn)
    if location is None:
        raise HTTPException(
            status_code=404, detail="Unknown renderer — re-scan and try again"
        )

    check_fps(body.fps)
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
        # One at or above the file's own size is that best one, not an encode.
        rung = (
            offered_rung(
                await asyncio.to_thread(downloaded.hls_variants, target), body.quality
            )
            if body.quality
            else 0
        )
        lighter = rung != 0
        # Another frame rate is an encode too, and the file has only its own.
        tracks = await asyncio.to_thread(downloaded.tracks_of, target)
        rate = _other_rate(body.fps, tracks.video_fps)
        if (
            burn
            or lighter
            or rate
            or not await asyncio.to_thread(downloaded.browser_can_play, target)
        ):
            audio = int(query.get("audio", ["0"])[0])
            proxy_url = (
                f"/api/downloaded/tv?path={urllib.parse.quote(stored)}&audio={audio}"
            )
            if burn:
                proxy_url += f"&lang={urllib.parse.quote(lang)}"
            if lighter:
                proxy_url += f"&rung={rung}"
            if rate:
                proxy_url += f"&fps={body.fps}"
            # Its settings can then change without the TV reconnecting.
            proxy_url += "&live=dlna"
            mime_type = downloaded.TV_MEDIA_TYPE
            duration = await asyncio.to_thread(downloaded.duration_of, target)
        else:
            # Sent as it is — mkv, avi… — and a TV told "video/mp4" for one
            # answers "file cannot be recognized", so declare what it really is.
            mime_type = downloaded.media_type_for(stored)
    elif parsed.path == "/api/stream/proxy":
        token = urllib.parse.parse_qs(parsed.query).get("token", [""])[0]
        source, hls = transcode_source(request, token)
        probe = (
            await asyncio.to_thread(downloaded.probe_stream, source, hls=hls)
            if hls or body.quality or body.fps
            else None
        )
        rung = (
            offered_rung(downloaded.ladder(probe.width, probe.height), body.quality)
            if probe and body.quality
            else 0
        )
        rate = bool(probe) and _other_rate(body.fps, probe.fps)
        # Few TVs follow HLS, and a lighter quality or another frame rate is an
        # encode: each gets the provider's stream re-encoded into one stream.
        if hls or rung or rate:
            proxy_url = "/api/stream/tv?" + urllib.parse.urlencode({"token": token})
            if rung:
                proxy_url += f"&rung={rung}"
            if rate:
                proxy_url += f"&fps={body.fps}"
            proxy_url += "&live=dlna"
            mime_type = downloaded.TV_MEDIA_TYPE
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
    # Kept so the quality can be changed later from any page, even one opened
    # after the cast began: only the server knows what the TV was sent.
    request.app.state.dlna_play = body
    # A new video starts from what it was asked for, not the last one's changes.
    request.app.state.live.pop("dlna", None)
    request.app.state.dlna_live = "&live=dlna" in proxy_url
    return {"status": "playing", "renderer": body.renderer_udn, "media_url": media_url}


@router.get("/media/options")
async def media_options(request: Request, url: str | None = None) -> dict[str, Any]:
    """What *url* can be played at: its heights, the source's own first, the
    frame rates on offer, and the source's own rate.

    *url* is any media URL this server hands out for a stored file or a
    provider's stream. Without it, the video last sent to a DLNA TV, so a page
    opened after the cast began can still offer the right lists. Heights are
    empty when the size is unknown; the caller then offers fixed steps the
    server clamps.

    A frame rate above the source's is drawn by AI, so it is only offered where
    that runs on a GPU: on the CPU it would not keep up with playback.
    """
    none = {"heights": [], "fps": 0, "frame_rates": []}
    if url is None:
        last: DlnaPlayRequest | None = getattr(request.app.state, "dlna_play", None)
        if last is None:
            return none
        url = last.proxy_url
    found = await _variants_for(request, url)
    if found is None:
        return none
    variants, fps = found
    gpu = fps > 0 and (await asyncio.to_thread(interpolate.status)).get("gpu", False)
    # Judged at the source's size, or 720p for a bigger one: the player drops to
    # a lighter rung when drawing falls behind, so 720p is what has to hold.
    width, height = next(
        ((w, h) for _s, w, h, _b in variants if w and h and h <= 720), (1280, 720)
    )

    def offered(rate: int) -> bool:
        if rate < fps - 0.5:
            return True  # dropping frames costs nothing
        if rate <= fps + 0.5 or not gpu:
            return False  # the source's own, or AI that cannot keep up
        return interpolate.sustains(rate, fps, width, height)

    # A thread: the first ask measures the GPU, which runs the model.
    rates = await asyncio.to_thread(
        lambda: [rate for rate in downloaded.FRAME_RATES if fps and offered(rate)]
    )
    return {
        "heights": [height for _step, _w, height, _b in variants if height],
        "fps": fps,
        "frame_rates": rates,
    }


async def _variants_for(
    request: Request, url: str
) -> tuple[list[tuple[int, int, int, int]], float] | None:
    """The renditions of the media at *url*, and its own frame rate; None when
    it is not a stored file or a provider's stream, or cannot be read."""
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if parsed.path.startswith("/api/downloaded/"):
        target = _resolved(query.get("path", [""])[0])
        variants = await asyncio.to_thread(downloaded.hls_variants, target)
        fps = (await asyncio.to_thread(downloaded.tracks_of, target)).video_fps
        return variants, fps
    if parsed.path.startswith("/api/stream/"):
        source, hls = transcode_source(request, query.get("token", [""])[0])
        probe = await asyncio.to_thread(downloaded.probe_stream, source, hls=hls)
        if probe is None:
            return None
        return downloaded.ladder(probe.width, probe.height), probe.fps
    return None


class CastLiveRequest(BaseModel):
    #: "dlna" for the TV, else the id a Chromecast load carries as `live=`.
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    #: A height (see ``DlnaPlayRequest``); 0 for the best.
    quality: int = 0
    #: A frame rate; 0 for the source's own.
    fps: int = 0


@router.post("/cast/live")
async def cast_live(body: CastLiveRequest, request: Request) -> dict[str, Any]:
    """Change the quality and frame rate of a cast in progress, in place.

    The next segments a Chromecast fetches, or the next part of the stream a
    TV is sent, come at the new settings: no reload, no black, shown once the
    receiver has played what it had buffered. The one exception is a TV still
    playing the file itself, which has to move to the re-encoded stream once:
    that restarts it, said by ``restarted``, and the caller seeks it back.
    """
    check_fps(body.fps)
    fps = min(body.fps, downloaded.TV_MAX_FPS)
    if body.id != "dlna":
        # 0 leaves the rung to the receiver, which picks one from the master.
        request.app.state.live[body.id] = {"rung": body.quality or None, "fps": fps}
        return {"restarted": False}
    _active_dmr(request)
    last: DlnaPlayRequest | None = getattr(request.app.state, "dlna_play", None)
    if last is None:
        raise HTTPException(status_code=409, detail="No active DLNA session")
    wanted = last.model_copy(update={"quality": body.quality, "fps": fps})
    if not getattr(request.app.state, "dlna_live", False):
        return {**await dlna_play(wanted, request), "restarted": True}
    found = await _variants_for(request, last.proxy_url)
    rung = offered_rung(found[0], body.quality) if found and body.quality else 0
    request.app.state.live["dlna"] = {"rung": rung, "fps": fps}
    request.app.state.dlna_play = wanted
    return {"restarted": False}


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
