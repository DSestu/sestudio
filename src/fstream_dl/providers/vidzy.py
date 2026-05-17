from __future__ import annotations

import logging
import re

import httpx

from fstream_dl.models import StreamSource
from fstream_dl.providers.base import ProviderError, StreamProvider

logger = logging.getLogger(__name__)

REFERER = "https://vidzy.org/"

HEADERS: dict[str, str] = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": REFERER,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_PACKED_RE = re.compile(
    r"}\s*\('((?:[^']|\\.)+)',\s*(\d+)\s*,\s*(\d+)\s*,'((?:[^']|\\.)*?)'\s*\.split\('\|'\)",
    re.DOTALL,
)
_SRC_RE = re.compile(r'src\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']')


def _unpack(packed: str) -> str:
    m = _PACKED_RE.search(packed)
    if not m:
        raise ProviderError("Cannot parse vidzy packed script")

    payload = m.group(1).replace("\\'", "'")
    base = int(m.group(2))
    count = int(m.group(3))
    keys = m.group(4).split("|")

    def to_base(n: int, b: int) -> str:
        chars = "0123456789abcdefghijklmnopqrstuvwxyz"
        r = ""
        while n:
            r = chars[n % b] + r
            n //= b
        return r or "0"

    result = payload
    for i in range(count - 1, -1, -1):
        if i < len(keys) and keys[i]:
            result = re.sub(r"\b" + re.escape(to_base(i, base)) + r"\b", keys[i], result)
    return result


class VidzyProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Vidzy embed: %s", embed_url)
        try:
            with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Vidzy embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"HTTP {exc.response.status_code} fetching Vidzy embed: {embed_url}") from exc

        packed_match = re.search(r"eval\s*\(function\s*\(p,a,c,k.*?</script>", resp.text, re.DOTALL)
        if not packed_match:
            raise ProviderError(f"No packed script found in Vidzy embed: {embed_url}")

        unpacked = _unpack(packed_match.group(0))
        src_match = _SRC_RE.search(unpacked)
        if not src_match:
            raise ProviderError(f"No m3u8 source found in Vidzy embed: {embed_url}")

        stream_url = src_match.group(1)
        logger.debug("Vidzy resolved stream: %s", stream_url[:80])
        return StreamSource(url=stream_url, referer=REFERER, provider="vidzy")
