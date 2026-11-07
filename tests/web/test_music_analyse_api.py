from __future__ import annotations

from sestudio.music import online, runner
from tests.web.test_music_playlists import A, client  # noqa: F401


def test_analyse_starts_an_online_track(client, monkeypatch):  # noqa: F811
    kicked: list[str] = []
    monkeypatch.setattr(runner, "enabled", lambda: True)
    monkeypatch.setattr(online, "kick_analysis", kicked.append)
    r = client.post("/api/music/tracks/yt:dQw4w9WgXcQ/analyse")
    assert r.status_code == 200
    assert kicked == ["yt:dQw4w9WgXcQ"]


def test_analyse_refuses_a_library_track_and_an_off_runner(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(online, "kick_analysis", lambda tid: None)
    assert client.post(f"/api/music/tracks/{A}/analyse").status_code == 400
    monkeypatch.setattr(runner, "enabled", lambda: False)
    assert client.post("/api/music/tracks/yt:dQw4w9WgXcQ/analyse").status_code == 409
