"""YouTube / YouTube Music as music: link detection, queue items, playlists, audio-only args."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import library
from sestudio.downloader import AUDIO_ONLY_ARGS, audio_file
from sestudio.music import online
from sestudio.sites import SiteError
from sestudio.web.app import create_app

VID = "dQw4w9WgXcQ"
INFO = {
    "id": VID,
    "title": "Never Gonna Give You Up",
    "channel": "Rick Astley - Topic",
    "duration": 213,
    "url": "https://rr1.googlevideo.com/audio",
    "webpage_url": f"https://www.youtube.com/watch?v={VID}",
}
PLAYLIST = "https://music.youtube.com/playlist?list=PL1"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (f"https://www.youtube.com/watch?v={VID}&t=4", ("video", VID, "youtube")),
        (f"https://youtu.be/{VID}?si=x", ("video", VID, "youtube")),
        (
            f"https://music.youtube.com/watch?v={VID}&list=RDAMVM",
            ("video", VID, "ytmusic"),
        ),
        (f"https://www.youtube.com/shorts/{VID}", ("video", VID, "youtube")),
        (
            "https://music.youtube.com/playlist?list=OLAK5uy_abc",
            ("playlist", "OLAK5uy_abc", "ytmusic"),
        ),
        (
            "https://www.youtube.com/playlist?list=PL123",
            ("playlist", "PL123", "youtube"),
        ),
        ("https://www.youtube.com/@channel", None),
        ("https://vimeo.com/123456789", None),
        ("https://notyoutube.com/watch?v=" + VID, None),
        ("never gonna give you up", None),
        (VID, None),
    ],
)
def test_parse_url(text, expected):
    link = online.parse_url(text)
    assert (link and (link.kind, link.id, link.source)) == expected


def test_track_ids():
    assert online.video_id(online.track_id(VID)) == VID
    assert online.video_id("yt:short") is None
    assert online.video_id("0123456789abcdef") is None


def test_audio_only_args_keep_the_container():
    args = list(AUDIO_ONLY_ARGS)
    assert args[args.index("-f") + 1] == "ba[ext=m4a]/ba"
    assert "--merge-output-format" not in args


def test_audio_file_finds_the_stem_completion(tmp_path):
    stem = tmp_path / "Mr. Brightside"
    (tmp_path / "Mr. Brightside.m4a.part").write_bytes(b"x")
    assert audio_file(stem) is None
    (tmp_path / "Mr. Brightside.opus").write_bytes(b"x")
    assert audio_file(stem) == tmp_path / "Mr. Brightside.opus"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_MUSIC_ANALYSIS", "0")
    library.reset_connection()
    online._resolved.clear()
    yield TestClient(create_app())
    library.reset_connection()


def fake_ytdlp(monkeypatch, playlist=None):
    calls = []

    def fake(*args):
        calls.append(args)
        return (playlist or {}) if "--flat-playlist" in args else INFO

    monkeypatch.setattr(online, "ytdlp_json", fake)
    return calls


def post(client, tracks, **kw):
    return client.post("/api/music/queue", json={"tracks": tracks, **kw})


def test_a_bare_online_item_is_looked_up_and_queued(client, monkeypatch):
    fake_ytdlp(monkeypatch)
    ref = {"library": "online", "track_id": f"yt:{VID}", "source": "ytmusic"}
    r = post(client, [ref])
    assert r.status_code == 200, r.text
    (queued,) = r.json()["items"]
    assert queued["title"] == "Never Gonna Give You Up"
    assert queued["artist"] == "Rick Astley"
    assert queued["source"] == "ytmusic"
    assert queued["duration"] == 213


def test_an_online_item_with_a_title_is_not_looked_up(client, monkeypatch):
    calls = fake_ytdlp(monkeypatch)
    ref = {"library": "online", "track_id": f"yt:{VID}", "title": "T", "duration": 1}
    assert post(client, [ref]).status_code == 200
    assert calls == []


def test_a_bad_id_or_failed_lookup_is_refused(client, monkeypatch):
    assert post(client, [{"library": "online", "track_id": "nope"}]).status_code == 404

    def boom(*args):
        raise SiteError("Video unavailable")

    monkeypatch.setattr(online, "ytdlp_json", boom)
    ref = {"library": "online", "track_id": f"yt:{VID}"}
    assert post(client, [ref]).status_code == 502


def test_playlist_expands_to_queue_items(client, monkeypatch):
    fake_ytdlp(
        monkeypatch,
        {
            "title": "Chill",
            "entries": [
                {"id": VID, "title": "One", "uploader": "A", "duration": 100},
                {"id": "abcdefghijk", "title": "Two", "channel": "B", "duration": 200},
                {"title": "no id"},
            ],
        },
    )
    body = client.get("/api/music/online/link", params={"url": PLAYLIST}).json()
    assert body["kind"] == "playlist" and body["title"] == "Chill"
    assert [t["track_id"] for t in body["tracks"]] == [f"yt:{VID}", "yt:abcdefghijk"]
    assert body["tracks"][0]["source"] == "ytmusic"
    queued = post(client, body["tracks"], replace=True)
    assert [i["title"] for i in queued.json()["items"]] == ["One", "Two"]


def test_link_rejects_other_urls(client):
    r = client.get("/api/music/online/link", params={"url": "https://vimeo.com/1"})
    assert r.status_code == 400


def test_audio_redirects_to_the_stream_proxy(client, monkeypatch):
    fake_ytdlp(monkeypatch)
    r = client.get(f"/api/music/online/yt:{VID}/audio", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"].startswith("/api/stream/proxy?token=")
    assert client.get("/api/music/online/nope/audio").status_code == 404
