from __future__ import annotations

import base64
import codecs
import json

import pytest
from pytest_httpx import HTTPXMock

from sestudio.providers.base import ProviderError
from sestudio.providers.voe import VoeProvider

_EXPECTED = "https://ugc-cdn.example.com/engine/hls2-c/01/13814/abc_,n,.urlset/master.m3u8?t=tok"
_MP4 = "https://ugc-cdn.example.com/engine/download/01/13814/abc_n.mp4?t=tok"


def _encode_payload(config: dict) -> str:
    """Inverse of VOE's obfuscation chain, applied in reverse order.

    The provider decodes rot13 → junk→"_" → base64 → shift(-3) → reverse →
    base64 → JSON, so we build the payload back up from the innermost step. Junk
    digraphs are sprinkled in because the decoder is meant to survive them: it
    maps them to "_", which the loose base64 pass then discards.
    """
    stage = base64.b64encode(json.dumps(config).encode()).decode()  # innermost b64
    stage = stage[::-1]  # undone by .reverse
    stage = "".join(chr(ord(c) + 3) for c in stage)  # undone by shift(-3)
    stage = base64.b64encode(stage.encode()).decode()  # undone by outer b64
    # Salt with the junk digraphs the real payloads carry.
    salted = ""
    for i, ch in enumerate(stage):
        salted += ch
        if i and i % 40 == 0:
            salted += "!!" if i % 80 == 0 else "^^"
    return codecs.encode(salted, "rot13")  # undone by rot13


def _player_page(config: dict) -> str:
    payload = _encode_payload(config)
    blob = json.dumps([payload])
    return (
        "<html><head><title>Watch thing - VOE</title></head><body>"
        f'<script type="application/json">{blob}</script>'
        '<script src="/js/loader.abc.js"></script>'
        "</body></html>"
    )


def _js_redirect_page(target: str) -> str:
    """The localStorage-gated hop that ends the header-redirect chain."""
    return (
        "<html><body><script>"
        "if (typeof localStorage !== 'undefined') {"
        "  const permanentToken = localStorage.getItem('permanentToken');"
        "  if (permanentToken) { /* ... */ } else {"
        f"    window.location.href = '{target}';"
        "  }"
        "} else {"
        f"  window.location.href = '{target}';"
        "}"
        "</script></body></html>"
    )


def test_voe_decodes_player_config(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://voe.example/e/abc",
        method="GET",
        text=_player_page({"source": _EXPECTED, "direct_access_url": _MP4}),
    )
    src = VoeProvider().get_stream_url("https://voe.example/e/abc")
    assert src.url == _EXPECTED
    assert src.provider == "voe"


def test_voe_follows_js_redirect_hop(httpx_mock: HTTPXMock):
    """The last hop is a JS assignment, not a Location header — follow it too."""
    httpx_mock.add_response(
        url="https://gate.example/e/abc",
        method="GET",
        text=_js_redirect_page("https://player.example/e/abc"),
    )
    httpx_mock.add_response(
        url="https://player.example/e/abc",
        method="GET",
        text=_player_page({"source": _EXPECTED}),
    )
    src = VoeProvider().get_stream_url("https://gate.example/e/abc")
    assert src.url == _EXPECTED


def test_voe_falls_back_to_direct_access_url(httpx_mock: HTTPXMock):
    """A config with no HLS source still yields the progressive download URL."""
    httpx_mock.add_response(
        url="https://voe.example/e/nohls",
        method="GET",
        text=_player_page({"direct_access_url": _MP4}),
    )
    src = VoeProvider().get_stream_url("https://voe.example/e/nohls")
    assert src.url == _MP4


def test_voe_reports_missing_player_config(httpx_mock: HTTPXMock):
    """A terminal page with neither config nor redirect fails loudly."""
    httpx_mock.add_response(
        url="https://voe.example/e/dead",
        method="GET",
        text="<html><body>nothing here</body></html>",
    )
    with pytest.raises(ProviderError, match="no player config"):
        VoeProvider().get_stream_url("https://voe.example/e/dead")


def test_voe_reports_undecodable_payload(httpx_mock: HTTPXMock):
    """A payload that is not VOE's scheme fails loudly rather than silently."""
    blob = json.dumps(["not-actually-obfuscated-anything"])
    httpx_mock.add_response(
        url="https://voe.example/e/bad",
        method="GET",
        text=f'<html><script type="application/json">{blob}</script></html>',
    )
    with pytest.raises(ProviderError, match="Could not decode VOE player config"):
        VoeProvider().get_stream_url("https://voe.example/e/bad")


def test_voe_delegates_mislabelled_luluvid_slot(httpx_mock: HTTPXMock):
    """Some "voe" slots hand off to LuluStream; those must resolve, not fail.

    Those titles often carry no separate luluvid entry, so this slot is the only
    route to the stream — see _LULUVID_HOSTS in the provider.
    """
    lulu_stream = "https://cdn.example/hls2/03/03252/x4_h/master.m3u8?t=tok"
    packed = (
        "<script>eval(function(p,a,c,k,e,d){}("
        f"'sources:[{{file:\"{lulu_stream}\"}}]',10,10,''.split('|')))</script>"
    )
    httpx_mock.add_response(
        url="https://wrapper.example/voe1/newPlayer.php?id=x",
        method="GET",
        text="<html><body>handing off</body></html>",
        status_code=303,
        headers={"Location": "https://luluvdo.com/e/x4eyb8np2x91"},
    )
    # Fetched twice: once as the last hop of the voe chain (where the hand-off is
    # detected) and once by LuluvidProvider, which re-requests with its own headers.
    for _ in range(2):
        httpx_mock.add_response(
            url="https://luluvdo.com/e/x4eyb8np2x91", method="GET", text=packed
        )
    src = VoeProvider().get_stream_url(
        "https://wrapper.example/voe1/newPlayer.php?id=x"
    )
    assert src.url == lulu_stream
    assert src.provider == "luluvid"
