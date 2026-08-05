from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from sestudio.providers.base import ProviderError
from sestudio.providers.filmoon import FilmoonProvider

_EXPECTED = "https://s25-wyl1.example.com/hls/44uUhOfhNdmq/master.m3u8?token=abc-123"
_CODE = "y0KgUZcqTpTat"


def _api_payload(**overrides) -> dict:
    payload = {
        "default_sub_lang": "French",
        "filecode": _CODE,
        "streaming_url": _EXPECTED,
        "subtitles": None,
        "thumbnail": "https://thumbs.example.com/x.jpg",
        "title": "",
        "vast_ads": "",
    }
    payload.update(overrides)
    return payload


def test_filmoon_resolves_via_stream_api(httpx_mock: HTTPXMock):
    """The direct embed URL needs one POST — no page fetch, no deobfuscation."""
    httpx_mock.add_response(
        url="https://vidaraa.cc/api/stream",
        method="POST",
        json=_api_payload(),
    )
    src = FilmoonProvider().get_stream_url(f"https://vidaraa.cc/e/{_CODE}")
    assert src.url == _EXPECTED
    assert src.provider == "filmoon"


def test_filmoon_posts_filecode_and_device(httpx_mock: HTTPXMock):
    """The API is keyed on the filecode from the embed path."""
    httpx_mock.add_response(
        url="https://vidaraa.cc/api/stream", method="POST", json=_api_payload()
    )
    FilmoonProvider().get_stream_url(f"https://vidaraa.cc/e/{_CODE}")
    request = httpx_mock.get_requests()[0]
    import json as _json

    body = _json.loads(request.read())
    assert body == {"filecode": _CODE, "device": "web"}


@pytest.mark.parametrize(
    "url",
    [
        f"https://vidaraa.cc/e/{_CODE}",
        f"https://vidaraa.cc/d/{_CODE}",
        f"https://vidaraa.cc/f/{_CODE}",
        f"https://vidaraa.cc/embed-{_CODE}.html",
    ],
)
def test_filmoon_extracts_filecode_from_url_shapes(httpx_mock: HTTPXMock, url: str):
    httpx_mock.add_response(
        url="https://vidaraa.cc/api/stream", method="POST", json=_api_payload()
    )
    assert FilmoonProvider().get_stream_url(url).url == _EXPECTED


def test_filmoon_resolves_wrapper_link(httpx_mock: HTTPXMock):
    """fstream's vostfr/vfq slots are wrapper links carrying no filecode.

    They must be followed to a real filmoon URL before the API can be called.
    """
    httpx_mock.add_response(
        url="https://kokoflix.lol/chamber_go.php?id=abc",
        method="GET",
        status_code=302,
        headers={"Location": f"https://vidaraa.cc/e/{_CODE}"},
    )
    httpx_mock.add_response(
        url=f"https://vidaraa.cc/e/{_CODE}", method="GET", text="<html>player</html>"
    )
    httpx_mock.add_response(
        url="https://vidaraa.cc/api/stream", method="POST", json=_api_payload()
    )
    src = FilmoonProvider().get_stream_url("https://kokoflix.lol/chamber_go.php?id=abc")
    assert src.url == _EXPECTED


def test_filmoon_reports_wrapper_without_filecode(httpx_mock: HTTPXMock):
    """A wrapper that lands somewhere unexpected fails loudly."""
    httpx_mock.add_response(
        url="https://kokoflix.lol/chamber_go.php?id=dead",
        method="GET",
        text="<html>parked</html>",
    )
    with pytest.raises(ProviderError, match="carries no filecode"):
        FilmoonProvider().get_stream_url("https://kokoflix.lol/chamber_go.php?id=dead")


def test_filmoon_reports_missing_streaming_url(httpx_mock: HTTPXMock):
    """A well-formed response with no stream is an error, not an empty URL."""
    httpx_mock.add_response(
        url="https://vidaraa.cc/api/stream",
        method="POST",
        json=_api_payload(streaming_url=""),
    )
    with pytest.raises(ProviderError, match="No streaming_url"):
        FilmoonProvider().get_stream_url(f"https://vidaraa.cc/e/{_CODE}")


def test_filmoon_reports_api_error_status(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://vidaraa.cc/api/stream", method="POST", status_code=403
    )
    with pytest.raises(ProviderError, match="HTTP 403"):
        FilmoonProvider().get_stream_url(f"https://vidaraa.cc/e/{_CODE}")
