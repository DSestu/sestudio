from __future__ import annotations

import base64

from pytest_httpx import HTTPXMock

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
