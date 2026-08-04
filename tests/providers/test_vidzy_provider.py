from __future__ import annotations

import base64

import pytest
from pytest_httpx import HTTPXMock

from sestudio.providers.base import ProviderError
from sestudio.providers.vidzy import VidzyProvider

# The real m3u8 URL we expect the provider to recover from the obfuscated embed.
_EXPECTED = "https://v6.vidzy.cc/hls2/02/00040/abc_n/master.m3u8?t=token&s=1&e=2"
_KEY = [214, 91, 173, 44, 122, 250, 19, 88]


def _encode(url: str, key: list[int]) -> str:
    """Inverse of the embed's decoder: XOR with the rotating key, then base64."""
    xored = bytes(ord(c) ^ key[i % len(key)] for i, c in enumerate(url))
    return base64.b64encode(xored).decode()


def _packed_embed(payload_b64: str, key: list[int]) -> str:
    """A minimal page whose (unpacked) script carries the obfuscated src.

    _unpack short-circuits: if the packed-script regex doesn't match it raises,
    so we ship the decoder inline in a script the provider reads after unpacking.
    Here we sidestep packing by embedding the eval(function(p,a,c,k...)) marker
    with the payload already 'unpacked' — the unpacker returns the group verbatim
    when there is a single literal segment.
    """
    key_csv = ",".join(str(k) for k in key)
    src = (
        f'sources:[{{src:(function(s){{var k=[{key_csv}],b=atob(s),r="";'
        f"for(var i=0;i<b.length;i++){{r+=String.fromCharCode(b.charCodeAt(i)^k[i%8])}}"
        f'return r}})("{payload_b64}"),type:"application/x-mpegURL"}}]'
    )
    # A decoy plain m3u8 that must NOT be picked over the real (obfuscated) one.
    decoy = 'var _fsvHls="https://s1.fsvid.lol/troll/master.m3u8";'
    packed = f"<script>eval(function(p,a,c,k,e,d){{}}('{decoy}{src}',10,10,''.split('|')))</script>"
    return packed


def test_vidzy_decodes_obfuscated_source(httpx_mock: HTTPXMock):
    payload = _encode(_EXPECTED, _KEY)
    httpx_mock.add_response(
        url="https://vidzy.live/embed-abc.html",
        method="GET",
        text=_packed_embed(payload, _KEY),
    )
    src = VidzyProvider().get_stream_url("https://vidzy.live/embed-abc.html")
    assert src.url == _EXPECTED
    assert src.provider == "vidzy"


# The other derivation in the wild: the key is an arithmetic ramp rather than a
# literal array, and the decoded string is reversed before being returned.
_SEED, _STEP = 0x5B, 37


def _encode_ramp(url: str, seed: int, step: int) -> str:
    """Inverse of the ramp decoder: reverse, XOR with the ramp, then base64."""
    reversed_url = url[::-1]
    xored = bytes(
        ord(c) ^ ((seed + i * step) & 255) for i, c in enumerate(reversed_url)
    )
    return base64.b64encode(xored).decode()


def _packed_ramp_embed(payload_b64: str, seed: int, step: int) -> str:
    src = (
        f'sources:[{{src:(function(s){{var b=atob(s),r="";'
        f"for(var i=0;i<b.length;i++){{var kk=({hex(seed)}+i*{step})&255;"
        f"r+=String.fromCharCode(b.charCodeAt(i)^kk)}}"
        f'return r.split("").reverse().join("")}})("{payload_b64}"),'
        f'type:"application/x-mpegURL"}}]'
    )
    decoy = 'var _fsvHls="https://s1.fsvid.lol/troll/master.m3u8";'
    return f"<script>eval(function(p,a,c,k,e,d){{}}('{decoy}{src}',10,10,''.split('|')))</script>"


def test_vidzy_decodes_ramp_obfuscated_source(httpx_mock: HTTPXMock):
    payload = _encode_ramp(_EXPECTED, _SEED, _STEP)
    httpx_mock.add_response(
        url="https://vidzy.live/embed-ramp.html",
        method="GET",
        text=_packed_ramp_embed(payload, _SEED, _STEP),
    )
    src = VidzyProvider().get_stream_url("https://vidzy.live/embed-ramp.html")
    assert src.url == _EXPECTED
    assert src.provider == "vidzy"


def test_vidzy_tries_both_orientations(httpx_mock: HTTPXMock):
    """A reversed payload resolves even when the body has no .reverse() marker.

    Orientation is discovered by trying both, not by sniffing the body, so a
    rotation that drops or renames the reversal step still decodes.
    """
    page = _packed_ramp_embed(
        _encode_ramp(_EXPECTED, _SEED, _STEP), _SEED, _STEP
    ).replace('.split("").reverse().join("")', "")
    httpx_mock.add_response(
        url="https://vidzy.live/embed-noflag.html", method="GET", text=page
    )
    src = VidzyProvider().get_stream_url("https://vidzy.live/embed-noflag.html")
    assert src.url == _EXPECTED


def test_vidzy_falls_through_wrong_scheme_to_right_one(httpx_mock: HTTPXMock):
    """A body carrying both derivations resolves via whichever actually works.

    The decoy array key matches first; only the ramp decodes to a real URL, so
    the array must not be allowed to claim the payload and fail the whole embed.
    """
    page = _packed_ramp_embed(
        _encode_ramp(_EXPECTED, _SEED, _STEP), _SEED, _STEP
    ).replace("var b=atob(s)", "var k=[9,9,9,9],b=atob(s)")
    httpx_mock.add_response(
        url="https://vidzy.live/embed-both.html", method="GET", text=page
    )
    src = VidzyProvider().get_stream_url("https://vidzy.live/embed-both.html")
    assert src.url == _EXPECTED


def test_vidzy_reports_unknown_scheme(httpx_mock: HTTPXMock):
    """An unrecognised derivation fails loudly rather than returning garbage."""
    page = _packed_ramp_embed(
        _encode_ramp(_EXPECTED, _SEED, _STEP), _SEED, _STEP
    ).replace(f"({hex(_SEED)}+i*{_STEP})&255", "fresh_scheme(i)")
    httpx_mock.add_response(
        url="https://vidzy.live/embed-new.html", method="GET", text=page
    )
    with pytest.raises(ProviderError, match="rotated to a new one"):
        VidzyProvider().get_stream_url("https://vidzy.live/embed-new.html")
