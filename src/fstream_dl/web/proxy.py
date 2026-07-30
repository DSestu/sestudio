from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
import urllib.parse
from collections.abc import Callable

# Streams resolved from providers cannot be handed to a browser or cast device
# directly (they need a provider Referer, tolerate broken upstream TLS, and hit
# CORS). They are served through /api/stream/proxy instead. To keep that proxy
# *closed* — never an open relay for arbitrary URLs — the target URL, referer
# and provider are sealed into an HMAC-signed, expiring token. Only tokens this
# process minted are honoured; everything else is rejected before any network
# call is made.

PROXY_TOKEN_TTL = 6 * 3600  # seconds; long enough for a cast session, short enough that stale links die


class TokenError(Exception):
    """Raised when a proxy token is malformed, tampered, or expired."""


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign(
    secret: bytes,
    target_url: str,
    referer: str,
    provider: str,
    ttl: int = PROXY_TOKEN_TTL,
    *,
    now: float | None = None,
) -> str:
    """Seal a proxy target into a URL-safe ``<payload>.<sig>`` token."""
    issued = time.time() if now is None else now
    payload = {"u": target_url, "r": referer, "p": provider, "exp": issued + ttl}
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_json)
    sig = hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url_encode(sig)}"


def verify(secret: bytes, token: str, *, now: float | None = None) -> dict:
    """Validate *token* and return its ``{u, r, p, exp}`` payload. Raises TokenError.

    Performs no I/O: signature and expiry are checked before the caller ever
    touches the network.
    """
    try:
        payload_b64, sig_b64 = token.split(".", 1)
    except ValueError as exc:
        raise TokenError("Malformed proxy token") from exc

    expected = hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest()
    try:
        provided = _b64url_decode(sig_b64)
    except Exception as exc:
        raise TokenError("Malformed proxy token signature") from exc

    if not hmac.compare_digest(expected, provided):
        raise TokenError("Bad proxy token signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception as exc:
        raise TokenError("Malformed proxy token payload") from exc

    current = time.time() if now is None else now
    if float(payload.get("exp", 0)) < current:
        raise TokenError("Expired proxy token")

    return payload


# --------------------------------------------------------------------------- #
# HLS playlist rewriting
# --------------------------------------------------------------------------- #

# Tags whose value carries a URI="..." attribute that must be proxied too
# (encryption keys, fMP4 init segments, alternate audio/subtitle renditions,
# and I-frame variant playlists).
_URI_ATTR_RE = re.compile(r'URI="([^"]*)"')
_URI_TAGS = (
    "#EXT-X-KEY",
    "#EXT-X-MAP",
    "#EXT-X-MEDIA",
    "#EXT-X-I-FRAME-STREAM-INF",
)


def rewrite_playlist(
    text: str,
    base_url: str,
    mint_token: Callable[[str], str],
) -> str:
    """Rewrite every URI in an m3u8 so it loads through the proxy.

    *base_url* is the absolute URL the playlist was fetched from; relative URIs
    resolve against it. *mint_token* maps an absolute upstream URL to a proxy
    path. Segment URIs, nested (master → media) playlist URIs, and the URI="..."
    attribute of key/map/media/i-frame tags are all rewritten; every other line
    (``#EXTINF``, ``#EXT-X-BYTERANGE``, blanks, comments) passes through verbatim.
    """
    out: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
            continue

        if stripped.startswith("#"):
            if stripped.startswith(_URI_TAGS) and "URI=" in stripped:
                def _sub(m: re.Match[str]) -> str:
                    absolute = urllib.parse.urljoin(base_url, m.group(1))
                    return f'URI="{mint_token(absolute)}"'
                out.append(_URI_ATTR_RE.sub(_sub, line))
            else:
                out.append(line)
            continue

        # A bare URI line: a media segment or a nested variant playlist.
        absolute = urllib.parse.urljoin(base_url, stripped)
        out.append(mint_token(absolute))

    return "\n".join(out)
