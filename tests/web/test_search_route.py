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
    app.state.sites.pop("kisskh")
    app.state.sites.pop("uniquestream")
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
    data = resp.json()["cards"]
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
    assert "(1997)" not in resp.json()["cards"][0]["title"]


def test_search_empty_result(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url="https://fs03.lol", method="GET", text="")
    httpx_mock.add_response(
        url="https://fs03.lol/engine/ajax/search.php",
        method="POST",
        text="",
    )
    resp = client.get("/api/search?q=nothing")
    assert resp.status_code == 200
    assert resp.json()["cards"] == []


def test_browse_returns_site_rows_and_skips_a_failing_site(client):
    from sestudio.models import SeasonCard
    from sestudio.sites import BrowseRow
    from tests.web.conftest import FakeSite

    card = SeasonCard(
        "1", "Goblin", "Goblin", 1, "", "https://fake.example/1", source="fake"
    )

    class Rows(FakeSite):
        def browse(self):
            return [BrowseRow("Popular", [card])]

    class Broken(FakeSite):
        id = "broken"

        def browse(self):
            raise RuntimeError("down")

    client.app.state.sites.update(fake=Rows(), broken=Broken())
    resp = client.get("/api/browse")
    assert resp.status_code == 200
    rows = resp.json()
    # fstream offers no rows; the broken site is skipped, not fatal.
    assert [(r["source"], r["title"]) for r in rows] == [("fake", "Popular")]
    assert rows[0]["cards"][0]["title"] == "Goblin"


def test_search_reports_each_sites_status(client, httpx_mock: HTTPXMock, monkeypatch):
    """Every site gets a line: ok with its count, empty, failed or timed out."""
    import time

    from sestudio.web.routes import search as search_route
    from tests.web.conftest import FakeSite

    class Empty(FakeSite):
        id, display_name = "empty", "Empty"

        def search(self, query):
            return []

    class Broken(FakeSite):
        id, display_name = "broken", "Broken"

        def search(self, query):
            raise RuntimeError("down")

    class Slow(FakeSite):
        id, display_name = "slow", "Slow"

        def search(self, query):
            time.sleep(0.5)
            return super().search(query)

    monkeypatch.setattr(search_route, "SITE_TIMEOUT_S", 0.1)
    client.app.state.sites.pop("fstream")
    client.app.state.sites.update(
        fake=FakeSite(), empty=Empty(), broken=Broken(), slow=Slow()
    )

    resp = client.get("/api/search?q=goblin")
    assert resp.status_code == 200
    body = resp.json()
    status = {s["id"]: (s["status"], s["count"]) for s in body["sources"]}
    assert status == {
        "fake": ("ok", 1),
        "empty": ("empty", 0),
        "broken": ("failed", 0),
        "slow": ("timeout", 0),
    }
    assert [c["source"] for c in body["cards"]] == ["fake"]
    assert all(isinstance(s["ms"], int) for s in body["sources"])
    assert {s["name"] for s in body["sources"]} == {"Fake", "Empty", "Broken", "Slow"}


def test_search_can_retry_a_single_site(client):
    """`sites=` limits the fan-out, so one failed source can be retried alone."""
    from tests.web.conftest import FakeSite

    class Other(FakeSite):
        id, display_name = "other", "Other"

    client.app.state.sites.pop("fstream")
    client.app.state.sites.update(fake=FakeSite(), other=Other())
    body = client.get("/api/search?q=goblin&sites=other").json()
    assert [s["id"] for s in body["sources"]] == ["other"]
    assert [c["source"] for c in body["cards"]] == ["other"]


def test_search_fails_only_when_every_site_fails(client):
    from tests.web.conftest import FakeSite

    class Broken(FakeSite):
        id = "broken"

        def search(self, query):
            raise RuntimeError("down")

    client.app.state.sites.pop("fstream")
    client.app.state.sites.update(broken=Broken())
    resp = client.get("/api/search?q=goblin")
    assert resp.status_code == 502
    assert "broken: failed" in resp.json()["detail"]


def test_search_unescapes_quotes_in_titles(client, httpx_mock: HTTPXMock):
    """The site's engine sends "l\\'ombre"; the card must read "l'ombre"."""
    httpx_mock.add_response(url="https://fs03.lol", method="GET", text="")
    httpx_mock.add_response(
        url="https://fs03.lol/engine/ajax/search.php",
        method="POST",
        text="""
<div class='search-item' onclick="location.href='/5-dans-l-ombre-des-dunes.html'">
  <div class='search-info'><div class='search-title'>Dans l\\'ombre des dunes (2022)</div></div>
</div>""",
    )
    card = client.get("/api/search?q=dunes").json()["cards"][0]
    assert card["title"] == "Dans l'ombre des dunes"
    assert card["series_name"] == "Dans l'ombre des dunes"
