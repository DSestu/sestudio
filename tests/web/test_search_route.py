from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from sestudio.web.app import create_app

SEARCH_HTML = """
<div class='search-item' onclick="location.href='/16676-stargate-sg-1-saison-1-streaming.html'">
  <div class='search-poster'><img src='https://image.tmdb.org/poster.jpg' alt='Stargate SG-1 - Saison 1'></div>
  <div class='search-info'><div class='search-title'>Stargate SG-1 - Saison 1 (1997)</div></div>
</div>
<div class='search-item' onclick="location.href='/16677-stargate-sg-1-saison-2-streaming.html'">
  <div class='search-poster'><img src='https://image.tmdb.org/poster2.jpg' alt='Stargate SG-1 - Saison 2'></div>
  <div class='search-info'><div class='search-title'>Stargate SG-1 - Saison 2 (1998)</div></div>
</div>
"""


@pytest.fixture()
def client():
    app = create_app(live_domain="https://fs03.lol")
    # Isolate the test to the primary site; the others are exercised elsewhere.
    app.state.sites.pop("french-manga")
    app.state.sites.pop("senpai")
    return TestClient(app)


def test_search_returns_cards(client, httpx_mock: HTTPXMock):
    # The scraper first GETs the base URL to resolve the final origin.
    httpx_mock.add_response(url="https://fs03.lol", method="GET", text="")
    httpx_mock.add_response(
        url="https://fs03.lol/engine/ajax/search.php",
        method="POST",
        text=SEARCH_HTML,
    )
    resp = client.get("/api/search?q=stargate")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["newsid"] == "16676"
    assert data[0]["season_number"] == 1
    assert data[0]["series_name"] == "Stargate SG-1"
    assert data[0]["poster_url"] == "https://image.tmdb.org/poster.jpg"
    assert "16676" in data[0]["page_url"]


def test_search_strips_year_from_title(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url="https://fs03.lol", method="GET", text="")
    httpx_mock.add_response(
        url="https://fs03.lol/engine/ajax/search.php",
        method="POST",
        text=SEARCH_HTML,
    )
    resp = client.get("/api/search?q=stargate")
    assert resp.status_code == 200
    assert "(1997)" not in resp.json()[0]["title"]


def test_search_empty_result(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url="https://fs03.lol", method="GET", text="")
    httpx_mock.add_response(
        url="https://fs03.lol/engine/ajax/search.php",
        method="POST",
        text="",
    )
    resp = client.get("/api/search?q=nothing")
    assert resp.status_code == 200
    assert resp.json() == []
