from __future__ import annotations

import base64
import logging
import re
from collections.abc import Iterator
from urllib.parse import urlsplit

import httpx

from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import StreamSource
from sestudio.providers import jsdecode
from sestudio.providers.base import ProviderError, StreamProvider

logger = logging.getLogger(__name__)

REFERER = "https://vidzy.org/"

HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_UA,
    "Referer": REFERER,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_PACKED_RE = re.compile(
    r"}\s*\('((?:[^']|\\.)+)',\s*(\d+)\s*,\s*(\d+)\s*,'((?:[^']|\\.)*?)'\s*\.split\('\|'\)",
    re.DOTALL,
)
_SRC_RE = re.compile(r'src\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']')

# Newer embeds obfuscate the real source: the src is produced by an inline
# function that base64-decodes a string and XORs each byte with a rotating key,
# e.g. src:(function(s){var k=[214,91,...],b=atob(s),...^k[i%8]...})("<b64>").
# The plaintext .m3u8 URLs left in the page (…/troll/master.m3u8) are decoys.
#
# Several key derivations are in the wild and the embed rotates between them:
#   - a literal array, XORed cyclically:      k=[214,91,...]  ... ^k[i%8]
#   - an arithmetic ramp computed per byte:   kk=(0x5b+i*37)&255
# Some variants also reverse the decoded string before returning it, and the
# array contents / ramp seed+multiplier differ per embed. Rather than deciding
# up front which scheme a body describes, we generate *every* candidate the body
# plausibly supports and return the first that decodes to something containing
# ".m3u8" — see _deobfuscate_src.
# The body bound is deliberately loose: with the decoder executed rather than
# modelled, a longer body is no longer harder to handle, and a cap tight enough
# to exclude one would make the construct fail to match at all. The lazy
# quantifier still stops at the first `})("<payload>")`.
_INLINE_SRC_RE = re.compile(
    r'src:\(function\(s\)\{(?P<body>.{0,4000}?)\}\)\("(?P<payload>[A-Za-z0-9+/=]+)"\)',
    re.DOTALL,
)
_ARRAY_KEY_RE = re.compile(r"k=\[([\d,]+)\]")
# The trailing `+ H` term is the domain binding: some embeds add the sum of
# `location.hostname`'s char codes to the ramp, so the same payload decodes
# differently off-site. The variable name is not fixed, hence the loose match.
_RAMP_KEY_RE = re.compile(
    r"\(\s*(0x[0-9a-fA-F]+|\d+)\s*\+\s*i\s*\*\s*(\d+)\s*"
    r"(?:\+\s*[A-Za-z_$][\w$]*\s*)?\)\s*&\s*255"
)


def _host_offset(hostname: str) -> int:
    """The embed's `H`: char codes of the hostname summed mod 256."""
    total = 0
    for char in hostname:
        total = (total + ord(char)) & 255
    return total


def _keystreams(body: str, length: int, hostname: str = "") -> Iterator[list[int]]:
    """Yield every XOR keystream the decoder body plausibly describes.

    Both derivations are emitted whenever the body supports them — the caller
    validates the result, so guessing wrong is free. Every ramp occurrence is
    tried, not just the first, since the body may hold more than one.

    Ramps are emitted with and without the hostname offset rather than deciding
    from the body whether it is domain-bound: the extra candidate costs nothing
    and the marker is only a variable name.
    """
    for array_match in _ARRAY_KEY_RE.finditer(body):
        key = [int(x) for x in array_match.group(1).split(",")]
        if key:
            yield [key[i % len(key)] for i in range(length)]

    host_offset = _host_offset(hostname)
    offsets = (0, host_offset) if host_offset else (0,)
    for ramp_match in _RAMP_KEY_RE.finditer(body):
        seed = int(ramp_match.group(1), 0)
        step = int(ramp_match.group(2))
        for offset in offsets:
            yield [(seed + i * step + offset) & 255 for i in range(length)]


def _deobfuscate_src(body: str, payload_b64: str, hostname: str = "") -> str:
    """Recover the real m3u8 URL from the embed's obfuscated `src:`.

    Two strategies, in order of durability:

    1. **Run the embed's own decoder** in a sandboxed JS engine (jsdecode). This
       is scheme-agnostic — a rotation to any new arithmetic works for free —
       so it is tried first whenever the engine is installed.
    2. **Replicate the known schemes in Python**, trying every keystream the body
       plausibly describes with reversal on either side of the XOR. Guessing
       blindly is safe because a wrong keystream cannot produce ".m3u8". This is
       the fallback for environments without the JS engine, and it still covers
       every variant seen so far.

    Reversal is tried on both sides of the XOR in strategy 2 because variants
    reverse either the base64 bytes before XORing or the decoded string after,
    and with a position-dependent ramp key the two are not equivalent.

    *hostname* is the host serving the embed. Domain-bound variants fold it into
    the key, so both strategies need it; without it they decode garbage.
    """
    from_js = jsdecode.run_inline_decoder(body, payload_b64, hostname)
    if from_js and ".m3u8" in from_js:
        logger.debug("Inline decoder executed in JS engine")
        return from_js

    raw = base64.b64decode(payload_b64)

    tried = 0
    for keystream in _keystreams(body, len(raw), hostname):
        for source in (raw, raw[::-1]):
            decoded = "".join(chr(source[i] ^ keystream[i]) for i in range(len(raw)))
            for candidate in (decoded, decoded[::-1]):
                tried += 1
                if ".m3u8" in candidate:
                    return candidate

    engine = (
        f"JS engine ({jsdecode.ENGINE_NAME}) ran but produced no m3u8"
        if jsdecode.ENGINE_AVAILABLE
        else "no JS engine installed, so only known schemes were tried "
        "(install mini-racer)"
    )
    raise ProviderError(
        f"No known Vidzy obfuscation scheme decoded the src ({tried} combinations "
        f"tried; {engine}) — the embed likely rotated to a new one"
    )


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
            result = re.sub(
                r"\b" + re.escape(to_base(i, base)) + r"\b", keys[i], result
            )
    return result


class VidzyProvider(StreamProvider):
    def get_stream_url(self, embed_url: str) -> StreamSource:
        logger.debug("Fetching Vidzy embed: %s", embed_url)
        try:
            with new_client(headers=HEADERS) as client:
                resp = client.get(embed_url)
                resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Timeout fetching Vidzy embed: {embed_url}") from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError(
                f"HTTP {exc.response.status_code} fetching Vidzy embed: {embed_url}"
            ) from exc

        packed_match = re.search(
            r"eval\s*\(function\s*\(p,a,c,k.*?</script>", resp.text, re.DOTALL
        )
        if not packed_match:
            raise ProviderError(f"No packed script found in Vidzy embed: {embed_url}")

        unpacked = _unpack(packed_match.group(0))

        obf_match = _INLINE_SRC_RE.search(unpacked)
        if obf_match:
            # The *final* URL, not the requested one: the embed host redirects
            # between aliases, and the decoder keys on whichever host actually
            # served the page.
            stream_url = _deobfuscate_src(
                obf_match.group("body"),
                obf_match.group("payload"),
                urlsplit(str(resp.url)).hostname or "",
            )
        else:
            # Fallback: older embeds put the m3u8 URL in a plain quoted string.
            src_match = _SRC_RE.search(unpacked)
            if not src_match:
                raise ProviderError(f"No m3u8 source found in Vidzy embed: {embed_url}")
            stream_url = src_match.group(1)

        if ".m3u8" not in stream_url:
            raise ProviderError(f"Decoded Vidzy source is not an m3u8: {embed_url}")

        logger.debug("Vidzy resolved stream: %s", stream_url[:80])
        return StreamSource(
            url=stream_url,
            referer=REFERER,
            provider="vidzy",
            user_agent=HEADERS["User-Agent"],
        )
