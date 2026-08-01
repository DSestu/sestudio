from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio.web.app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FSTREAM_DL_CONFIG", str(tmp_path / "config.json"))
    app = create_app()
    return TestClient(app)


def test_get_settings_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["lang"] == "vf"
    assert "output_root" in data


def test_put_settings_persists(client):
    resp = client.put("/api/settings", json={"lang": "vostfr", "output_root": "/tmp/test"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["lang"] == "vostfr"
    assert data["output_root"] == "/tmp/test"

    resp2 = client.get("/api/settings")
    assert resp2.json()["lang"] == "vostfr"


def test_put_settings_ignores_invalid_lang(client):
    resp = client.put("/api/settings", json={"lang": "spanish"})
    assert resp.status_code == 200
    assert resp.json()["lang"] == "vf"
