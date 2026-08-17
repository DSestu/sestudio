from __future__ import annotations

import logging
import re
from urllib.parse import urlsplit

import httpx

from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import StreamSource
from sestudio.providers import subtitles
from sestudio.providers.base import ProviderError, StreamProvider
from sestudio.providers.vidzy import (
    _INLINE_SRC_RE,
    _SRC_RE,
    _deobfuscate_src,
    _unpack,
)

logger = logging.getLogger(__name__)

# fstream's "premium" source is served from fsvid.lol using the same packer and
# XOR-obfuscated src as vidzy, so we reuse vidzy's decoders here.
REFERER = "https://fsvid.lol/"
_PACKED_RE = re.compile(r"eval\(function\(p,a,c,k.*?</script>", re.DOTALL)

HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_UA,
    "Referer": REFERER,
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
}


class PremiumProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Premium embed: %s", embed_url)
        try:
            with new_client(headers=HEADERS) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Premium embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"HTTP {exc.response.status_code} fetching Premium embed: {embed_url}"
            ) from exc

        packed = _PACKED_RE.search(resp.text)
        if not packed:
            raise ProviderError(f"No packed script found in Premium embed: {embed_url}")
        unpacked = _unpack(packed.group(0))

        obf = _INLINE_SRC_RE.search(unpacked)
        if obf:
            stream_url = _deobfuscate_src(
                obf.group("body"),
                obf.group("payload"),
                urlsplit(str(resp.url)).hostname or "",
            )
        else:
            src = _SRC_RE.search(unpacked)
            if not src:
                raise ProviderError(f"No m3u8 source in Premium embed: {embed_url}")
            stream_url = src.group(1)

        if ".m3u8" not in stream_url:
            raise ProviderError(f"Decoded Premium source is not an m3u8: {embed_url}")
        return StreamSource(
            url=stream_url,
            referer=REFERER,
            provider="premium",
            user_agent=BROWSER_UA,
            subtitles=subtitles.extract(resp.text, str(resp.url)),
        )
