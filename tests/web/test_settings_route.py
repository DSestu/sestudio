from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio.config import DEFAULT_DOWNLOAD_ORDER
from sestudio.web.app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    app = create_app()
    return TestClient(app)


def test_get_settings_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["lang"] == "vf"
    assert "output_root" in data


def test_put_settings_persists(client):
    resp = client.put(
        "/api/settings", json={"lang": "vostfr", "output_root": "/tmp/test"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["lang"] == "vostfr"
    assert data["output_root"] == "/tmp/test"

    resp2 = client.get("/api/settings")
    assert resp2.json()["lang"] == "vostfr"


def test_tmdb_merge_defaults_off_and_persists(client):
    assert client.get("/api/settings").json()["tmdb_merge"] is False

    resp = client.put("/api/settings", json={"tmdb_merge": True})
    assert resp.status_code == 200
    assert resp.json()["tmdb_merge"] is True
    assert client.get("/api/settings").json()["tmdb_merge"] is True


def test_tmdb_posters_defaults_on_and_persists(client):
    assert client.get("/api/settings").json()["tmdb_posters"] is True

    resp = client.put("/api/settings", json={"tmdb_posters": False})
    assert resp.status_code == 200
    assert resp.json()["tmdb_posters"] is False
    assert client.get("/api/settings").json()["tmdb_posters"] is False


def test_put_settings_leaves_tmdb_flags_alone_when_absent(client):
    client.put("/api/settings", json={"tmdb_merge": True, "tmdb_posters": False})
    resp = client.put("/api/settings", json={"lang": "vo"})
    assert resp.json()["tmdb_merge"] is True
    assert resp.json()["tmdb_posters"] is False


def test_put_settings_ignores_invalid_lang(client):
    resp = client.put("/api/settings", json={"lang": "spanish"})
    assert resp.status_code == 200
    assert resp.json()["lang"] == "vf"


def test_autoplay_on_open_defaults_on_and_persists(client):
    assert client.get("/api/settings").json()["autoplay_on_open"] is True

    resp = client.put("/api/settings", json={"autoplay_on_open": False})
    assert resp.status_code == 200
    assert resp.json()["autoplay_on_open"] is False
    assert client.get("/api/settings").json()["autoplay_on_open"] is False


def test_collapse_seasons_defaults_on_and_persists(client):
    assert client.get("/api/settings").json()["collapse_seasons"] is True

    resp = client.put("/api/settings", json={"collapse_seasons": False})
    assert resp.status_code == 200
    assert resp.json()["collapse_seasons"] is False
    assert client.get("/api/settings").json()["collapse_seasons"] is False


def test_download_preferences_default_to_the_shipped_order_and_persist(client):
    body = client.get("/api/settings").json()
    assert body["preferred_hosts"] == DEFAULT_DOWNLOAD_ORDER
    assert body["preferred_sites"] == ["senpai"]
    # The client needs both to render the ranking: what can be ranked, and
    # what "reset" goes back to.
    assert body["default_hosts"] == DEFAULT_DOWNLOAD_ORDER
    assert set(DEFAULT_DOWNLOAD_ORDER).issubset(body["known_hosts"])

    resp = client.put(
        "/api/settings", json={"preferred_hosts": ["vidzy", "uqload", "vidzy"]}
    )
    # Order is the content, and a host listed twice would only muddle the
    # fallback chain, so duplicates are dropped and the order kept.
    assert resp.json()["preferred_hosts"] == ["vidzy", "uqload"]
    assert client.get("/api/settings").json()["preferred_hosts"] == ["vidzy", "uqload"]


def test_preferred_sites_ignores_sites_this_build_does_not_have(client):
    resp = client.put(
        "/api/settings", json={"preferred_sites": ["senpai", "not-a-site"]}
    )
    assert resp.json()["preferred_sites"] == ["senpai"]
