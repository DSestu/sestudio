from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import library, tmdb
from sestudio.models import SeasonCard
from sestudio.sites import PageResult
from sestudio.web.app import create_app
from tests.web.conftest import FakeSite

# What TMDB recommends for each seed, in order.
RECS = {
    "Dark": ["Arrival", "Fringe", "Severance", "Nowhere", "Lost"],
    "Fringe": ["Severance", "Westworld"],
}
IDS = {"Dark": 1, "Fringe": 2, "Arrival": 3, "Severance": 4, "Nowhere": 5}
IDS |= {"Lost": 6, "Westworld": 7}


class CatalogSite(FakeSite):
    """Carries every title except "Nowhere", in VF and VOSTFR."""

    id = "cat"

    def __init__(self) -> None:
        self.searches: list[str] = []

    def search(self, query: str) -> list[SeasonCard]:
        self.searches.append(query)
        if query == "Nowhere":
            return []
        return [
            SeasonCard(
                newsid=query,
                title=f"{query} Saison {n}",
                series_name=query,
                season_number=n,
                poster_url="https://cat.example/p.jpg",
                page_url=f"https://cat.example/{query}-{n}.html",
                source=self.id,
            )
            for n in (2, 1)
        ]

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        return PageResult(
            season=1, episodes=[], is_film=False, available_langs=["vostfr", "vf"]
        )


def _rec(title: str) -> dict:
    return {
        "tmdb_id": IDS[title],
        "kind": "tv",
        "title": title,
        "year": 2020,
        "rating": 7.5,
        "poster_url": f"https://tmdb/{title}.jpg",
    }


def _enrich(title: str, year: int = 0, is_film: bool = False):
    if title not in RECS:
        return None  # TMDB doesn't know it
    return {
        **_rec(title),
        "recommendations": [_rec(t) for t in RECS[title]],
    }


@pytest.fixture()
def site():
    return CatalogSite()


@pytest.fixture()
def client(tmp_path, monkeypatch, site):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setattr(tmdb, "enrich", _enrich)
    library.reset_connection()
    app = create_app()
    app.state.sites = {"cat": site}
    yield TestClient(app)
    library.reset_connection()


def _watch(client: TestClient, series: str, updated_at: int, number: int = 1):
    entry = {"series": series, "season": 1, "number": number, "updatedAt": updated_at}
    client.put(f"/api/library/watch/{series}|S1|E{number}", json=entry)


def _history(client: TestClient) -> None:
    _watch(client, "Unknown", 1)  # TMDB has no match: no group
    _watch(client, "Fringe", 2)
    _watch(client, "Dark", 3)
    _watch(client, "Fringe", 0, number=2)  # same series, collapsed
    client.put(
        "/api/library/collections/watchlist/Arrival|S1",
        json={"series": "Arrival", "season": 1, "label": "Arrival"},
    )
    client.put(
        "/api/library/collections/favourites/Lost|S1",
        json={"series": "Lost", "season": 1, "label": "Lost"},
    )


def test_groups_follow_seeds_dedupe_and_drop_uncarried_and_known(client):
    _history(client)

    groups = client.get("/api/home/foryou").json()["groups"]

    assert [g["because"] for g in groups] == [
        {"title": "Dark", "tmdb_id": 1, "kind": "tv"},
        {"title": "Fringe", "tmdb_id": 2, "kind": "tv"},
    ]
    # Dark: Arrival listed, Fringe a seed, Nowhere on no site, Lost a favourite.
    # Fringe: Severance already shown under Dark.
    assert [[i["title"] for i in g["items"]] for g in groups] == [
        ["Severance"],
        ["Westworld"],
    ]
    item = groups[0]["items"][0]
    assert item == {
        "title": "Severance",
        "year": 2020,
        "tmdb_id": 4,
        "kind": "tv",
        "poster_url": "https://tmdb/Severance.jpg",
        "rating": 7.5,
        "versions": ["vf", "vostfr"],
        "card": item["card"],
    }
    # The card opens the series at its first season, as search would list it.
    assert item["card"]["page_url"] == "https://cat.example/Severance-1.html"
    assert item["card"]["source"] == "cat"


def test_result_is_cached_until_refresh(client, site):
    _history(client)
    first = client.get("/api/home/foryou").json()
    searches = len(site.searches)
    assert client.get("/api/home/foryou").json() == first
    assert len(site.searches) == searches
    client.get("/api/home/foryou?refresh=1")
    assert len(site.searches) == 2 * searches


def test_empty_history_gives_no_groups(client):
    assert client.get("/api/home/foryou").json() == {"groups": []}


def test_tmdb_unavailable_gives_no_groups(client, monkeypatch):
    def disabled(*_args, **_kwargs):
        raise tmdb.TmdbDisabled("No TMDB API key configured")

    monkeypatch.setattr(tmdb, "enrich", disabled)
    _history(client)
    resp = client.get("/api/home/foryou")
    assert resp.status_code == 200
    assert resp.json() == {"groups": []}
