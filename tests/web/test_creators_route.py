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
