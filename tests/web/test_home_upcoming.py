from __future__ import annotations

import re
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from sestudio import library, tmdb
from sestudio.web.app import create_app
from sestudio.web.routes import home

SEARCH = re.compile(r"https://api\.themoviedb\.org/3/search/tv\?.*")
DETAIL = re.compile(r"https://api\.themoviedb\.org/3/tv/42\?.*")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("TMDB_API_KEY", "test-key")
    library.reset_connection()
    tmdb.clear_cache()
    home._airing_cache._items.clear()
    yield TestClient(create_app())
    library.reset_connection()
    tmdb.clear_cache()
    home._airing_cache._items.clear()


def _in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _watch(series: str = "Dark", season: int = 1) -> None:
    library.upsert_watch(
        f"{series}|S{season}|E1",
        {
            "series": series,
            "season": season,
            "number": 1,
            "title": "E1",
            "poster_url": "",
            "page_url": "https://fake.example/dark.html",
            "lang": "vostfr",
            "position": 10.0,
            "duration": 100.0,
            "watched": False,
            "updatedAt": 1000,
        },
    )


def _detail(status: str = "Returning Series", air_date: str | None = None, **extra):
    nxt = (
        {
            "season_number": 2,
            "episode_number": 3,
            "name": "Le retour",
            "air_date": air_date,
        }
        if air_date
        else None
    )
    return {
        "id": 42,
        "status": status,
        "poster_path": "/p.jpg",
        "next_episode_to_air": nxt,
        **extra,
    }


def _tmdb(httpx_mock: HTTPXMock, detail: dict) -> None:
    httpx_mock.add_response(
        url=SEARCH,
        json={"results": [{"id": 42, "name": "Dark", "original_name": "Dark"}]},
    )
    httpx_mock.add_response(url=DETAIL, json=detail)


def test_returning_series_airing_this_week(client, httpx_mock: HTTPXMock):
    _watch()
    _tmdb(httpx_mock, _detail(air_date=_in(2)))
    assert client.get("/api/home/upcoming").json() == {
        "episodes": [
            {
                "series": "Dark",
                "tmdb_id": 42,
                "season": 2,
                "episode": 3,
                "name": "Le retour",
                "air_date": _in(2),
                "poster_url": "https://image.tmdb.org/t/p/w342/p.jpg",
                "vf_delay_days": None,
                "page_url": "https://fake.example/dark.html",
                "source": "fstream",
                "lang": "vostfr",
            }
        ]
    }


def test_ended_series_is_excluded(client, httpx_mock: HTTPXMock):
    _watch()
    _tmdb(httpx_mock, _detail(status="Ended"))
    assert client.get("/api/home/upcoming").json() == {"episodes": []}


def test_episode_beyond_seven_days_is_excluded(client, httpx_mock: HTTPXMock):
    _watch()
    _tmdb(httpx_mock, _detail(air_date=_in(10)))
    assert client.get("/api/home/upcoming").json() == {"episodes": []}


def test_title_without_confident_match_is_skipped(client, httpx_mock: HTTPXMock):
    _watch()
    # A first hit named otherwise is not taken: the detail is never fetched.
    httpx_mock.add_response(
        url=SEARCH, json={"results": [{"id": 42, "name": "Dark Matter"}]}
    )
    assert client.get("/api/home/upcoming").json() == {"episodes": []}


def test_tmdb_unavailable_gives_an_empty_list(client, httpx_mock: HTTPXMock):
    _watch()
    httpx_mock.add_response(url=SEARCH, status_code=503)
    assert client.get("/api/home/upcoming").json() == {"episodes": []}


def test_films_and_nothing_followed_cost_no_tmdb_call(client):
    _watch("Dune", season=0)
    assert client.get("/api/home/upcoming").json() == {"episodes": []}


def test_watched_and_watchlisted_series_is_listed_once(client, httpx_mock: HTTPXMock):
    _watch()
    library.upsert_collection(
        "watchlist",
        "Dark|S1",
        {
            "series": "Dark",
            "season": 1,
            "label": "Dark",
            "poster_url": "",
            "page_url": "u",
            "lang": "vf",
            "addedAt": 1,
        },
    )
    _tmdb(httpx_mock, _detail(air_date=_in(0)))
    episodes = client.get("/api/home/upcoming").json()["episodes"]
    assert [(e["tmdb_id"], e["lang"]) for e in episodes] == [(42, "vostfr")]


def test_vf_delay_from_past_watcher_findings(client, httpx_mock: HTTPXMock):
    watcher = library.watcher_create(
        "series_episodes",
        {
            "page_url": "https://fake.example/dark.html",
            "source": "fake",
            "langs": ["vf"],
            "series_name": "Dark",
        },
    )
    for number in (1, 2):
        library.watcher_add_event(
            watcher_id=watcher["id"],
            watcher_kind="series_episodes",
            event_type="new",
            item_key=f"eplang|01|{number:04d}|vf",
        )
    # Both found in VF today: aired 10 and 14 days ago, so ~12 days late.
    season = {
        "episodes": [
            {"episode_number": 1, "air_date": _in(-10)},
            {"episode_number": 2, "air_date": _in(-14)},
        ]
    }
    _tmdb(httpx_mock, _detail(air_date=_in(1), **{"season/1": season}))
    (episode,) = client.get("/api/home/upcoming").json()["episodes"]
    assert episode["vf_delay_days"] == 12
    assert (episode["source"], episode["lang"]) == ("fake", "vf")
