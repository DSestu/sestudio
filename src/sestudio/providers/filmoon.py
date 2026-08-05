"""Filmoon provider.

Refreshingly, there is nothing to deobfuscate. The embed page's inline script
reads the filecode from its own path and POSTs it to a JSON API:

    fetch("/api/stream", {method: "POST",
          body: JSON.stringify({filecode, device: detectDevice()})})

The response carries `streaming_url` (an HLS master playlist) in the clear, so we
call the same endpoint directly. The page also loads pako and crypto-js, but
those serve other features — the stream URL itself is not encrypted.

Note the issued token embeds the requesting IP, so a resolved URL is only usable
from the host that asked for it. That is fine here because the app proxies and
downloads from the same machine that resolves, but it does mean a URL cannot be
handed to a different client.

Filmoon's alias domains rotate (fstream currently serves vidaraa.cc), so the API
host is taken from the embed URL rather than hardcoded. fstream's vostfr/vfq
slots arrive as wrapper links carrying no filecode; those are followed to a real
filmoon URL first, then the API is called against wherever they landed.
"""

from __future__ import annotations

import logging
import re

import httpx

from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import StreamSource
from sestudio.providers.base import ProviderError, StreamProvider

logger = logging.getLogger(__name__)

_CODE_RE = re.compile(r"/(?:[edf]/|embed[-/])([A-Za-z0-9]+)")

# fstream serves filmoon's vostfr/vfq slots as its own wrapper links
# (fr.kakaflix.lol/viper/…, kokoflix.lol/chamber_go.php) that carry no filecode
# and 30x through a long chain of throwaway domains before landing on a real
# filmoon host. Those chains are slow — slow enough to stall a resolve — so the
# wrapper path gets its own tighter budget and is allowed to fail cleanly rather
# than hold up the resolver's fallback to another provider.
_WRAPPER_TIMEOUT = 8.0
_WRAPPER_MAX_REDIRECTS = 30

HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_UA,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-Requested-With": "XMLHttpRequest",
}


def _origin(url: str) -> str:
    parts = httpx.URL(url)
    return f"{parts.scheme}://{parts.host}"


def _call_stream_api(
    client: httpx.Client, origin: str, code: str, referer: str
) -> dict:
    resp = client.post(
        f"{origin}/api/stream",
        headers={**HEADERS, "Referer": referer},
        json={"filecode": code, "device": "web"},
    )
    resp.raise_for_status()
    return resp.json()


class FilmoonProvider(StreamProvider):
    @staticmethod
    def _resolve_wrapper(embed_url: str) -> str:
        """Follow an fstream wrapper link to the real filmoon URL behind it."""
        logger.debug("Resolving Filmoon wrapper: %s", embed_url)
        try:
            with new_client(
                headers={"User-Agent": BROWSER_UA, "Referer": embed_url},
                timeout=_WRAPPER_TIMEOUT,
                max_redirects=_WRAPPER_MAX_REDIRECTS,
            ) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
        except httpx.TooManyRedirects as exc:
            raise ProviderError(
                f"Filmoon wrapper exceeded {_WRAPPER_MAX_REDIRECTS} redirects: "
                f"{embed_url}"
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError(
                f"Timeout resolving Filmoon wrapper (>{_WRAPPER_TIMEOUT:g}s per hop): "
                f"{embed_url}"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"HTTP {exc.response.status_code} resolving Filmoon wrapper: {embed_url}"
            ) from exc
        except httpx.TransportError as exc:
            # These chains routinely end on a dead or DNS-blocked throwaway domain;
            # say so rather than surfacing a bare "[Errno 111] Connection refused".
            raise ProviderError(
                f"Could not reach Filmoon wrapper chain for {embed_url}: {exc}"
            ) from exc
        return str(resp.url)

    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Filmoon embed: %s", embed_url)

        resolved = embed_url
        code_match = _CODE_RE.search(embed_url)

        if not code_match:
            # A wrapper link: follow it to a real filmoon URL to learn the filecode.
            resolved = self._resolve_wrapper(embed_url)
            code_match = _CODE_RE.search(resolved)
            if not code_match:
                raise ProviderError(
                    f"Filmoon wrapper {embed_url} resolved to {resolved}, "
                    f"which carries no filecode"
                )

        code = code_match.group(1)
        referer = resolved

        try:
            with new_client() as client:
                data = _call_stream_api(client, _origin(resolved), code, referer)
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout calling Filmoon API for {code}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"HTTP {exc.response.status_code} from Filmoon API for {code}"
            ) from exc
        except httpx.TransportError as exc:
            raise ProviderError(
                f"Could not reach Filmoon API at {_origin(resolved)} for {code}: {exc}"
            ) from exc
        except ValueError as exc:
            raise ProviderError(
                f"Filmoon API returned no usable JSON for {code}: {exc}"
            ) from exc

        stream_url = (data or {}).get("streaming_url") or ""
        if not stream_url:
            raise ProviderError(f"No streaming_url in Filmoon API response for {code}")

        logger.debug("Filmoon resolved stream: %s", stream_url[:80])
        return StreamSource(
            url=stream_url,
            referer=referer,
            provider="filmoon",
            user_agent=BROWSER_UA,
        )
