from __future__ import annotations

import logging
import re

import httpx

from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import StreamSource
from sestudio.providers.base import ProviderError, StreamProvider
from sestudio.providers.vidzy import _unpack

logger = logging.getLogger(__name__)

REFERER = "https://uqload.is/"

# Legacy embeds exposed a plain mp4 URL; current ones pack a JWPlayer setup with
# an HLS `file:"…master.m3u8"` (same Dean-Edwards packer as vidzy). Support both.
_MP4_RE = re.compile(r'(https://strm[^"\'<>\s]+/v\.mp4)')
_PACKED_RE = re.compile(r"eval\(function\(p,a,c,k.*?</script>", re.DOTALL)
_FILE_RE = re.compile(r'file\s*:\s*["\']([^"\']+\.(?:m3u8|mp4)[^"\']*)["\']')

HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_UA,
    "Referer": REFERER,
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
}


class UqloadProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Uqload embed: %s", embed_url)
        try:
            with new_client(headers=HEADERS) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Uqload embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"HTTP {exc.response.status_code} fetching Uqload embed: {embed_url}"
            ) from exc

        html = resp.text
        packed = _PACKED_RE.search(html)
        if packed:
            unpacked = _unpack(packed.group(0))
            m = _FILE_RE.search(unpacked)
            if m:
                return StreamSource(
                    url=m.group(1),
                    referer=REFERER,
                    provider="uqload",
                    user_agent=BROWSER_UA,
                )

        m = _MP4_RE.search(html)
        if m:
            return StreamSource(
                url=m.group(1),
                referer=REFERER,
                provider="uqload",
                user_agent=BROWSER_UA,
            )

        raise ProviderError(f"No stream URL found in Uqload embed: {embed_url}")
