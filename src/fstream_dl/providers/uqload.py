from __future__ import annotations

import logging
import re

import httpx

from fstream_dl.models import StreamSource
from fstream_dl.providers.base import ProviderError, StreamProvider

logger = logging.getLogger(__name__)

REFERER = "https://uqload.is/"
MP4_RE = re.compile(r'(https://strm[^"\'<>\s]+/v\.mp4)')

HEADERS: dict[str, str] = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Referer": REFERER,
}


class UqloadProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Uqload embed: %s", embed_url)
        try:
            with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Uqload embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"HTTP {exc.response.status_code} fetching Uqload embed: {embed_url}") from exc

        match = MP4_RE.search(resp.text)
        if not match:
            raise ProviderError(f"No mp4 URL found in Uqload embed: {embed_url}")

        return StreamSource(url=match.group(1), referer=REFERER, provider="uqload")
