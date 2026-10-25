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


LISTING_HTML = """
<div id="dle-content">
  <div class="short"><div class="short-in nl">
    <div class="short-year"><a href="#">2025</a></div>
    <span id="desc-111" style="display:none;">Un flic et son chien.</span>
    <a class="short-poster" href="/index.php?newsid=111"><img src="https://img/111.jpg"></a>
    <div class="short-title">Muzzle: City of Wolves</div>
  </div></div>
  <div class="short"><div class="short-in nl">
    <a class="short-poster" href="/index.php?newsid=222"><img src="https://img/222.jpg"></a>
    <div class="short-title">Lupin - Saison 4</div>
  </div></div>
</div>
<span class="pnext"><a href="/index.php?cstart=2">next</a></span>
"""


def _listing_site() -> FstreamSite:
    return build_sites(BASE)["fstream"]  # type: ignore[return-value]


def test_discover_reads_a_listing_into_openable_cards(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=BASE, method="GET", text="")
    httpx_mock.add_response(url=f"{BASE}/films/actions/", text=LISTING_HTML)
    got = _listing_site().discover({"kind": "films", "genre": "/films/actions/"}, 1)
    film, series = (c["open"]["card"] for c in got["cards"])
    assert got["has_more"] and got["note"] == ""
    # DLE serves a title under any slug; the parsers need the /N-slug.html form.
    assert film["page_url"] == f"{BASE}/111-muzzle-city-of-wolves.html"
    assert film["is_film"] and film["year"] == 2025 and film["source"] == "fstream"
    assert got["cards"][0]["overview"] == "Un flic et son chien."
    assert (series["series_name"], series["season_number"]) == ("Lupin", 4)
    assert not series["is_film"]


def test_discover_sorts_by_post_and_lets_a_genre_win_over_a_list(
    httpx_mock: HTTPXMock,
):
    httpx_mock.add_response(url=BASE, method="GET", text="")
    httpx_mock.add_response(
        url=f"{BASE}/k-drama-/page/2/", method="POST", text="<div id='dle-content'>"
    )
    got = _listing_site().discover(
        {
            "kind": "series",
            "genre": "/k-drama-/",
            "list": "/s-tv/s-vf/",
            "sort": "title",
        },
        2,
    )
    body = httpx_mock.get_requests()[-1].content.decode()
    assert "dlenewssortby=title" in body and "dledirection=asc" in body
    assert got["cards"] == [] and not got["has_more"]
    assert "Genre only" in got["note"]


def test_discover_past_the_last_page_is_empty(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=BASE, method="GET", text="")
    httpx_mock.add_response(url=f"{BASE}/films/page/99/", status_code=404)
    got = _listing_site().discover({}, 99)
    assert got["cards"] == [] and not got["has_more"]


def test_schema_lists_the_genres_of_the_chosen_kind():
    site = _listing_site()
    genres = {f.key: f for f in site.schema({"kind": "series"})}["genre"]
    assert {"value": "/k-drama-/", "label": "K-drama"} in genres.options
    assert [f.key for f in build_sites(BASE)["french-manga"].schema({})] == [
        "sort",
        "genre",
        "list",
    ]
