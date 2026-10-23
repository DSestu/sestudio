from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sestudio.web.app import create_app
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
            "proxy_url": "/api/stream/proxy?token=abc",
            "kind": "mp4",
            "title": "Ep 1",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "playing"
    assert calls["location"] == "http://192.168.1.5:8200/desc.xml"
    # The renderer gets our LAN IP (not localhost) so it can actually fetch the stream.
    assert calls["media_url"] == "http://192.168.1.20:8080/api/stream/proxy?token=abc"
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
        json={"renderer_udn": "uuid:tv-1", "proxy_url": "/api/stream/proxy?token=abc"},
    )
    assert resp.status_code == 200
    assert calls["media_url"] == "https://192.168.1.20:8443/api/stream/proxy?token=abc"


def test_http_port_endpoint_reports_the_real_port(client):
    assert client.get("/api/cast/http-port").json() == {"http_port": 8080}


def test_http_port_is_null_without_an_http_server(client):
    """The browser needs to know there is no HTTP port so it keeps cast media on
    the page's own (publicly trusted) HTTPS origin."""
    client.app.state.http_port = None
    assert client.get("/api/cast/http-port").json() == {"http_port": None}


def test_play_hls_kind_maps_to_hls_mime(client, monkeypatch):
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(
        location: str, media_url: str, title: str, mime_type: str, duration=None
    ):
        calls["mime_type"] = mime_type

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    resp = client.post(
        "/api/cast/dlna/play",
        json={
            "renderer_udn": "uuid:tv-1",
            "proxy_url": "/api/stream/proxy?token=abc",
            "kind": "hls",
        },
    )
    assert resp.status_code == 200
    assert calls["mime_type"] == "application/vnd.apple.mpegurl"


def _cast_stored(client, monkeypatch, *, playable, subtitle=None, lang=None, quality=0):
    """Cast a stored file, with what the probes say about it faked."""
    client.app.state.dlna_renderers = {"uuid:tv-1": "http://192.168.1.5:8200/desc.xml"}
    calls = {}

    async def fake_play(location, media_url, title, mime_type, duration=None):
        calls.update(media_url=media_url, mime_type=mime_type, duration=duration)

    monkeypatch.setattr(cast, "_local_ip_for", lambda host: "192.168.1.20")
    monkeypatch.setattr(cast.dlna, "play_on_renderer", fake_play)
    monkeypatch.setattr(cast, "_resolved", lambda path: Path("/films") / path)
    monkeypatch.setattr(cast.downloaded, "browser_can_play", lambda f: playable)
    monkeypatch.setattr(cast.downloaded, "tv_subtitle", lambda f, lang: subtitle)
    monkeypatch.setattr(cast.downloaded, "duration_of", lambda f: 8160.0)
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
    )
    assert calls["mime_type"] == "video/mpeg"
    # Handed over so the TV can draw a seek bar for a stream with no length.
    assert calls["duration"] == 8160.0


def test_play_stored_file_with_captions_burns_them_in(client, monkeypatch):
    calls = _cast_stored(
        client, monkeypatch, playable=True, subtitle=Path("x.fr.vtt"), lang="fr"
    )
    assert "/api/downloaded/tv?" in calls["media_url"]
    assert calls["media_url"].endswith("&lang=fr")


def test_play_stored_file_at_a_lighter_quality_is_re_encoded_down(client, monkeypatch):
    """The file as stored is the best quality there is, so a lighter one is an
    encode even when the TV would have taken the file."""
    calls = _cast_stored(client, monkeypatch, playable=True, quality=480)
    assert "/api/downloaded/tv?" in calls["media_url"]
    assert calls["media_url"].endswith("&rung=480")


def test_play_stored_file_at_best_quality_goes_as_it_is(client, monkeypatch):
    calls = _cast_stored(client, monkeypatch, playable=True, quality=1080)
    assert "/api/downloaded/file?" in calls["media_url"]


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
        json={"renderer_udn": "uuid:tv-1", "proxy_url": "/api/stream/proxy?token=abc"},
    )
    assert resp.status_code == 502
    assert "renderer refused" in resp.json()["detail"]
