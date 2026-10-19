from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx

# The upstream streaming domains routinely serve expired or mismatched TLS
# certificates (e.g. fstream.top presenting a cert for www.fstream.info that
# expired 2026-07-26). This is a best-effort scraper, not a security boundary:
# no credentials or secrets are ever sent to these hosts, so certificate
# verification is disabled to keep the app usable when their certs lapse.
VERIFY_TLS = False

# A common, current Chrome-on-Windows User-Agent. Used for every outbound request
# to the stream hosts (embed fetch, proxy, and download) so the traffic looks like
# an ordinary browser — some CDNs 403 requests with an unusual or missing UA.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


# Providers whose CDN rejects non-browser TLS fingerprints: vidzy's *.vidzy.cc
# 403s httpx/yt-dlp whatever the headers, yet serves the same URL to Chrome.
IMPERSONATE_PROVIDERS = frozenset({"vidzy"})


class _CurlStream(httpx.SyncByteStream):
    def __init__(self, response: Any) -> None:
        self._response = response

    def __iter__(self) -> Iterator[bytes]:
        yield from self._response.iter_content()

    def close(self) -> None:
        self._response.close()


class _ImpersonatingTransport(httpx.BaseTransport):
    """httpx transport sending requests through curl_cffi with Chrome's TLS handshake."""

    def __init__(self, verify: bool) -> None:
        from curl_cffi import requests as curl_requests

        self._session = curl_requests.Session(impersonate="chrome", verify=verify)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        timeout = request.extensions.get("timeout", {})
        resp = self._session.request(
            request.method,
            str(request.url),
            headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
            data=request.read() or None,
            stream=True,
            allow_redirects=False,  # httpx follows redirects itself
            timeout=timeout.get("read") or 15,
        )
        # curl already decoded any compressed body, so drop the encoding header
        # or httpx would try to decode it a second time.
        headers = [
            (k, v) for k, v in resp.headers.items() if k.lower() != "content-encoding"
        ]
        return httpx.Response(
            resp.status_code, headers=headers, stream=_CurlStream(resp), request=request
        )

    def close(self) -> None:
        self._session.close()


def new_client(*, impersonate: bool = False, **kwargs: Any) -> httpx.Client:
    """Create an httpx.Client with scraper-friendly defaults (TLS verify off).

    *impersonate* routes requests through curl_cffi so the TLS handshake looks
    like Chrome's, for CDNs that fingerprint it (see IMPERSONATE_PROVIDERS).
    """
    kwargs.setdefault("timeout", 15)
    kwargs.setdefault("follow_redirects", True)
    kwargs.setdefault("verify", VERIFY_TLS)
    if impersonate:
        kwargs["transport"] = _ImpersonatingTransport(verify=kwargs["verify"])
    return httpx.Client(**kwargs)
