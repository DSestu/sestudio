import pytest
import httpx
from pytest_httpx import HTTPXMock

from sestudio.providers.uqload import UqloadProvider
from sestudio.providers.base import ProviderError
from tests.conftest import load_fixture

EMBED_URL = "https://uqload.is/embed-czbs41i6g7nb.html"


@pytest.fixture
def uqload_html() -> str:
    return load_fixture("uqload_embed.html")


def test_uqload_extracts_mp4_url(httpx_mock: HTTPXMock, uqload_html):
    httpx_mock.add_response(url=EMBED_URL, text=uqload_html)

    provider = UqloadProvider()
    source = provider.get_stream_url(EMBED_URL)

    assert source.url.startswith("https://strm")
    assert source.url.endswith("/v.mp4")


def test_uqload_referer_is_correct(httpx_mock: HTTPXMock, uqload_html):
    httpx_mock.add_response(url=EMBED_URL, text=uqload_html)

    provider = UqloadProvider()
    source = provider.get_stream_url(EMBED_URL)

    assert source.referer == "https://uqload.is/"


def test_uqload_provider_name(httpx_mock: HTTPXMock, uqload_html):
    httpx_mock.add_response(url=EMBED_URL, text=uqload_html)

    provider = UqloadProvider()
    source = provider.get_stream_url(EMBED_URL)

    assert source.provider == "uqload"


def test_uqload_raises_on_missing_url(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=EMBED_URL, text="<html><body>no video here</body></html>")

    provider = UqloadProvider()

    with pytest.raises(ProviderError):
        provider.get_stream_url(EMBED_URL)
