from __future__ import annotations

import logging
import re

import httpx

from fstream_dl.http_client import BROWSER_UA, new_client
from fstream_dl.models import StreamSource
from fstream_dl.providers.base import ProviderError, StreamProvider
from fstream_dl.providers.vidzy import _unpack

logger = logging.getLogger(__name__)

# fstream stores luluvid links under rotating alias domains (e.g. vidhsareup.io)
# that die over time; the embed *code* stays valid on the canonical hosts, so we
# extract the code and fetch from a live luluvid domain by /e/<code>.
_CANONICAL_HOSTS = ("luluvdo.com", "luluvid.com")
REFERER = "https://luluvdo.com/"

_CODE_RE = re.compile(r"(?:embed[-/]|/e/|/d/|/f/)([A-Za-z0-9]+)")
_FILE_RE = re.compile(r'file\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']')
_PACKED_RE = re.compile(r"eval\(function\(p,a,c,k.*?</script>", re.DOTALL)

HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_UA,
    "Referer": REFERER,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
}


class LuluvidProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Luluvid embed: %s", embed_url)
        m = _CODE_RE.search(embed_url)
        if not m:
            raise ProviderError(f"Could not extract Luluvid code from: {embed_url}")
        code = m.group(1)

        last_error = "no candidate host responded"
        for host in _CANONICAL_HOSTS:
            url = f"https://{host}/e/{code}"
            try:
                with new_client(headers=HEADERS) as client:
                    resp = client.get(url)
                    resp.raise_for_status()
            except httpx.HTTPError as exc:
                last_error = f"{host}: {exc}"
                continue

            html = resp.text
            if "no longer available" in html or "expired" in html.lower():
                raise ProviderError(f"Luluvid file expired or deleted: {code}")

            packed = _PACKED_RE.search(html)
            if not packed:
                last_error = f"{host}: no packed player script"
                continue

            unpacked = _unpack(packed.group(0))
            src = _FILE_RE.search(unpacked)
            if not src:
                last_error = f"{host}: no m3u8 source in player"
                continue

            stream_url = src.group(1)
            logger.debug("Luluvid resolved stream: %s", stream_url[:80])
            return StreamSource(url=stream_url, referer=REFERER, provider="luluvid", user_agent=BROWSER_UA)

        raise ProviderError(f"Could not resolve Luluvid embed {embed_url} ({last_error})")
