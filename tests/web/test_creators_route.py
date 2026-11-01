"""/api/link: a pasted YouTube or Twitch link, read into a card."""

from __future__ import annotations

from fastapi.testclient import TestClient

from sestudio.sites import creators
from sestudio.web.app import create_app


def test_link_card_from_yt_dlp(monkeypatch, tmp_path):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setattr(
        creators,
        "ytdlp_json",
        lambda *a, **k: {
            "title": "Trailer",
            "channel": "Studio",
            "webpage_url": "https://www.youtube.com/watch?v=abc",
            "duration": 184,
        },
    )
    client = TestClient(create_app(live_domain="https://fs03.lol"))

    card = client.get("/api/link", params={"url": "https://youtu.be/abc"}).json()

    assert card["source"] == "youtube"
    assert card["page_url"] == "https://www.youtube.com/watch?v=abc"
    assert (card["title"], card["channel"], card["duration"]) == (
        "Trailer",
        "Studio",
        184,
    )


def test_other_links_are_refused(monkeypatch, tmp_path):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    client = TestClient(create_app(live_domain="https://fs03.lol"))

    assert (
        client.get("/api/link", params={"url": "https://example.com"}).status_code
        == 400
    )


def test_live_asks_twitch_about_followed_channels_only(monkeypatch, tmp_path):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    from sestudio import library

    library.reset_connection()
    library.watcher_create(
        "channel", {"channel_url": "https://www.twitch.tv/SomeOne", "source": "twitch"}
    )
    library.watcher_create(
        "channel",
        {"channel_url": "https://www.youtube.com/channel/UC1", "source": "youtube"},
    )
    asked: list = []

    def fake_gql(query, variables):
        asked.append(variables["logins"])
        return {
            "users": [
                {
                    "login": "someone",
                    "displayName": "SomeOne",
                    "profileImageURL": "a",
                    "stream": {"title": "Run", "game": {"name": "Elden Ring"}},
                },
                None,
            ]
        }

    monkeypatch.setattr(creators, "twitch_gql", fake_gql)
    client = TestClient(create_app(live_domain="https://fs03.lol"))

    live = client.get("/api/live").json()

    assert asked == [["someone"]]
    assert [(s["channel"], s["game"], s["avatar"]) for s in live] == [
        ("SomeOne", "Elden Ring", "a")
    ]
    library.reset_connection()


def test_import_follows_takeout_and_twitch_names_once(monkeypatch, tmp_path):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    from sestudio import library
    from sestudio.web.routes import creators as route

    library.reset_connection()
    monkeypatch.setattr(
        route,
        "twitch_gql",
        lambda q, v: {"users": [{"login": "someone", "displayName": "SomeOne"}, None]},
    )
    client = TestClient(create_app(live_domain="https://fs03.lol"))
    takeout = (
        "﻿Channel Id,Channel Url,Channel Title\n"
        "UCSMOQeBJ2RAnuFungnQOxLg,http://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg,Blender\n"
        "not-a-channel,x,y\n"
    )
    body = {
        "youtube_csv": takeout,
        "twitch": "https://www.twitch.tv/SomeOne/, ghost_user",
    }

    first = client.post("/api/follows/import", json=body).json()
    again = client.post("/api/follows/import", json=body).json()

    assert first == {"added": 2, "skipped": 0, "unknown": ["ghost_user"]}
    assert again["added"] == 0 and again["skipped"] == 2
    configs = sorted(w["config"]["channel_url"] for w in library.watcher_list())
    assert configs == [
        "https://www.twitch.tv/someone",
        "https://www.youtube.com/channel/UCSMOQeBJ2RAnuFungnQOxLg",
    ]
    library.reset_connection()


def test_latest_merges_followed_channels_newest_first(monkeypatch, tmp_path):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    from sestudio import library
    from sestudio.sites.creators import TwitchSite, YouTubeSite

    library.reset_connection()
    library.watcher_create(
        "channel",
        {"channel_url": "https://www.twitch.tv/a", "source": "twitch", "name": "A"},
    )
    library.watcher_create(
        "channel",
        {
            "channel_url": "https://www.youtube.com/channel/UCb",
            "source": "youtube",
            "name": "B",
        },
    )
    monkeypatch.setattr(
        TwitchSite,
        "latest",
        lambda self, url: ([{"page_url": "t1", "timestamp": 5}], None),
    )

    def broken(self, url):
        raise creators.SiteError("down")

    monkeypatch.setattr(YouTubeSite, "latest", broken)
    client = TestClient(create_app(live_domain="https://fs03.lol"))

    videos = client.get("/api/creators/latest").json()

    # A channel that fails is left out; the others still show, named.
    assert [(v["page_url"], v["channel"]) for v in videos] == [("t1", "A")]
    library.reset_connection()
