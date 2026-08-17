from __future__ import annotations

import pytest
from pytest_httpx import HTTPXMock

from sestudio.sites import build_sites
from sestudio.sites.fstream import FstreamSite
from tests.conftest import load_fixture
from tests.sites.contract import SiteContractMixin

BASE = "https://fs03.lol"
SEASON_URL = f"{BASE}/16676-stargate-sg-1-saison-1-streaming-complet-vf-vostfr.html"

SEARCH_HTML = """
<div class='search-item' onclick="location.href='/16676-stargate-sg-1-saison-1-streaming.html'">
  <div class='search-poster'><img src='https://image.tmdb.org/poster.jpg' alt='x'></div>
  <div class='search-info'><div class='search-title'>Stargate SG-1 - Saison 1 (1997)</div></div>
</div>
"""


class TestFstreamSiteContract(SiteContractMixin):
    @pytest.fixture()
    def site(self) -> FstreamSite:
        return FstreamSite("fstream", "FStream", BASE)

    @pytest.fixture()
    def searchable_query(self, httpx_mock: HTTPXMock) -> str:
        httpx_mock.add_response(url=BASE, method="GET", text="")
        httpx_mock.add_response(
            url=f"{BASE}/engine/ajax/search.php", method="POST", text=SEARCH_HTML
        )
        return "stargate"


def test_build_sites_registers_both_instances():
    sites = build_sites(BASE)
    assert {"fstream", "french-manga"} <= set(sites)
    assert sites["fstream"].base_url == BASE
    assert not sites["fstream"].is_anime
    assert sites["french-manga"].is_anime
    # Both DLE instances keep the historical films folder — no disk migration.
    assert sites["fstream"].films_dirname == "sestudio_films"
    assert sites["french-manga"].films_dirname == "sestudio_films"


def test_fetch_page_returns_langs_in_one_pass(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=SEASON_URL, text=load_fixture("season_page.html"))
    httpx_mock.add_response(
        url=f"{BASE}/data/eps_16676.txt",
        text=load_fixture("eps_16676.json"),
        headers={"Content-Type": "application/json"},
    )
    site = FstreamSite("fstream", "FStream", BASE)
    page = site.fetch_page(SEASON_URL, lang="vf")
    assert page.season == 1
    assert not page.is_film
    assert len(page.episodes) == 22
    assert "vf" in page.available_langs


def test_anime_instance_marks_cards(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url="https://french-manga.net", method="GET", text="")
    httpx_mock.add_response(
        url="https://french-manga.net/engine/ajax/search.php",
        method="POST",
        text=SEARCH_HTML,
    )
    site = FstreamSite(
        "french-manga", "French-Manga", "https://french-manga.net", is_anime=True
    )
    cards = site.search("stargate")
    assert cards
    assert all(c.source == "french-manga" and c.is_anime for c in cards)


def test_owns_url_matches_own_host_only():
    site = FstreamSite("fstream", "FStream", BASE)
    assert site.owns_url(f"{BASE}/16676-x.html")
    assert not site.owns_url("https://french-manga.net/123-y.html")
    assert not site.owns_url("")
