"""Forwarding ``/api`` to the server in use (docs/SPEC-remote-servers.md §3).

When ``app.state.upstream`` is set, every ``/api`` request not in LOCAL goes to
that server as it came: method, path, query, headers, body, ``Range``
included; the answer streams back as it arrives, so the music queue's event
feed and a TV's media work. The frontend itself is never forwarded: the
Servers page and "switch back" exist whatever the other side runs.
"""

from __future__ import annotations

import hashlib
import logging

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from sestudio.web.routes import servers

logger = logging.getLogger(__name__)

#: Paths that are about this machine, and stay here while switched.
LOCAL = (
    "/api/servers",
    "/api/cast/dlna",
    "/api/cast/http-port",
    "/api/server/lan",
    "/api/tls-permission",
    "/api/health",
    "/api/docs",
    "/api/openapi.json",
)

# Hop-by-hop, or decided by this server rather than copied.
_SKIP_REQUEST = {"host", "connection", "content-length", "accept-encoding"}
_SKIP_RESPONSE = {"connection", "transfer-encoding", "content-encoding", "keep-alive"}

# The read timeout is off: an event feed or a TV's stream stays open for hours.
_TIMEOUT = httpx.Timeout(connect=5.0, read=None, write=30.0, pool=5.0)


def is_local(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in LOCAL)


def _client() -> httpx.AsyncClient:
    # The certificate is pinned by fingerprint on every response instead of
    # verified against a CA: the other sestudio signs its own.
    return httpx.AsyncClient(
        transport=servers.transport, timeout=_TIMEOUT, verify=False
    )


def _presented(response: httpx.Response) -> str | None:
    """The SHA-256 of the certificate behind this response; None when not TLS."""
    try:
        ssl_object = response.extensions["network_stream"].get_extra_info("ssl_object")
        der = ssl_object.getpeercert(True)
    except (KeyError, AttributeError):
        return None
    return hashlib.sha256(der).hexdigest() if der else None


async def forward(request: Request, upstream: dict) -> Response:
    url = upstream["url"] + request.url.path
    if request.url.query:
        url += "?" + request.url.query
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _SKIP_REQUEST
    }
    # identity: the lengths and ranges pass through untouched, so the bytes must too.
    headers["accept-encoding"] = "identity"
    client = _client()
    try:
        r = await client.send(
            client.build_request(
                request.method, url, headers=headers, content=await request.body()
            ),
            stream=True,
        )
    except httpx.HTTPError as exc:
        await client.aclose()
        logger.info("%s is not answering: %s", upstream["name"], exc)
        return JSONResponse(
            {
                "detail": f"{upstream['name']} is not answering",
                "server": upstream["id"],
            },
            status_code=502,
        )
    presented = _presented(r)
    if presented is not None and presented != upstream["fingerprint"]:
        await r.aclose()
        await client.aclose()
        return JSONResponse(
            {
                "detail": f"{upstream['name']}'s certificate changed; trust it again",
                "server": upstream["id"],
            },
            status_code=502,
        )

    async def body():
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    out = {k: v for k, v in r.headers.items() if k.lower() not in _SKIP_RESPONSE}
    return StreamingResponse(body(), status_code=r.status_code, headers=out)


async def middleware(request: Request, call_next):
    upstream = getattr(request.app.state, "upstream", None)
    path = request.url.path
    if upstream and path.startswith("/api/") and not is_local(path):
        return await forward(request, upstream)
    return await call_next(request)


async def request(
    upstream: dict, method: str, path: str, json: object = None
) -> httpx.Response:
    """One call of our own to the server in use (a route that must run where the
    files are, like ``/api/cast/plan``), with the same certificate pin."""
    async with _client() as client:
        r = await client.request(method, upstream["url"] + path, json=json)
        presented = _presented(r)
        if presented is not None and presented != upstream["fingerprint"]:
            raise httpx.HTTPError(f"{upstream['name']}'s certificate changed")
        return r
