from __future__ import annotations

import time
import urllib.parse

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from sestudio.models import StreamSource
from sestudio.providers.base import ProviderError
from sestudio.web.app import create_app
from sestudio.web.proxy import TokenError, rewrite_playlist, sign, verify

SECRET = b"0123456789abcdef0123456789abcdef"


# --------------------------------------------------------------------------- #
# T1 — token sign/verify
# --------------------------------------------------------------------------- #


def test_token_round_trip():
    token = sign(SECRET, "https://cdn/v.mp4", "https://uqload.is/", "uqload")
    payload = verify(SECRET, token)
    assert payload["u"] == "https://cdn/v.mp4"
    assert payload["r"] == "https://uqload.is/"
    assert payload["p"] == "uqload"


def test_token_tampered_signature_rejected():
    token = sign(SECRET, "https://cdn/v.mp4", "https://uqload.is/", "uqload")
    payload_b64, _sig = token.split(".", 1)
    tampered = payload_b64 + ".AAAA"
    with pytest.raises(TokenError):
        verify(SECRET, tampered)


def test_token_wrong_secret_rejected():
    token = sign(SECRET, "https://cdn/v.mp4", "https://uqload.is/", "uqload")
    with pytest.raises(TokenError):
        verify(b"a different secret, 32 bytes long!!", token)


def test_token_expired_rejected():
    past = time.time() - 10
    token = sign(
        SECRET, "https://cdn/v.mp4", "https://uqload.is/", "uqload", ttl=-1, now=past
    )
    with pytest.raises(TokenError):
        verify(SECRET, token)


def test_token_malformed_rejected():
    with pytest.raises(TokenError):
        verify(SECRET, "not-a-token")


# --------------------------------------------------------------------------- #
# T2 — resolve + MP4 proxy
# --------------------------------------------------------------------------- #


class _FakeProvider:
    def __init__(
        self, source: StreamSource | None = None, exc: Exception | None = None
    ):
        self._source = source
        self._exc = exc

    def get_stream_url(self, embed_url: str) -> StreamSource:
        if self._exc:
            raise self._exc
        assert self._source is not None
        return self._source


def _client(providers=None) -> TestClient:
    app = create_app(live_domain="https://fs03.lol")
    if providers is not None:
        app.state.providers = providers
    return TestClient(app)


def _resolve(client, embed_urls):
    return client.post("/api/stream/resolve", json={"embed_urls": embed_urls})


def test_resolve_mp4_kind():
    src = StreamSource(
        url="https://cdn.example/v.mp4", referer="https://uqload.is/", provider="uqload"
    )
    client = _client({"uqload": _FakeProvider(source=src)})
    resp = _resolve(client, {"uqload": "https://e/x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "mp4"
    assert body["provider"] == "uqload"
    assert body["proxy_url"].startswith("/api/stream/proxy?token=")


def test_resolve_hls_kind():
    src = StreamSource(
        url="https://cdn.example/master.m3u8",
        referer="https://vidzy.org/",
        provider="vidzy",
    )
    client = _client({"vidzy": _FakeProvider(source=src)})
    resp = _resolve(client, {"vidzy": "https://e/x"})
    assert resp.json()["kind"] == "hls"


def test_resolve_falls_back_to_next_provider():
    # uqload fails to resolve; vidzy succeeds — resolve should return vidzy.
    vidzy_src = StreamSource(
        url="https://cdn.example/master.m3u8",
        referer="https://vidzy.org/",
        provider="vidzy",
    )
    client = _client(
        {
            "uqload": _FakeProvider(exc=ProviderError("No mp4 URL found")),
            "vidzy": _FakeProvider(source=vidzy_src),
        }
    )
    resp = _resolve(client, {"uqload": "https://e/u", "vidzy": "https://e/v"})
    assert resp.status_code == 200
    assert resp.json()["provider"] == "vidzy"


def test_resolve_all_providers_fail_502():
    client = _client(
        {
            "uqload": _FakeProvider(exc=ProviderError("no mp4 found")),
            "vidzy": _FakeProvider(exc=ProviderError("no m3u8 found")),
        }
    )
    resp = _resolve(client, {"uqload": "https://e/u", "vidzy": "https://e/v"})
    assert resp.status_code == 502
    assert "no mp4 found" in resp.json()["detail"]
    assert "no m3u8 found" in resp.json()["detail"]


def test_resolve_no_supported_provider_502():
    client = _client({})
    resp = _resolve(client, {"nope": "https://e/x"})
    assert resp.status_code == 502


def test_proxy_forwards_range_and_relays_206(httpx_mock: HTTPXMock):
    client = _client()
    secret = client.app.state.proxy_secret
    token = sign(secret, "https://cdn.example/v.mp4", "https://uqload.is/", "uqload")

    httpx_mock.add_response(
        url="https://cdn.example/v.mp4",
        status_code=206,
        headers={
            "Content-Range": "bytes 0-1023/5000000",
            "Accept-Ranges": "bytes",
            "Content-Type": "video/mp4",
        },
        content=b"x" * 1024,
    )

    resp = client.get(
        "/api/stream/proxy", params={"token": token}, headers={"Range": "bytes=0-1023"}
    )
    assert resp.status_code == 206
    assert resp.headers["content-range"] == "bytes 0-1023/5000000"
    assert resp.headers["accept-ranges"] == "bytes"

    sent = httpx_mock.get_requests()[0]
    assert sent.headers["Range"] == "bytes=0-1023"
    assert sent.headers["Referer"] == "https://uqload.is/"


def test_proxy_head_answers_without_upstream_call(httpx_mock: HTTPXMock):
    # DLNA renderers probe with HEAD; it must succeed cheaply and issue no upstream request.
    client = _client()
    secret = client.app.state.proxy_secret
    mp4 = sign(secret, "https://cdn.example/v.mp4", "https://uqload.is/", "uqload")
    hls = sign(secret, "https://cdn.example/master.m3u8", "https://vidzy.org/", "vidzy")

    r1 = client.head("/api/stream/proxy", params={"token": mp4})
    assert r1.status_code == 200
    assert r1.headers["content-type"].startswith("video/mp4")
    assert r1.headers["accept-ranges"] == "bytes"

    r2 = client.head("/api/stream/proxy", params={"token": hls})
    assert "mpegurl" in r2.headers["content-type"]

    assert httpx_mock.get_requests() == []


def test_proxy_head_bad_token_403(httpx_mock: HTTPXMock):
    client = _client()
    resp = client.head("/api/stream/proxy", params={"token": "forged.AAAA"})
    assert resp.status_code == 403
    assert httpx_mock.get_requests() == []


def test_proxy_sets_cors_headers(httpx_mock: HTTPXMock):
    # Google Cast's default receiver requires CORS on media responses.
    client = _client()
    secret = client.app.state.proxy_secret
    token = sign(secret, "https://cdn.example/v.mp4", "https://uqload.is/", "uqload")
    httpx_mock.add_response(
        url="https://cdn.example/v.mp4",
        content=b"x" * 16,
        headers={"Content-Type": "video/mp4"},
    )

    resp = client.get("/api/stream/proxy", params={"token": token})
    assert resp.headers["access-control-allow-origin"] == "*"

    head = client.head("/api/stream/proxy", params={"token": token})
    assert head.headers["access-control-allow-origin"] == "*"


def test_proxy_rejects_bad_token_without_upstream_call(httpx_mock: HTTPXMock):
    client = _client()
    resp = client.get("/api/stream/proxy", params={"token": "forged.AAAA"})
    assert resp.status_code == 403
    # No upstream request must have been issued for a rejected token.
    assert httpx_mock.get_requests() == []


def test_proxy_rejects_expired_token_without_upstream_call(httpx_mock: HTTPXMock):
    client = _client()
    secret = client.app.state.proxy_secret
    token = sign(
        secret,
        "https://cdn.example/v.mp4",
        "https://uqload.is/",
        "uqload",
        ttl=-1,
        now=time.time() - 10,
    )
    resp = client.get("/api/stream/proxy", params={"token": token})
    assert resp.status_code == 403
    assert httpx_mock.get_requests() == []


# --------------------------------------------------------------------------- #
# T3 — HLS playlist rewriting
# --------------------------------------------------------------------------- #


def _collect_proxied(
    text: str, base_url: str = "https://cdn.example/hls/master.m3u8"
) -> str:
    """Rewrite a playlist, tagging each minted URL with the absolute target it wraps."""
    return rewrite_playlist(text, base_url, mint_token=lambda url: f"PROXY[{url}]")


def test_rewrite_relative_segments():
    playlist = "#EXTM3U\n#EXTINF:4.0,\nseg0.ts\n#EXTINF:4.0,\nseg1.ts\n"
    out = _collect_proxied(playlist, base_url="https://cdn.example/hls/media.m3u8")
    assert "PROXY[https://cdn.example/hls/seg0.ts]" in out
    assert "PROXY[https://cdn.example/hls/seg1.ts]" in out
    # Non-URI tag lines are untouched.
    assert "#EXTINF:4.0," in out


def test_rewrite_absolute_segments():
    playlist = "#EXTM3U\n#EXTINF:4.0,\nhttps://other.cdn/abs/seg0.ts\n"
    out = _collect_proxied(playlist)
    assert "PROXY[https://other.cdn/abs/seg0.ts]" in out


def test_rewrite_master_variants():
    playlist = (
        "#EXTM3U\n"
        "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n"
        "480/index.m3u8\n"
        "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n"
        "https://other.cdn/720/index.m3u8\n"
    )
    out = _collect_proxied(playlist)
    assert "PROXY[https://cdn.example/hls/480/index.m3u8]" in out
    assert "PROXY[https://other.cdn/720/index.m3u8]" in out


def test_rewrite_aes_key_uri():
    playlist = (
        "#EXTM3U\n"
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1234\n'
        "#EXTINF:4.0,\nseg0.ts\n"
    )
    out = _collect_proxied(playlist, base_url="https://cdn.example/hls/media.m3u8")
    assert 'URI="PROXY[https://cdn.example/hls/key.bin]"' in out
    # The rest of the KEY line (METHOD, IV) is preserved.
    assert "METHOD=AES-128" in out
    assert "IV=0x1234" in out


def test_rewrite_map_uri():
    playlist = "#EXTM3U\n" '#EXT-X-MAP:URI="init.mp4"\n' "#EXTINF:4.0,\nseg0.m4s\n"
    out = _collect_proxied(playlist, base_url="https://cdn.example/hls/media.m3u8")
    assert 'URI="PROXY[https://cdn.example/hls/init.mp4]"' in out
    assert "PROXY[https://cdn.example/hls/seg0.m4s]" in out


def test_rewrite_preserves_byterange_and_blanks():
    playlist = "#EXTM3U\n\n#EXT-X-BYTERANGE:75232@0\nseg0.ts\n"
    out = _collect_proxied(playlist, base_url="https://cdn.example/hls/media.m3u8")
    assert "#EXT-X-BYTERANGE:75232@0" in out
    assert "PROXY[https://cdn.example/hls/seg0.ts]" in out


def test_proxy_serves_rewritten_playlist_end_to_end(httpx_mock: HTTPXMock):
    client = _client()
    secret = client.app.state.proxy_secret
    token = sign(
        secret, "https://cdn.example/hls/master.m3u8", "https://vidzy.org/", "vidzy"
    )

    httpx_mock.add_response(
        url="https://cdn.example/hls/master.m3u8",
        headers={"Content-Type": "application/vnd.apple.mpegurl"},
        text="#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480/index.m3u8\n",
    )

    resp = client.get("/api/stream/proxy", params={"token": token})
    assert resp.status_code == 200
    assert "mpegurl" in resp.headers["content-type"]
    # The variant URI is now a proxy link carrying a signed token, not the raw CDN URL.
    assert "480/index.m3u8" not in resp.text
    assert "/api/stream/proxy?token=" in resp.text

    # And that minted token resolves back to the correct absolute segment URL.
    minted = resp.text.strip().splitlines()[-1]
    inner_token = minted.split("token=", 1)[1]
    payload = verify(secret, urllib.parse.unquote(inner_token))
    assert payload["u"] == "https://cdn.example/hls/480/index.m3u8"
    assert payload["r"] == "https://vidzy.org/"
