"""VOE provider.

Two things make VOE awkward compared with the other hosts.

**Reaching the player.** fstream stores VOE links as its own wrapper
(`kakaflix.lol/voe1/newPlayer.php?id=<uuid>`), which 303s into a gauntlet of
short-lived throwaway domains that 302 to one another — 22 hops when this was
written, so the default `max_redirects` of 20 is not enough. The last hop is a
*JavaScript* redirect rather than a Location header: a tiny page that reads
`localStorage.permanentToken` and, absent one, assigns `window.location.href`.
A plain HTTP client has no localStorage, so it always takes that branch; we
follow it by pattern rather than by running it, since it is a bare assignment
with no obfuscation to speak of.

**Reading the source.** The player page carries a `<script
type="application/json">` blob holding one string, obfuscated by a fixed chain:

    rot13 → junk digraphs → "_" → base64 → shift every char down 3 → reverse
          → base64 → JSON

The result is the player config; `source` is the HLS master playlist. Unlike
vidzy, this is not a self-contained inline function we could simply execute —
VOE's decoder lives inside an 86 KB obfuscated browserify bundle that expects a
DOM, jQuery and jwplayer, so there is nothing cheap to hand to jsdecode. The
chain is replicated here instead, which is acceptable because the output is
self-validating: a wrong chain does not produce parseable JSON.
"""

from __future__ import annotations

import base64
import codecs
import json
import logging
import re

import httpx

from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import StreamSource
from sestudio.providers.base import ProviderError, StreamProvider
from sestudio.providers.luluvid import LuluvidProvider

logger = logging.getLogger(__name__)

REFERER = "https://voe.sx/"

HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# The throwaway-domain chain was 22 hops when written and the domains rotate, so
# allow generous headroom over httpx's default of 20.
_MAX_REDIRECTS = 48
# Each JS hop is one more page fetch; a handful is plenty and bounds a loop.
_MAX_JS_HOPS = 6

_JSON_BLOB_RE = re.compile(
    r"""<script[^>]*type=["']application/json["'][^>]*>(.*?)</script>""", re.DOTALL
)
_JS_LOCATION_RE = re.compile(r"""window\.location\.href\s*=\s*['"]([^'"]+)['"]""")

# Two-character sequences salted into the payload to break naive base64 decoding.
_JUNK_DIGRAPHS = ("@$", "^^", "~@", "%?", "*~", "!!", "#&")
_CHAR_SHIFT = 3

# Some "voe" slots are mislabelled: the wrapper hands off to a LuluStream embed
# instead of VOE. Those titles often have no separate `luluvid` entry in the film
# API, so the stream is reachable *only* through this slot — failing here would
# lose it entirely, with nothing for the resolver's fallback chain to try. Detect
# the hand-off and delegate rather than reporting a dead provider.
_LULUVID_HOSTS = ("luluvdo.com", "luluvid.com", "lulustream.com")


def _b64_decode_loose(text: str) -> str:
    """Base64-decode after dropping anything outside the alphabet, padding as needed."""
    cleaned = re.sub(r"[^A-Za-z0-9+/=]", "", text)
    padded = cleaned + "=" * (-len(cleaned) % 4)
    return base64.b64decode(padded).decode("utf-8", "replace")


def _decode_player_config(payload: str) -> dict:
    """Undo VOE's obfuscation chain and return the player config.

    Self-validating: any wrong step yields bytes that will not parse as JSON, so
    a silently-wrong decode is not a realistic failure mode.
    """
    stage = codecs.decode(payload, "rot13")
    for junk in _JUNK_DIGRAPHS:
        stage = stage.replace(junk, "_")
    stage = _b64_decode_loose(stage)
    stage = "".join(chr(ord(c) - _CHAR_SHIFT) for c in stage)
    stage = stage[::-1]
    config = json.loads(_b64_decode_loose(stage))
    if not isinstance(config, dict):
        raise ValueError(f"decoded config is {type(config).__name__}, not an object")
    return config


def _extract_payload(html: str) -> str | None:
    """Return the obfuscated string from the page's application/json blob."""
    blob_match = _JSON_BLOB_RE.search(html)
    if not blob_match:
        return None
    blob = blob_match.group(1).strip()
    try:
        parsed = json.loads(blob)
    except json.JSONDecodeError:
        return blob or None
    # The blob is normally a single-element array wrapping the payload string.
    if isinstance(parsed, list) and parsed and isinstance(parsed[0], str):
        return parsed[0]
    return blob if isinstance(parsed, str) else None


class VoeProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching VOE embed: %s", embed_url)

        url = embed_url
        payload: str | None = None
        final_url = embed_url

        try:
            with new_client(
                headers={**HEADERS, "Referer": embed_url},
                max_redirects=_MAX_REDIRECTS,
            ) as client:
                for hop in range(_MAX_JS_HOPS):
                    resp = client.get(url)
                    resp.raise_for_status()
                    final_url = str(resp.url)

                    payload = _extract_payload(resp.text)
                    if payload:
                        logger.debug(
                            "VOE player reached at %s (hop %d)", final_url, hop
                        )
                        break

                    if any(host in final_url for host in _LULUVID_HOSTS):
                        logger.debug(
                            "VOE slot handed off to LuluStream at %s — delegating",
                            final_url,
                        )
                        return LuluvidProvider().get_stream_url(final_url)

                    next_hop = _JS_LOCATION_RE.search(resp.text)
                    if not next_hop:
                        raise ProviderError(
                            f"VOE chain stopped at {final_url} with no player config "
                            f"and no further redirect"
                        )
                    url = str(httpx.URL(final_url).join(next_hop.group(1)))
                else:
                    raise ProviderError(
                        f"VOE chain exceeded {_MAX_JS_HOPS} JS hops from {embed_url}"
                    )
        except httpx.TooManyRedirects as exc:
            raise ProviderError(
                f"VOE redirect chain exceeded {_MAX_REDIRECTS} hops: {embed_url}"
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching VOE embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"HTTP {exc.response.status_code} fetching VOE embed: {embed_url}"
            ) from exc

        try:
            config = _decode_player_config(payload)
        except Exception as exc:
            raise ProviderError(
                f"Could not decode VOE player config from {final_url}: {exc}"
            ) from exc

        stream_url = config.get("source") or config.get("direct_access_url") or ""
        if not stream_url:
            raise ProviderError(f"No source in VOE player config from {final_url}")

        logger.debug("VOE resolved stream: %s", stream_url[:80])
        return StreamSource(
            url=stream_url,
            referer=final_url,
            provider="voe",
            user_agent=BROWSER_UA,
        )
