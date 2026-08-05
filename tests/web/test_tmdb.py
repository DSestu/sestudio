from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from sestudio import config, tmdb
from sestudio.web.app import create_app

# Matched as regexes so the query string (api key, language, …) is ignored.
SEARCH = re.compile(r"https://api\.themoviedb\.org/3/search/tv\?.*")
DETAIL = re.compile(r"https://api\.themoviedb\.org/3/tv/42\?.*")
TRENDING = re.compile(r"https://api\.themoviedb\.org/3/trending/all/week\?.*")
DISCOVER = re.compile(r"https://api\.themoviedb\.org/3/discover/movie\?.*")
GENRES = re.compile(r"https://api\.themoviedb\.org/3/genre/movie/list\?.*")
PERSON = re.compile(r"https://api\.themoviedb\.org/3/person/7\?.*")


@pytest.fixture(autouse=True)
def isolated_tmdb(tmp_path, monkeypatch):
    """Point config (and thus the cache) at a temp dir, with a key set."""
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("TMDB_API_KEY", "test-key")
    tmdb.clear_cache()
    yield
    tmdb.clear_cache()


@pytest.fixture()
def client():
    return TestClient(create_app(live_domain="https://fs03.lol"))


def _detail_payload():
    return {
        "id": 42,
        "name": "Dark",
        "overview": "A missing child.",
        "first_air_date": "2017-12-01",
        "vote_average": 8.44,
        "poster_path": "/poster.jpg",
        "backdrop_path": "/back.jpg",
        "genres": [{"name": "Drame"}, {"name": "Science-Fiction"}],
        "vote_count": 5321,
        "created_by": [{"id": 7, "name": "Baran bo Odar"}],
        "credits": {
            "cast": [
                {
                    "id": 11,
                    "name": "Louis H.",
                    "character": "Jonas",
                    "profile_path": "/p.jpg",
                }
            ]
        },
        "recommendations": {
            "results": [
                {
                    "id": 99,
                    "media_type": "tv",
                    "name": "1899",
                    "first_air_date": "2022-11-17",
                    "vote_average": 7.8,
                    "poster_path": "/r.jpg",
                }
            ]
        },
        "videos": {
            "results": [
                {"site": "YouTube", "type": "Trailer", "key": "abc123"},
                {"site": "YouTube", "type": "Teaser", "key": "ignored"},
            ]
        },
    }


def test_enrich_normalises_the_payload(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=SEARCH, json={"results": [{"id": 42}]})
    httpx_mock.add_response(url=DETAIL, json=_detail_payload())

    resp = client.get("/api/tmdb/enrich", params={"title": "Dark", "year": 2017})
    assert resp.status_code == 200
    data = resp.json()
    assert data["tmdb_id"] == 42
    assert data["title"] == "Dark"
    assert data["year"] == 2017
    assert data["rating"] == 8.4  # rounded for display
    assert data["genres"] == ["Drame", "Science-Fiction"]
    assert data["poster_url"].endswith("/w342/poster.jpg")
    assert data["backdrop_url"].endswith("/w1280/back.jpg")
    assert data["cast"][0]["character"] == "Jonas"
    assert data["cast"][0]["id"] == 11
    assert data["vote_count"] == 5321
    assert data["directors"] == [{"id": 7, "name": "Baran bo Odar"}]
    assert data["recommendations"][0]["title"] == "1899"
    assert data["recommendations"][0]["kind"] == "tv"
    assert data["trailer_key"] == "abc123"  # the trailer, not the teaser


def test_second_lookup_is_served_from_cache(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=SEARCH, json={"results": [{"id": 42}]})
    httpx_mock.add_response(url=DETAIL, json=_detail_payload())

    first = client.get("/api/tmdb/enrich", params={"title": "Dark", "year": 2017})
    assert first.status_code == 200
    before = len(httpx_mock.get_requests())

    second = client.get("/api/tmdb/enrich", params={"title": "Dark", "year": 2017})
    assert second.json() == first.json()
    # No further TMDB traffic: the cache answered it.
    assert len(httpx_mock.get_requests()) == before


def test_no_match_returns_null_and_is_cached(client, httpx_mock: HTTPXMock):
    # Two empty results: the year-filtered search, then the retry without it.
    httpx_mock.add_response(url=SEARCH, json={"results": []})
    httpx_mock.add_response(url=SEARCH, json={"results": []})

    resp = client.get("/api/tmdb/enrich", params={"title": "Nope", "year": 1999})
    assert resp.status_code == 200
    assert resp.json() is None

    # A cached miss must not hit the API again.
    before = len(httpx_mock.get_requests())
    client.get("/api/tmdb/enrich", params={"title": "Nope", "year": 1999})
    assert len(httpx_mock.get_requests()) == before


def test_year_is_dropped_when_it_finds_nothing(client, httpx_mock: HTTPXMock):
    """A scraped year can be wrong, so a failed search retries without it."""
    httpx_mock.add_response(url=SEARCH, json={"results": []})
    httpx_mock.add_response(url=SEARCH, json={"results": [{"id": 42}]})
    httpx_mock.add_response(url=DETAIL, json=_detail_payload())

    resp = client.get("/api/tmdb/enrich", params={"title": "Dark", "year": 1911})
    assert resp.status_code == 200
    assert resp.json()["tmdb_id"] == 42
    assert "year=1911" in str(httpx_mock.get_requests()[0].url)
    assert "year=" not in str(httpx_mock.get_requests()[1].url)


def test_api_error_degrades_to_null(client, httpx_mock: HTTPXMock):
    """TMDB trouble must never break search — enrichment is optional."""
    httpx_mock.add_response(url=SEARCH, status_code=500)
    resp = client.get("/api/tmdb/enrich", params={"title": "Dark"})
    assert resp.status_code == 200
    assert resp.json() is None


def test_without_a_key_the_feature_reports_disabled(client, monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    # Release wheels bake in a default key; neutralise it so this covers the
    # genuinely unconfigured case.
    monkeypatch.setattr(config, "_DEFAULT_TMDB_API_KEY", "")
    resp = client.get("/api/tmdb/enrich", params={"title": "Dark"})
    assert resp.status_code == 503


def test_trending_returns_cards(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=TRENDING,
        json={
            "results": [
                {
                    "id": 1,
                    "media_type": "movie",
                    "title": "Film",
                    "release_date": "2024-05-01",
                    "vote_average": 7.25,
                    "poster_path": "/f.jpg",
                },
                {"id": 2, "media_type": "person", "name": "Someone"},
            ]
        },
    )
    resp = client.get("/api/tmdb/trending")
    assert resp.status_code == 200
    cards = resp.json()
    # People are filtered out — only playable media types are shown.
    assert len(cards) == 1
    assert cards[0] == {
        "tmdb_id": 1,
        "kind": "movie",
        "title": "Film",
        "year": 2024,
        "rating": 7.2,
        "poster_url": "https://image.tmdb.org/t/p/w342/f.jpg",
    }


def test_discover_passes_filters_and_returns_cards(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=DISCOVER,
        json={
            "page": 2,
            "total_pages": 40,
            "results": [
                {
                    "id": 3,
                    "title": "Chef d'œuvre",
                    "release_date": "1994-09-14",
                    "vote_average": 8.71,
                    "poster_path": "/c.jpg",
                }
            ],
        },
    )
    resp = client.get(
        "/api/tmdb/discover",
        params={
            "kind": "movie",
            "sort_by": "vote_average.desc",
            "genres": "18,80",
            "min_score": 4,
            "max_score": 7,
            "min_votes": 300,
            "page": 2,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["page"] == 2
    assert data["total_pages"] == 40
    assert data["results"][0]["title"] == "Chef d'œuvre"
    sent = str(httpx_mock.get_requests()[0].url)
    assert "sort_by=vote_average.desc" in sent
    assert "with_genres=18%2C80" in sent
    assert "vote_average.gte=4" in sent
    assert "vote_average.lte=7" in sent
    assert "vote_count.gte=300" in sent


def test_discover_rejects_unknown_sort(client):
    resp = client.get("/api/tmdb/discover", params={"sort_by": "hackable.desc"})
    assert resp.status_code == 422


def test_genres_are_cached_per_process(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=GENRES, json={"genres": [{"id": 18, "name": "Drame"}]})
    first = client.get("/api/tmdb/genres", params={"kind": "movie"})
    assert first.json() == [{"id": 18, "name": "Drame"}]
    before = len(httpx_mock.get_requests())
    second = client.get("/api/tmdb/genres", params={"kind": "movie"})
    assert second.json() == first.json()
    assert len(httpx_mock.get_requests()) == before


def test_person_merges_acting_and_directing_credits(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=PERSON,
        json={
            "id": 7,
            "name": "Jordan Peele",
            "biography": "Bio.",
            "known_for_department": "Directing",
            "profile_path": "/jp.jpg",
            "birthday": "1979-02-21",
            "combined_credits": {
                "cast": [
                    {
                        "id": 100,
                        "media_type": "movie",
                        "title": "Get Out",
                        "release_date": "2017-02-24",
                        "vote_average": 7.6,
                        "poster_path": "/g.jpg",
                        "character": "Cameo",
                        "popularity": 50,
                    },
                    {"id": 1, "media_type": "person", "name": "filtered"},
                ],
                "crew": [
                    {
                        "id": 100,
                        "media_type": "movie",
                        "title": "Get Out",
                        "release_date": "2017-02-24",
                        "vote_average": 7.6,
                        "poster_path": "/g.jpg",
                        "job": "Director",
                        "popularity": 50,
                    },
                    {
                        "id": 200,
                        "media_type": "movie",
                        "title": "Nope",
                        "release_date": "2022-07-22",
                        "vote_average": 6.9,
                        "poster_path": "/n.jpg",
                        "job": "Director",
                        "popularity": 80,
                    },
                ],
            },
        },
    )
    resp = client.get("/api/tmdb/person/7")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Jordan Peele"
    assert data["profile_url"].endswith("/w342/jp.jpg")
    # Deduped: Get Out appears once carrying both roles; sorted by popularity.
    titles = [c["title"] for c in data["credits"]]
    assert titles == ["Nope", "Get Out"]
    get_out = data["credits"][1]
    assert get_out["role"] == "Cameo · Director"
    assert "popularity" not in get_out
