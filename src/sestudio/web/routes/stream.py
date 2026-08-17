from __future__ import annotations

import asyncio
import logging
import urllib.parse
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from sestudio.http_client import BROWSER_UA, new_client
from sestudio.sites import site_for
from sestudio.web.proxy import (
    PROXY_TOKEN_TTL,
    TokenError,
    rewrite_playlist,
    sign,
    verify,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Headers sent to the upstream stream host on the client's behalf. Accept-Encoding
# is pinned to identity so the relayed Content-Length stays accurate (we forward
# raw bytes without re-encoding).
_UA = BROWSER_UA

# Response headers worth relaying from upstream so seeking and content typing work.
_RELAY_HEADERS = ("content-type", "content-range", "accept-ranges", "content-length")

_HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl"

# The Google Cast Default Media Receiver *requires* CORS headers on media (it
# rejects HLS playlists/segments served without them), and they are harmless for
# every other client, so every proxy response carries them.
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
}


def _is_playlist(url: str, content_type: str) -> bool:
    path = urllib.parse.urlparse(url).path.lower()
    return path.endswith(".m3u8") or "mpegurl" in content_type.lower()


def _proxy_url(secret: bytes, target_url: str, referer: str, provider: str) -> str:
    token = sign(secret, target_url, referer, provider, ttl=PROXY_TOKEN_TTL)
    return "/api/stream/proxy?" + urllib.parse.urlencode({"token": token})


class ResolveRequest(BaseModel):
    embed_urls: dict[str, str]  # provider -> embed url
    # Optional "mp4"/"hls": keep looking for a provider serving this kind before
    # settling. Device downloads ask for mp4 so they can relay bytes directly
    # instead of paying for an ffmpeg remux.
    prefer_kind: str | None = None
    # Id of the ContentSite that produced the embeds; it owns their resolution.
    source: str = "fstream"


@router.post("/stream/resolve")
async def resolve_stream(body: ResolveRequest, request: Request) -> dict[str, Any]:
    """Resolve an episode's providers to a proxied, playable descriptor.

    The owning site orders and resolves its candidates, so a dead uqload embed
    falls back to vidzy/netu — same behaviour as downloads. Never leaks the raw
    stream URL (it is sealed inside the proxy token).
    """
    providers = request.app.state.providers
    secret = request.app.state.proxy_secret
    try:
        site = site_for(request.app.state.sites, body.source)
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Unknown source: {body.source}")
    errors: list[str] = []
    fallback: dict[str, Any] | None = None

    for cand in site.stream_candidates(body.embed_urls):
        try:
            source = await asyncio.to_thread(site.resolve_candidate, cand, providers)
        except Exception as exc:  # noqa: BLE001 — try the next candidate on any failure
            logger.debug("Provider %s failed to resolve: %s", cand.provider, exc)
            errors.append(f"{cand.provider}: {exc}")
            continue
        kind = "hls" if ".m3u8" in source.url else "mp4"
        result = {
            "proxy_url": _proxy_url(
                secret, source.url, source.referer, source.provider
            ),
            "kind": kind,
            "provider": cand.provider,
            # Sidecar subtitles go through the same proxy: they are fetched from
            # the stream host and need its Referer just as the segments do.
            "subtitles": [
                {
                    "proxy_url": _proxy_url(
                        secret, sub.url, source.referer, source.provider
                    ),
                    "lang": sub.lang,
                    "label": sub.label,
                    "default": sub.default,
                }
                for sub in source.subtitles
            ],
        }
        # With a preferred kind, remember the first working source but keep
        # looking for one of the requested kind.
        if body.prefer_kind and kind != body.prefer_kind:
            fallback = fallback or result
            continue
        return result

    if fallback is not None:
        return fallback

    detail = (
        "All providers failed — " + "; ".join(errors)
        if errors
        else "No supported provider"
    )
    raise HTTPException(status_code=502, detail=detail)


@router.api_route("/stream/proxy", methods=["GET", "HEAD"])
def proxy_stream(token: str, request: Request) -> Response:
    """Stream an upstream media resource through the server, injecting the provider Referer.

    Only tokens this process signed (and not yet expired) are honoured; verification
    happens before any upstream request is made.
    """
    secret = request.app.state.proxy_secret
    try:
        payload = verify(secret, token)
    except TokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    target_url: str = payload["u"]
    referer: str = payload["r"]
    provider: str = payload["p"]

    # DLNA renderers (and metadata construction) probe the URL with HEAD before
    # playing; answer it cheaply with the right content type + range support so
    # they accept the resource, without opening an upstream connection.
    if request.method == "HEAD":
        media_type = _HLS_CONTENT_TYPE if _is_playlist(target_url, "") else "video/mp4"
        return Response(
            status_code=200,
            media_type=media_type,
            headers={"Accept-Ranges": "bytes", **_CORS_HEADERS},
        )

    upstream_headers = {
        "User-Agent": _UA,
        "Referer": referer,
        "Accept-Encoding": "identity",
        # Some CDN nodes (e.g. vidzy's u*.vidzy.cc) 403 requests that lack the
        # Sec-Fetch-* headers a real browser sends; without these the master
        # playlist / segments are rejected even with a valid token and referer.
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
    }
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    client = new_client(headers=upstream_headers)
    req = client.build_request("GET", target_url)
    upstream = client.send(req, stream=True)

    # HLS playlists are fetched whole and rewritten so the client only ever
    # talks to this proxy; media segments are streamed through byte-for-byte.
    if _is_playlist(str(upstream.url), upstream.headers.get("content-type", "")):
        try:
            raw = upstream.read()
        finally:
            upstream.close()
            client.close()
        secret_bytes = request.app.state.proxy_secret
        base_url = str(upstream.url)

        def _mint(absolute_url: str) -> str:
            return _proxy_url(secret_bytes, absolute_url, referer, provider)

        rewritten = rewrite_playlist(
            raw.decode("utf-8", errors="replace"), base_url, _mint
        )
        return Response(
            content=rewritten,
            status_code=upstream.status_code,
            media_type=_HLS_CONTENT_TYPE,
            headers=dict(_CORS_HEADERS),
        )

    relay = {h: upstream.headers[h] for h in _RELAY_HEADERS if h in upstream.headers}
    relay.update(_CORS_HEADERS)

    def body() -> Iterator[bytes]:
        try:
            yield from upstream.iter_bytes()
        finally:
            upstream.close()
            client.close()

    return StreamingResponse(body(), status_code=upstream.status_code, headers=relay)
