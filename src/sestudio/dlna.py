from __future__ import annotations

import asyncio
import logging
import socket
from typing import Any

from async_upnp_client.aiohttp import AiohttpRequester
from async_upnp_client.client_factory import UpnpFactory
from async_upnp_client.profiles.dlna import DmrDevice
from async_upnp_client.search import async_search

logger = logging.getLogger(__name__)

_MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1"

# protocolInfo 4th field for progressive mp4: byte-seek allowed (OP=01), no
# conversion, streaming-mode flags. Without it renderers assume the stream is
# unseekable and cannot fetch the moov index from the tail of non-faststart
# files (senpai's self-hosted mp4s), failing with "media not recognizable".
_MP4_DLNA_FEATURES = (
    "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
)


def _local_ipv4s() -> list[str]:
    """Local non-loopback IPv4 addresses, so SSDP can be sent on every interface.

    On a multi-homed host (e.g. LAN + Tailscale/VPN) a single SSDP M-SEARCH goes
    out only one interface and can miss renderers on the others; searching from
    each source address covers them all.
    """
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(str(info[4][0]))
    except OSError:
        pass
    # The address on the default route is the most likely LAN interface.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


async def discover_renderers(timeout: int = 4) -> list[dict[str, str]]:
    """SSDP-discover DLNA MediaRenderers on the LAN.

    Returns ``[{name, udn, location}]``. Best-effort: a discovery error or an
    unreachable device is skipped rather than raised, so a flaky network yields
    a partial list instead of failing the whole scan. The search runs from every
    local interface so multi-homed hosts still reach the TV's subnet.
    """
    locations: set[str] = set()

    async def _on_response(headers: Any) -> None:
        location = headers.get("location")
        if location and "MediaRenderer" in headers.get("st", ""):
            locations.add(location)

    sources = _local_ipv4s()
    searches = [
        async_search(
            _on_response, timeout=timeout, search_target=_MEDIA_RENDERER, source=(ip, 0)
        )
        for ip in sources
    ]
    # Also a default (unbound) search, in case interface enumeration misses one.
    searches.append(
        async_search(_on_response, timeout=timeout, search_target=_MEDIA_RENDERER)
    )

    results = await asyncio.gather(*searches, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            logger.debug("SSDP search error: %s", r)
    logger.info(
        "SSDP discovery: %d location(s) via interfaces %s",
        len(locations),
        sources or ["default"],
    )

    factory = UpnpFactory(AiohttpRequester(timeout=timeout))
    renderers: list[dict[str, str]] = []
    for location in locations:
        try:
            device = await factory.async_create_device(location)
            renderers.append(
                {"name": device.friendly_name, "udn": device.udn, "location": location}
            )
        except Exception as exc:  # noqa: BLE001 — skip unreachable/odd devices
            logger.debug("Skipping renderer at %s: %s", location, exc)
    return renderers


async def make_device(location: str) -> DmrDevice:
    """Build a DmrDevice for a renderer's description URL (for control/status)."""
    factory = UpnpFactory(AiohttpRequester())
    device = await factory.async_create_device(location)
    return DmrDevice(device, event_handler=None)


async def play_on_renderer(
    location: str, media_url: str, title: str, mime_type: str
) -> DmrDevice:
    """Push *media_url* to the renderer's AVTransport and start playback.

    Returns the DmrDevice so the caller can cache it and control the session
    (play/pause/seek/volume/status) afterwards.

    DIDL-Lite metadata (with an explicit mime type) is supplied because strict
    renderers — e.g. LG webOS — reject SetAVTransportURI without it. The mime
    type is overridden so metadata construction does not probe the URL itself.
    """
    dmr = await make_device(location)
    # Reset the transport first: strict renderers (e.g. LG webOS) reject
    # SetAVTransportURI with UPnP 701 "transition not available" when they are
    # already playing, so stop any current session before loading the new URI.
    try:
        await dmr.async_stop()
    except Exception as exc:  # noqa: BLE001 — expected/harmless when idle
        logger.debug("DLNA pre-stop failed (ok if renderer was idle): %s", exc)
    metadata = await dmr.construct_play_media_metadata(
        media_url,
        title,
        override_mime_type=mime_type,
        override_upnp_class="object.item.videoItem",
        override_dlna_features=(
            _MP4_DLNA_FEATURES if mime_type == "video/mp4" else "*"
        ),
    )
    await dmr.async_set_transport_uri(media_url, title, meta_data=metadata)
    await dmr.async_play()
    return dmr
