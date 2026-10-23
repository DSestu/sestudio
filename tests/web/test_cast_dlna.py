from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sestudio.web.app import create_app
from sestudio.web.proxy import sign
from sestudio.web.routes import cast


@pytest.fixture()
def client():
    return TestClient(create_app(live_domain="https://fs03.lol"))


def test_list_renderers_caches_locations(client, monkeypatch):
    async def fake_discover(timeout: int = 4):
        return [
            {
                "name": "Living Room TV",
                "udn": "uuid:tv-1",
                "location": "http://192.168.1.5:8200/desc.xml",
            },
            {
                "name": "Bedroom",
                "udn": "uuid:tv-2",
                "location": "http://192.168.1.9:8200/desc.xml",
            },
        ]

    monkeypatch.setattr(cast.dlna, "discover_renderers", fake_discover)
    resp = client.get("/api/cast/dlna/renderers")
    assert resp.status_code == 200
    assert resp.json() == [
        {"name": "Living Room TV", "udn": "uuid:tv-1"},
        {"name": "Bedroom", "udn": "uuid:tv-2"},
    ]
    # Control locations are cached (not exposed to the client) for the play call.
    assert (
        client.app.state.dlna_renderers["uuid:tv-1"]
        == "http://192.168.1.5:8200/desc.xml"
    )


def _proxied(client, url: str = "https://cdn.example/ep1.mp4") -> str:
    """A proxy path for *url* as `/stream/resolve` mints them: the cast route
    checks the token before deciding how the TV gets the stream."""
    token = sign(
        client.app.state.proxy_secret, url, "https://ref.example/", "voe", ttl=60
    )
    return f"/api/stream/proxy?token={token}"


def test_play_pushes_lan_absolute_url_to_known_renderer(client, monkeypatch):
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(
        location: str, media_url: str, title: str, mime_type: str, duration=None
    ):
        calls.update(
            location=location, media_url=media_url, title=title, mime_type=mime_type
        )

    # Pin the LAN IP so the assertion is deterministic (no real routing lookup).
    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    resp = client.post(
        "/api/cast/dlna/play",
        json={
            "renderer_udn": "uuid:tv-1",
            "proxy_url": (proxied := _proxied(client)),
            "kind": "mp4",
            "title": "Ep 1",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "playing"
    assert calls["location"] == "http://192.168.1.5:8200/desc.xml"
    # The renderer gets our LAN IP (not localhost) so it can actually fetch the stream.
    assert calls["media_url"] == f"http://192.168.1.20:8080{proxied}"
    assert calls["mime_type"] == "video/mp4"
    assert calls["title"] == "Ep 1"


def test_play_falls_back_to_https_when_no_http_server(client, monkeypatch):
    """HTTPS-only (`serve --no-http`): there is no plain-HTTP port to hand out.

    The media URL must move to the HTTPS port, not stay `http://` on it — that
    is plaintext against a TLS socket, which no renderer or cast device reads.
    """
    client.app.state.http_port = None
    client.app.state.https_port = 8443
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(
        location: str, media_url: str, title: str, mime_type: str, duration=None
    ):
        calls["media_url"] = media_url

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    resp = client.post(
        "/api/cast/dlna/play",
        json={"renderer_udn": "uuid:tv-1", "proxy_url": (proxied := _proxied(client))},
    )
    assert resp.status_code == 200
    assert calls["media_url"] == f"https://192.168.1.20:8443{proxied}"


def test_http_port_endpoint_reports_the_real_port(client):
    assert client.get("/api/cast/http-port").json() == {"http_port": 8080}


def test_http_port_is_null_without_an_http_server(client):
    """The browser needs to know there is no HTTP port so it keeps cast media on
    the page's own (publicly trusted) HTTPS origin."""
    client.app.state.http_port = None
    assert client.get("/api/cast/http-port").json() == {"http_port": None}


def test_play_provider_hls_goes_to_the_tv_re_encoded(client, monkeypatch):
    """Few TVs follow HLS, so a provider's playlist is sent as one continuous
    re-encoded stream, with its length so the TV can draw a seek bar."""
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(location, media_url, title, mime_type, duration=None):
        calls.update(media_url=media_url, mime_type=mime_type, duration=duration)

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    probe = cast.downloaded.StreamProbe(1320.0, 1920, 1080, 0, 0, False, True)
    monkeypatch.setattr(cast.downloaded, "probe_stream", lambda url, hls: probe)
    proxied = _proxied(client, "https://cdn.example/master.m3u8")
    resp = client.post(
        "/api/cast/dlna/play",
        json={"renderer_udn": "uuid:tv-1", "proxy_url": proxied, "kind": "hls"},
    )
    assert resp.status_code == 200
    token = proxied.split("token=", 1)[1]
    assert calls["media_url"] == (
        f"http://192.168.1.20:8080/api/stream/tv?token={token}&live=dlna"
    )
    assert calls["mime_type"] == "video/mpeg"
    assert calls["duration"] == 1320.0


def test_play_provider_mp4_at_a_lighter_quality_is_re_encoded(client, monkeypatch):
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(location, media_url, title, mime_type, duration=None):
        calls["media_url"] = media_url

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    probe = cast.downloaded.StreamProbe(1320.0, 1920, 1080, 0, 0, False, False)
    monkeypatch.setattr(cast.downloaded, "probe_stream", lambda url, hls: probe)
    resp = client.post(
        "/api/cast/dlna/play",
        json={
            "renderer_udn": "uuid:tv-1",
            "proxy_url": _proxied(client),
            "quality": 360,
        },
    )
    assert resp.status_code == 200
    assert "/api/stream/tv?token=" in calls["media_url"]
    assert "&rung=360" in calls["media_url"]


def test_play_with_a_forged_token_is_refused(client):
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    resp = client.post(
        "/api/cast/dlna/play",
        json={"renderer_udn": "uuid:tv-1", "proxy_url": "/api/stream/proxy?token=abc"},
    )
    assert resp.status_code == 403


def _cast_stored(client, monkeypatch, *, playable, subtitle=None, lang=None, quality=0):
    """Cast a stored file, with what the probes say about it faked."""
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(location, media_url, title, mime_type, duration=None):
        calls.update(media_url=media_url, mime_type=mime_type, duration=duration)
        return object()  # the renderer, kept as the session

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    monkeypatch.setattr(cast, "_resolved", lambda path: Path("/films") / path)
    monkeypatch.setattr(cast.downloaded, "browser_can_play", lambda f: playable)
    monkeypatch.setattr(cast.downloaded, "tv_subtitle", lambda f, lang: subtitle)
    monkeypatch.setattr(cast.downloaded, "duration_of", lambda f: 8160.0)
    # A 4K film: lighter steps exist both above and below 1080p.
    monkeypatch.setattr(
        cast.downloaded,
        "tracks_of",
        lambda f: cast.downloaded.MediaTracks(
            audio=[], subtitles=[], video_width=3840, video_height=2160
        ),
    )
    resp = client.post(
        "/api/cast/dlna/play",
        json={
            "renderer_udn": "uuid:tv-1",
            "proxy_url": "/api/downloaded/file?path=Matrix%2FThe%20Matrix.mkv&audio=2",
            "kind": "mp4",
            "subtitle_lang": lang,
            "quality": quality,
        },
    )
    assert resp.status_code == 200
    return calls


def test_play_stored_file_declares_its_own_mime(client, monkeypatch):
    calls = _cast_stored(client, monkeypatch, playable=True)
    assert calls["mime_type"] == "video/x-matroska"
    assert "/api/downloaded/file?" in calls["media_url"]


def test_play_stored_file_a_browser_cannot_play_is_re_encoded(client, monkeypatch):
    calls = _cast_stored(client, monkeypatch, playable=False)
    assert calls["media_url"] == (
        "http://192.168.1.20:8080/api/downloaded/tv?path=Matrix/The%20Matrix.mkv&audio=2"
        "&live=dlna"
    )
    assert calls["mime_type"] == "video/mpeg"
    # Handed over so the TV can draw a seek bar for a stream with no length.
    assert calls["duration"] == 8160.0


def test_play_stored_file_with_captions_burns_them_in(client, monkeypatch):
    calls = _cast_stored(
        client, monkeypatch, playable=True, subtitle=Path("x.fr.vtt"), lang="fr"
    )
    assert "/api/downloaded/tv?" in calls["media_url"]
    assert "&lang=fr" in calls["media_url"]


def test_play_stored_file_at_a_lighter_quality_is_re_encoded_down(client, monkeypatch):
    """The file as stored is the best quality there is, so a lighter one is an
    encode even when the TV would have taken the file."""
    calls = _cast_stored(client, monkeypatch, playable=True, quality=480)
    assert "/api/downloaded/tv?" in calls["media_url"]
    assert "&rung=480" in calls["media_url"]


def test_play_stored_file_at_best_quality_goes_as_it_is(client, monkeypatch):
    """Its own size, or more, is the file itself: nothing to re-encode."""
    for quality in (2160, 4320):
        calls = _cast_stored(client, monkeypatch, playable=True, quality=quality)
        assert "/api/downloaded/file?" in calls["media_url"]


def test_play_stored_file_above_1080p_keeps_that_size(client, monkeypatch):
    calls = _cast_stored(client, monkeypatch, playable=True, quality=1440)
    assert "&rung=1440" in calls["media_url"]


def test_the_qualities_offered_are_the_source_and_every_step_below(client, monkeypatch):
    _cast_stored(client, monkeypatch, playable=True)

    # The video last sent to the TV, for a page opened after the cast began.
    resp = client.get("/api/media/options")
    assert resp.json()["heights"] == [2160, 1440, 1080, 720, 480, 360, 240, 144]
    # Or any media URL the server handed out.
    resp = client.get(
        "/api/media/options",
        params={"url": "http://192.168.1.20:8080/api/downloaded/hls?path=x.mkv"},
    )
    assert resp.json()["heights"][0] == 2160


def test_no_qualities_are_offered_before_anything_is_cast(client):
    assert client.get("/api/media/options").json() == {
        "heights": [],
        "fps": 0,
        "frame_rates": [],
    }


@pytest.mark.parametrize(
    ("source_fps", "gpu", "speed", "offered"),
    [
        # A film: every rate is above it, drawn by AI — only with a GPU.
        (23.976, True, 1000.0, [30, 60, 120, 144]),
        (23.976, False, 1000.0, []),
        # A GPU drawing 100 frames a second at 720p: 75 is the budget, so 60
        # (36 drawn a second) holds and 120 (96) would fall behind.
        (23.976, True, 100.0, [30, 60]),
        # 60 fps: 30 is a drop and needs nothing; 60 is the source itself.
        (60.0, False, 1000.0, [30]),
        (60.0, True, 1000.0, [30, 120, 144]),
        # Unknown rate: nothing can be worked out from it.
        (0.0, True, 1000.0, []),
    ],
)
def test_frame_rates_offered_depend_on_the_source_and_the_gpu(
    client, monkeypatch, source_fps, gpu, speed, offered
):
    tracks = cast.downloaded.MediaTracks(
        audio=[],
        subtitles=[],
        video_width=1920,
        video_height=1080,
        video_fps=source_fps,
    )
    monkeypatch.setattr(cast.downloaded, "tracks_of", lambda f: tracks)
    monkeypatch.setattr(cast, "_resolved", lambda path: Path("/films") / path)
    monkeypatch.setattr(cast.interpolate, "status", lambda: {"gpu": gpu})
    monkeypatch.setattr(cast.interpolate, "speed", lambda: speed)

    body = client.get(
        "/api/media/options", params={"url": "/api/downloaded/hls?path=x.mkv"}
    ).json()

    assert body["fps"] == source_fps
    assert body["frame_rates"] == offered


def test_play_stored_file_with_no_track_in_that_language_goes_as_it_is(
    client, monkeypatch
):
    calls = _cast_stored(client, monkeypatch, playable=True, lang="fr")
    assert "/api/downloaded/file?" in calls["media_url"]


def test_play_unknown_renderer_404(client):
    resp = client.post(
        "/api/cast/dlna/play",
        json={
            "renderer_udn": "uuid:missing",
            "proxy_url": "/api/stream/proxy?token=abc",
        },
    )
    assert resp.status_code == 404


def test_mute_forwards_to_active_renderer(client):
    calls = {}

    class FakeDmr:
        async def async_mute_volume(self, muted: bool):
            calls["muted"] = muted

    client.app.state.dlna_dmr = FakeDmr()
    resp = client.post("/api/cast/dlna/mute", json={"muted": True})
    assert resp.status_code == 200
    assert calls["muted"] is True

    resp = client.post("/api/cast/dlna/mute", json={"muted": False})
    assert resp.status_code == 200
    assert calls["muted"] is False


def test_mute_without_session_409(client):
    resp = client.post("/api/cast/dlna/mute", json={"muted": True})
    assert resp.status_code == 409


def test_play_failure_maps_to_502(client, monkeypatch):
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}

    async def boom(
        location: str, media_url: str, title: str, mime_type: str, duration=None
    ):
        raise RuntimeError("renderer refused")

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", boom)
    resp = client.post(
        "/api/cast/dlna/play",
        json={"renderer_udn": "uuid:tv-1", "proxy_url": _proxied(client)},
    )
    assert resp.status_code == 502
    assert "renderer refused" in resp.json()["detail"]


def test_a_tv_playing_the_file_moves_to_the_re_encoded_stream_once(client, monkeypatch):
    """The file itself has one quality and one rate; changing either moves the
    TV to the re-encoded stream, which restarts it — the only time it does."""
    calls = _cast_stored(client, monkeypatch, playable=True)
    assert "/api/downloaded/file?" in calls["media_url"]

    resp = client.post("/api/cast/live", json={"id": "dlna", "quality": 360})

    assert resp.json()["restarted"] is True
    assert "/api/downloaded/tv?" in calls["media_url"]
    assert "&rung=360" in calls["media_url"]


def test_a_tv_on_the_re_encoded_stream_changes_in_place(client, monkeypatch):
    """No new play: the stream already open follows the new settings."""
    calls = _cast_stored(client, monkeypatch, playable=False)
    sent = calls["media_url"]

    resp = client.post("/api/cast/live", json={"id": "dlna", "quality": 720, "fps": 60})

    assert resp.json() == {"restarted": False}
    assert calls["media_url"] == sent
    assert client.app.state.live["dlna"] == {"rung": 720, "fps": 60}
    # And a page opened later offers from what the TV is now sent.
    assert client.app.state.dlna_play.quality == 720


def test_a_tv_is_never_sent_more_than_60_frames_a_second(client, monkeypatch):
    _cast_stored(client, monkeypatch, playable=False)

    client.post("/api/cast/live", json={"id": "dlna", "fps": 144})

    assert client.app.state.live["dlna"]["fps"] == 60


def test_a_chromecast_keeps_its_settings_under_its_own_id(client):
    resp = client.post("/api/cast/live", json={"id": "cc-1", "quality": 480, "fps": 30})

    assert resp.json() == {"restarted": False}
    assert client.app.state.live["cc-1"] == {"rung": 480, "fps": 30}
    # Best leaves the rung to the receiver's own choice from the master.
    client.post("/api/cast/live", json={"id": "cc-1"})
    assert client.app.state.live["cc-1"] == {"rung": None, "fps": 0}


def test_live_changes_need_a_cast_and_a_well_formed_id(client):
    assert client.post("/api/cast/live", json={"id": "dlna"}).status_code == 409
    assert client.post("/api/cast/live", json={"id": "../x"}).status_code == 422
    assert (
        client.post("/api/cast/live", json={"id": "cc", "fps": 50}).status_code == 422
    )
