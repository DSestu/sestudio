"""Settings › Storage's API (SPEC-storage PR 5): add, edit, remove, check a folder."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library, storage
from sestudio.web.app import create_app


@pytest.fixture()
def c(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library.reset_connection()
    downloaded.invalidate()
    (tmp_path / "out").mkdir()
    client = TestClient(create_app())
    client.put("/api/settings", json={"output_root": str(tmp_path / "out")})
    yield client
    library.reset_connection()


def test_check_says_what_is_in_a_folder(c, tmp_path):
    (tmp_path / "nas" / "A").mkdir(parents=True)
    (tmp_path / "nas" / "B").mkdir()
    r = c.get("/api/storages/check", params={"path": str(tmp_path / "nas")})
    assert r.status_code == 200
    assert r.json()["folders"] == 2 and r.json()["name"] == "nas"
    assert r.json()["free"] > 0
    bad = c.get("/api/storages/check", params={"path": str(tmp_path / "gone")})
    assert bad.status_code == 400 and "does not exist" in bad.text


def test_add_edit_and_remove(c, tmp_path):
    nas = tmp_path / "nas"
    nas.mkdir()
    r = c.post(
        "/api/storages",
        json={"kind": "folder", "roles": ["video"], "path": str(nas), "download": True},
    )
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["download"] and new["state"] == "online" and new["usage"]["total"] > 0
    rows = {s["id"]: s for s in c.get("/api/storages").json()}
    assert not rows["local"]["download"]

    r = c.patch(
        f"/api/storages/{new['id']}",
        json={"label": "NAS films", "roles": ["video", "music"]},
    )
    assert r.json()["label"] == "NAS films" and r.json()["roles"] == ["video", "music"]
    assert any(lib["id"] == new["id"] for lib in c.get("/api/music/libraries").json())

    assert c.patch("/api/storages/local", json={"download": True}).json()["download"]
    assert c.delete(f"/api/storages/{new['id']}").json() == {"ok": True}
    assert [s["id"] for s in c.get("/api/storages").json()] == ["local"]
    assert nas.is_dir()


def test_refusals_explain_themselves(c):
    r = c.post("/api/storages", json={"kind": "folder", "roles": [], "path": "."})
    assert r.status_code == 400 and "what it holds" in r.text
    assert c.delete("/api/storages/local").status_code == 400
    assert c.patch("/api/storages/nope", json={"label": "x"}).status_code == 400


def test_remote_token_is_kept_out(c):
    r = c.post(
        "/api/storages",
        json={
            "kind": "remote_sestudio",
            "roles": ["music"],
            "url": "https://o",
            "token": "sst_x",
        },
    )
    assert r.status_code == 200 and "sst_x" not in r.text
    assert "sst_x" not in c.get("/api/storages").text
    assert storage.get(r.json()["id"])["token"] == "sst_x"
