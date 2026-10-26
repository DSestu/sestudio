from __future__ import annotations

import base64
import hashlib
import json
import os
import re

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pytest_httpx import HTTPXMock

from sestudio.sites import SiteError, StreamCandidate
from sestudio.sites.bflix import API, DEFAULT_SECRET, SERVERS, TMDB, BflixSite
from tests.sites.contract import SiteContractMixin

SHOW = {
    "id": 1399,
    "name": "Game of Thrones",
    "first_air_date": "2011-04-17",
    "poster_path": "/got.jpg",
    "seasons": [
        {"season_number": 0, "episode_count": 9, "air_date": "2010-12-05"},
        {"season_number": 1, "episode_count": 10, "air_date": "2011-04-17"},
        {
            "season_number": 2,
            "episode_count": 10,
            "air_date": "2012-04-01",
            "poster_path": "/s2.jpg",
        },
        {"season_number": 3, "episode_count": 0, "air_date": None},
    ],
}
SEARCH = {
    "results": [
        {
            "id": 550,
            "media_type": "movie",
            "title": "Fight Club",
            "release_date": "1999-10-15",
        },
        {"id": 1399, "media_type": "tv", "name": "Game of Thrones"},
        {"id": 7, "media_type": "person", "name": "Someone"},
        {
            "id": 9,
            "media_type": "movie",
            "title": "Unreleased",
            "release_date": "2999-01-01",
        },
    ]
}


def _tmdb(path: str) -> re.Pattern[str]:
    return re.compile(re.escape(f"{TMDB}/{path}") + r"\?.*")


def _vidnest(path: str) -> re.Pattern[str]:
    return re.compile(re.escape(f"{API}/{path}") + r"\?_n=[\w-]+$")


def _sealed(plain: object, secret: str = DEFAULT_SECRET) -> dict[str, object]:
    """A vidnest v2 answer, encrypted the way its API does."""
    nonce, iv = "abc", os.urandom(12)
    key = hashlib.sha256(f"{nonce}|{secret}".encode()).digest()
    blob = iv + AESGCM(key).encrypt(iv, json.dumps(plain).encode(), None)
    return {
        "v": 2,
        "n": nonce,
        "d": base64.urlsafe_b64encode(blob).decode().rstrip("="),
    }


@pytest.fixture(autouse=True)
def _key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TMDB_API_KEY", "k")


@pytest.fixture()
def site() -> BflixSite:
    return BflixSite()


class TestBflixContract(SiteContractMixin):
    @pytest.fixture()
    def searchable_query(self, httpx_mock: HTTPXMock) -> str:
        httpx_mock.add_response(url=_tmdb("search/multi"), json=SEARCH)
        httpx_mock.add_response(url=_tmdb("tv/1399"), json=SHOW)
        return "thrones"


def test_search_keeps_relevance_order_and_expands_aired_seasons(
    site, httpx_mock: HTTPXMock
):
    httpx_mock.add_response(url=_tmdb("search/multi"), json=SEARCH)
    httpx_mock.add_response(url=_tmdb("tv/1399"), json=SHOW)
    cards = site.search("thrones")
    assert [(c.title, c.season_number, c.is_film) for c in cards] == [
        ("Fight Club", 0, True),
        ("Game of Thrones - Saison 1", 1, False),
        ("Game of Thrones - Saison 2", 2, False),
    ]
    assert cards[0].page_url == "https://bflixs.cx/details.html?id=550&type=movie"
    assert (
        cards[2].page_url == "https://bflixs.cx/details.html?id=1399&type=tv&season=2"
    )
    assert cards[1].poster_url.endswith("/got.jpg")
    assert cards[2].poster_url.endswith("/s2.jpg")
    assert site.owns_url(cards[2].page_url)
    assert (
        site.web_url(cards[2].page_url)
        == "https://bflixs.cx/details.html?id=1399&type=tv"
    )


def test_fetch_page_lists_aired_episodes_on_every_server(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=_tmdb("tv/1399/season/2"),
        json={
            "episodes": [
                {
                    "episode_number": 1,
                    "name": "Le Nord se souvient",
                    "air_date": "2012-04-01",
                },
                {"episode_number": 2, "name": "", "air_date": "2012-04-08"},
                {"episode_number": 3, "name": "Later", "air_date": None},
            ]
        },
    )
    page = site.fetch_page("https://bflixs.cx/details.html?id=1399&type=tv&season=2")
    assert (page.season, page.is_film, page.available_langs) == (2, False, ["vostfr"])
    assert [(e.number, e.title) for e in page.episodes] == [
        (1, "Le Nord se souvient"),
        (2, "Episode 2"),
    ]
    assert page.episodes[1].embed_urls == {s: "tv/1399/2/2" for s in SERVERS}


def test_fetch_page_rejects_foreign_urls(site):
    with pytest.raises(SiteError):
        site.fetch_page("https://bflixs.cx/home")


def _subtitle_lists(httpx_mock: HTTPXMock, vdrk: list, wyzie: list) -> None:
    httpx_mock.add_response(url="https://sub.vdrk.site/v2/tv/1399/1/1", json=vdrk)
    httpx_mock.add_response(
        url="https://vidcore.io/wyzie?id=1399&season=1&episode=1", json=wyzie
    )


def test_resolve_decrypts_the_stream_and_merges_subtitles(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=_vidnest("rpmvid/tv/1399/1/1"),
        json=_sealed(
            {
                "streams": [
                    {"url": "/hls/relative", "type": "hls"},
                    {
                        "url": "https://cdn.test/master.m3u8",
                        "headers": {"Referer": "https://moviesapi.to/"},
                    },
                ]
            }
        ),
    )
    _subtitle_lists(
        httpx_mock,
        vdrk=[
            {"label": "English", "file": "https://cache.vdrk.site/en.vtt"},
            {"label": "Arabic", "file": "https://cache.vdrk.site/ar.vtt"},
        ],
        wyzie=[
            {
                "language": "fr",
                "url": "https://vidcore.io/wyzie/hi",
                "isHearingImpaired": True,
            },
            {"language": "fr", "url": "https://vidcore.io/wyzie/fr"},
            {"language": "en", "url": "https://vidcore.io/wyzie/en"},
        ],
    )
    source = site.resolve_candidate(StreamCandidate("rpmvid", "tv/1399/1/1"), {})
    assert (source.url, source.referer, source.provider) == (
        "https://cdn.test/master.m3u8",
        "https://moviesapi.to/",
        "rpmvid",
    )
    # French first and on; vdrk's WebVTT wins over wyzie's SubRip for English.
    assert [(s.lang, s.url, s.default) for s in source.subtitles] == [
        ("fr", "https://vidcore.io/wyzie/fr#srt", True),
        ("en", "https://cache.vdrk.site/en.vtt", False),
    ]


def test_resolve_takes_a_top_level_url_and_survives_subtitle_failures(
    site, httpx_mock: HTTPXMock
):
    httpx_mock.add_response(
        url=_vidnest("flixhq/movie/550"),
        json=_sealed({"status": "success", "url": "https://w.test/hls/x.m3u8"}),
    )
    httpx_mock.add_response(url="https://sub.vdrk.site/v2/movie/550", status_code=500)
    httpx_mock.add_response(url="https://vidcore.io/wyzie?id=550", status_code=500)
    source = site.resolve_candidate(StreamCandidate("flixhq", "movie/550"), {})
    assert (source.url, source.referer, source.subtitles) == (
        "https://w.test/hls/x.m3u8",
        "https://vidnest.fun/",
        [],
    )


def test_a_rotated_secret_is_reread_from_the_bundle(site, httpx_mock: HTTPXMock):
    secret = "N3wS3cr3tN3wS3cr3tN3wS3cr3tN3wS3cr3t"
    httpx_mock.add_response(
        url=_vidnest("flixhq/movie/550"),
        json=_sealed({"url": "https://w.test/x.m3u8"}, secret),
    )
    httpx_mock.add_response(
        url="https://vidnest.fun/movie/550",
        text='<script src="/_next/static/chunks/a1.js"></script>',
    )
    httpx_mock.add_response(
        url="https://vidnest.fun/_next/static/chunks/a1.js",
        text=f'let r="{secret}",n="https://new.vidnest.fun";',
    )
    httpx_mock.add_response(url="https://sub.vdrk.site/v2/movie/550", json=[])
    httpx_mock.add_response(url="https://vidcore.io/wyzie?id=550", json=[])
    source = site.resolve_candidate(StreamCandidate("flixhq", "movie/550"), {})
    assert source.url == "https://w.test/x.m3u8"
    assert site._secret == secret


def test_without_a_tmdb_key_search_says_so(site, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("sestudio.sites.bflix.tmdb_key", lambda: "")
    with pytest.raises(SiteError, match="TMDB API key"):
        site.search("anything")
