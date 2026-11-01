"""The built frontend's top-level files are served as themselves, so the app installs."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio.web import app as app_module
from sestudio.web.app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>index")
    (dist / "manifest.webmanifest").write_text('{"display": "standalone"}')
    (tmp_path / "secret.txt").write_text("outside dist")
    monkeypatch.setattr(app_module, "_frontend_dist", lambda: dist)
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    return TestClient(create_app(live_domain="https://fs03.lol"))


def test_top_level_file_is_served_as_itself(client):
    assert client.get("/manifest.webmanifest").text == '{"display": "standalone"}'


def test_app_routes_fall_back_to_index(client):
    assert client.get("/").text == "<!doctype html>index"
    assert client.get("/watch").text == "<!doctype html>index"


@pytest.mark.parametrize(
    "path", ["/..%2Fsecret.txt", "/%2E%2E/secret.txt", "/..%5Csecret.txt"]
)
def test_paths_outside_dist_fall_back_to_index(client, path):
    assert client.get(path).text == "<!doctype html>index"
