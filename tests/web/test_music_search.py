"""The music search: each source through mocked yt-dlp, timeouts, normalisation, top match."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from sestudio import library
from sestudio.music import online, search
from sestudio.sites import SiteError
from sestudio.web.app import create_app

YT = {
    "entries": [
        {
            "id": "dQw4w9WgXcQ",
            "title": "Never Gonna Give You Up",
            "uploader": "Rick Astley",
            "duration": 213,
            "ie_key": "Youtube",
        }
    ]
}
YTM = {
    "entries": [
        {"id": "UCRr1xG_2WIDs18a6cIiCxeA", "ie_key": "YoutubeTab", "title": None},
        {"id": "Jb6gcoR266U", "title": "Around the World", "ie_key": "Youtube"},
    ]
}
SC = {
    "entries": [
        {
            "id": "254112221",
            "title": "Around the World",
            "uploader": "Daft Punk",
            "duration": 429.5,
            "thumbnails": [
                {"id": "small", "url": "s"},
                {"id": "t300x300", "url": "big"},
            ],
        }
    ]
}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    search._cache.clear()
    calls: list[str] = []

    def fake(*args: str):
        calls.append(args[-1])
        target = args[-1]
        if target.startswith("scsearch"):
            return SC
        if target.startswith("ytsearch"):
            return YT
        return YTM

    monkeypatch.setattr(search, "ytdlp_json", fake)
    return calls


def test_each_source_is_normalised_to_queue_items():
    rows, errors = search.search_online("daft", ["ytmusic", "youtube", "soundcloud"], 5)
    assert errors == {}
    by = {r["source"]: r for r in rows}
    assert by["youtube"] == {
        "library": "online",
        "source": "youtube",
        "track_id": "yt:dQw4w9WgXcQ",
        "id": "yt:dQw4w9WgXcQ",
        "title": "Never Gonna Give You Up",
        "artist": "Rick Astley",
        "duration": 213.0,
        "kind": "video",
        "thumb": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }
    assert by["soundcloud"]["track_id"] == "sc:254112221"
    assert by["soundcloud"]["thumb"] == "big"
    assert by["soundcloud"]["kind"] == "track"
    # the artist page is dropped, the song stays
    assert [r["id"] for r in rows if r["source"] == "ytmusic"] == ["yt:Jb6gcoR266U"]
    assert by["ytmusic"]["kind"] == "track"


def test_a_failing_source_is_reported_and_the_rest_answer(monkeypatch):
    def fake(*args: str):
        if args[-1].startswith("scsearch"):
            raise SiteError("blocked")
        return YT

    monkeypatch.setattr(search, "ytdlp_json", fake)
    rows, errors = search.search_online("x", ["youtube", "soundcloud"], 5)
    assert errors == {"soundcloud": "blocked"}
    assert [r["source"] for r in rows] == ["youtube"]


def test_a_slow_source_times_out(monkeypatch):
    def fake(*args: str):
        if args[-1].startswith("scsearch"):
            time.sleep(1)
        return YT

    monkeypatch.setattr(search, "ytdlp_json", fake)
    rows, errors = search.search_online("x", ["youtube", "soundcloud"], 5, timeout=0.1)
    assert errors == {"soundcloud": "timed out"}
    assert [r["source"] for r in rows] == ["youtube"]


def test_results_are_cached(_fresh):
    search.search_online("Daft", ["youtube"], 5)
    search.search_online("daft", ["youtube"], 5)
    assert len(_fresh) == 1


def test_top_is_an_artist_with_two_tracks_matching_the_query():
    lib = [{"track_id": "a", "title": "One More Time", "artist": "Daft Punk"}]
    rows = [
        {"track_id": "sc:1", "title": "Around", "artist": "Daft Punk", "thumb": "t"},
        {"track_id": "sc:2", "title": "x", "artist": "DJ KB"},
    ]
    top = search._top("daft", lib, rows)
    assert top["kind"] == "artist"
    assert top["name"] == "Daft Punk"
    assert len(top["tracks"]) == 2
    assert top["thumb"] == "t"


def test_top_falls_back_to_the_first_track():
    rows = [{"track_id": "yt:x", "title": "Around the World", "artist": ""}]
    assert search._top("around", [], rows)["kind"] == "track"
    assert search._top("around", [], []) is None


def test_soundcloud_ids_resolve(monkeypatch):
    assert online.video_id("sc:254112221") == "sc:254112221"
    assert online.video_id("sc:abc") is None
    assert online.page_url("sc:254112221").endswith("soundcloud%3Atracks%3A254112221")
    seen = {}

    def fake(*args: str):
        seen["args"] = args
        return {
            "id": "254112221",
            "title": "Around the World",
            "uploader": "Daft Punk",
            "duration": 429,
            "url": "https://cf/x.mp3",
        }

    monkeypatch.setattr(online, "ytdlp_json", fake)
    online._resolved.clear()
    got = online.complete({"library": "online", "track_id": "sc:254112221"})
    assert got["track_id"] == "sc:254112221"
    assert got["source"] == "soundcloud"
    assert got["artist"] == "Daft Punk"
    assert seen["args"][2].startswith("ba[protocol^=http]")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_MUSIC_ANALYSIS", "0")
    library.reset_connection()
    return TestClient(create_app())


def test_route_returns_the_three_parts_and_validates_source(client):
    params = {"q": "daft", "source": "soundcloud"}
    body = client.get("/api/music/search", params=params).json()
    assert [r["id"] for r in body["online"]] == ["sc:254112221"]
    assert body["library"] == []
    assert body["errors"] == {}
    assert body["top"]["kind"] == "track"
    bad = client.get("/api/music/search", params={"q": "x", "source": "nope"})
    assert bad.status_code == 400
    blank = client.get("/api/music/search", params={"q": " ", "source": "library"})
    assert blank.json()["top"] is None
