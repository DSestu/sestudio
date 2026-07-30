from __future__ import annotations

import logging
from typing import Any

from async_upnp_client.aiohttp import AiohttpRequester
from async_upnp_client.client_factory import UpnpFactory
from async_upnp_client.profiles.dlna import DmrDevice
from async_upnp_client.search import async_search

logger = logging.getLogger(__name__)

_MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1"


async def discover_renderers(timeout: int = 4) -> list[dict[str, str]]:
    """SSDP-discover DLNA MediaRenderers on the LAN.

    Returns ``[{name, udn, location}]``. Best-effort: a discovery error or an
    unreachable device is skipped rather than raised, so a flaky network yields
    a partial list instead of failing the whole scan.
    """
    locations: set[str] = set()

    async def _on_response(headers: Any) -> None:
        location = headers.get("location")
        if location and "MediaRenderer" in headers.get("st", ""):
            locations.add(location)

    try:
        await async_search(_on_response, timeout=timeout, search_target=_MEDIA_RENDERER)
    except Exception as exc:  # noqa: BLE001 — discovery is best-effort
        logger.warning("SSDP discovery failed: %s", exc)
        return []

    factory = UpnpFactory(AiohttpRequester(timeout=timeout))
    renderers: list[dict[str, str]] = []
    for location in locations:
        try:
            device = await factory.async_create_device(location)
            renderers.append({"name": device.friendly_name, "udn": device.udn, "location": location})
        except Exception as exc:  # noqa: BLE001 — skip unreachable/odd devices
            logger.debug("Skipping renderer at %s: %s", location, exc)
    return renderers


async def play_on_renderer(location: str, media_url: str, title: str, mime_type: str) -> None:
    """Push *media_url* to the renderer's AVTransport and start playback.

    DIDL-Lite metadata (with an explicit mime type) is supplied because strict
    renderers — e.g. LG webOS — reject SetAVTransportURI without it. The mime
    type is overridden so metadata construction does not probe the URL itself.
    """
    factory = UpnpFactory(AiohttpRequester())
    device = await factory.async_create_device(location)
    dmr = DmrDevice(device, event_handler=None)
    metadata = await dmr.construct_play_media_metadata(
        media_url,
        title,
        override_mime_type=mime_type,
        override_upnp_class="object.item.videoItem",
    )
    await dmr.async_set_transport_uri(media_url, title, meta_data=metadata)
    await dmr.async_play()
