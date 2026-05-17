from __future__ import annotations

import base64
import json
import logging
import re

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from fstream_dl.models import StreamSource
from fstream_dl.providers.base import ProviderError, StreamProvider

logger = logging.getLogger(__name__)

_CODE_RE = re.compile(r"/e/([a-zA-Z0-9]+)")

HEADERS: dict[str, str] = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
}


def _b64url_decode(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * ((4 - len(s) % 4) % 4)
    return base64.b64decode(s)


def _decrypt_playback(pb: dict) -> list[dict]:
    key = b"".join(_b64url_decode(p) for p in pb["key_parts"])
    iv = _b64url_decode(pb["iv"])
    payload = _b64url_decode(pb["payload"])
    plaintext = AESGCM(key).decrypt(iv, payload, None)
    return json.loads(plaintext).get("sources", [])


class NetuProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Netu embed: %s", embed_url)
        try:
            with httpx.Client(headers={**HEADERS, "Referer": embed_url}, timeout=15, follow_redirects=True) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
                final_url = str(resp.url)
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Netu embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"HTTP {exc.response.status_code} fetching Netu embed: {embed_url}") from exc

        m = _CODE_RE.search(final_url)
        if not m:
            raise ProviderError(f"Could not extract video code from Netu redirect: {final_url}")

        code = m.group(1)
        api_base = f"{resp.url.scheme}://{resp.url.host}"
        referer = f"{api_base}/e/{code}"

        logger.debug("Netu resolved code=%s api_base=%s", code, api_base)

        try:
            with httpx.Client(headers={**HEADERS, "Referer": referer, "Accept": "application/json"}, timeout=15) as client:
                api_resp = client.get(f"{api_base}/api/videos/{code}/")
                api_resp.raise_for_status()
                data = api_resp.json()
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Netu API for {code}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"HTTP {exc.response.status_code} from Netu API for {code}") from exc

        pb = data.get("playback")
        if not pb or not pb.get("key_parts"):
            raise ProviderError(f"No playback config in Netu API response for {code}")

        try:
            sources = _decrypt_playback(pb)
        except Exception as exc:
            raise ProviderError(f"Failed to decrypt Netu playback config for {code}") from exc

        if not sources:
            raise ProviderError(f"No sources in Netu playback config for {code}")

        # Prefer highest quality (h > l), fall back to first
        source = next((s for s in sources if s.get("quality") == "h"), sources[0])
        stream_url = source["url"]

        logger.debug("Netu resolved stream: %s", stream_url[:80])
        return StreamSource(url=stream_url, referer=referer, provider="netu")
