from __future__ import annotations

import re

import pytest
from pytest_httpx import HTTPXMock

from sestudio.providers import jsdecode
from sestudio.providers.subtitles import srt_to_vtt
from sestudio.sites import StreamCandidate
from sestudio.sites.kisskh import API, KisskhSite, _KeyConfig
from tests.sites.contract import SiteContractMixin


def _hit(drama_id: int, title: str, episodes: int = 16) -> dict:
    return {
        "id": drama_id,
        "title": title,
        "thumbnail": f"https://img.example/{drama_id}.jpg",
        "episodesCount": episodes,
    }


class TestKisskhSiteContract(SiteContractMixin):
    @pytest.fixture()
    def site(self) -> KisskhSite:
        return KisskhSite()

    @pytest.fixture()
    def searchable_query(self, httpx_mock: HTTPXMock) -> str:
        httpx_mock.add_response(
            url=re.compile(rf"{API}/DramaList/Search\?q=goblin&type=\d"),
            json=[_hit(26, "Goblin")],
            is_reusable=True,
        )
        return "goblin"


def test_search_tags_each_type_and_drops_duplicates(httpx_mock: HTTPXMock):
    by_type = {
        1: [_hit(26, "Goblin"), _hit(7, "Love Season 2 (2021)")],
        2: [_hit(9, "Goblin Movie", episodes=1), _hit(26, "Goblin")],
        3: [_hit(11, "Goblin Slayer")],
        4: [],
    }
    for kind, hits in by_type.items():
        httpx_mock.add_response(
            url=f"{API}/DramaList/Search?q=goblin&type={kind}", json=hits
        )
    cards = {c.newsid: c for c in KisskhSite().search("goblin")}

    assert sorted(cards) == ["11", "26", "7", "9"]
    assert cards["9"].is_film and cards["9"].season_number == 0
    assert cards["11"].is_anime
    season2 = cards["7"]
    assert (season2.series_name, season2.season_number, season2.year) == (
        "Love (2021)",
        2,
        2021,
    )
    assert cards["26"].page_url == "https://kisskh.do/Drama/Goblin?id=26"


def test_fetch_page_orders_episodes_and_keeps_specials(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=f"{API}/DramaList/Drama/26?isq=false",
        json={
            "title": "Goblin",
            "type": "TVSeries",
            "episodes": [
                {"id": 3, "number": 2.0},
                {"id": 9, "number": 1.5},
                {"id": 1, "number": 1.0},
            ],
        },
    )
    page = KisskhSite().fetch_page("https://kisskh.do/Drama/Goblin?id=26", "vf")

    assert not page.is_film and page.season == 1
    assert page.available_langs == ["vostfr"]
    assert [(e.number, e.title) for e in page.episodes] == [
        (1, "Episode 1"),
        (2, "Episode 2"),
        (3, "Episode 1.5"),
    ]
    assert page.episodes[0].embed_urls == {"kisskh": f"{API}/DramaList/Episode/1.png"}


def test_fetch_page_reads_a_single_part_movie_as_film(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=f"{API}/DramaList/Drama/5?isq=false",
        json={
            "title": "Colony",
            "type": "Movie",
            "episodes": [{"id": 4, "number": 1.0}],
        },
    )
    page = KisskhSite().fetch_page("https://kisskh.do/Drama/Colony?id=5")
    assert page.is_film and page.season == 0
    assert page.episodes[0].filename == "Colony.mp4"


@pytest.mark.skipif(not jsdecode.ENGINE_AVAILABLE, reason="needs a JS engine")
def test_resolve_signs_both_calls_and_prefers_french_subtitles(
    httpx_mock: HTTPXMock, monkeypatch: pytest.MonkeyPatch
):
    site = KisskhSite()
    cfg = _KeyConfig(
        script="function sign(ep,_,ver,guid){return 'k'+ep+guid+ver}",
        function="sign",
        app_ver="v1",
        platform_ver=1,
        video_guid="VID",
        sub_guid="SUB",
    )
    monkeypatch.setattr(site, "_key_config", lambda: cfg)
    httpx_mock.add_response(
        url=f"{API}/DramaList/Episode/42.png?err=false&ts=null&time=null&kkey=k42VIDv1",
        json={"Video": "https://cdn.example/ep.mp4?verify=x"},
    )
    httpx_mock.add_response(
        url=f"{API}/Sub/42?kkey=k42SUBv1",
        json=[
            {
                "src": "https://sub.example/ep.en.srt",
                "label": "English",
                "land": "en",
                "default": True,
            },
            {
                "src": "https://sub.example/ep.fr.srt",
                "label": "French",
                "land": "fr",
                "default": False,
            },
            {
                "src": "https://sub.example/ep.th.txt",
                "label": "Thai",
                "land": "th",
                "default": False,
            },
        ],
    )
    source = site.resolve_candidate(
        StreamCandidate("kisskh", f"{API}/DramaList/Episode/42.png"), {}
    )

    assert source.url == "https://cdn.example/ep.mp4?verify=x"
    assert source.referer == "https://kisskh.do/"
    # The encrypted .txt track is dropped; French wins the default.
    assert [(s.lang, s.default) for s in source.subtitles] == [
        ("en", False),
        ("fr", True),
    ]


def test_srt_becomes_vtt():
    srt = "﻿1\r\n00:00:01,730 --> 00:00:03,960\r\nHi, 1,000 times\r\n".encode()
    assert srt_to_vtt(srt).decode() == (
        "WEBVTT\n\n1\n00:00:01.730 --> 00:00:03.960\nHi, 1,000 times\n"
    )
    vtt = b"WEBVTT\n\n00:01.000 --> 00:02.000\nx\n"
    assert srt_to_vtt(vtt) == vtt
