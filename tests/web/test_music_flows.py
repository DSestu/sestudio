"""Mix-builder flows: CRUD, fork and base, become a set, deleting keeps sets."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.web.app import create_app

NAMES = ["a.m4a", "b.m4a", "c.m4a"]
A, B, C = (downloaded.track_id(n) for n in NAMES)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    out = tmp_path / "out"
    out.mkdir()
    for name in NAMES:
        (out / name).write_bytes(b"x")
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(downloaded, "audio_info", lambda f: ("", "", "", None))
    library.reset_connection()
    downloaded.invalidate()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(out)})
    yield c
    library.reset_connection()


def test_flow_lifecycle(client):
    s = client.post(
        "/api/music/playlists", json={"kind": "playlist", "name": "Set"}
    ).json()
    r = client.post(
        "/api/music/flows",
        json={
            "name": "Branch 1",
            "mode": "branch",
            "fork": {"track_id": A},
            "base": s["id"],
            "items": [{"track_id": B}],
        },
    )
    assert r.status_code == 200, r.text
    flow = r.json()
    assert flow["fork"]["track_id"] == A and flow["base"] == s["id"]
    assert [i["track_id"] for i in flow["items"]] == [B]

    r = client.patch(
        f"/api/music/flows/{flow['id']}",
        json={
            "name": "Better",
            "fork": None,
            "items": [{"track_id": C}, {"track_id": B}],
        },
    )
    assert r.json()["name"] == "Better" and r.json()["fork"] is None
    assert r.json()["base"] == s["id"]  # untouched keys stay
    assert [f["id"] for f in client.get("/api/music/flows").json()] == [flow["id"]]

    made = client.post(f"/api/music/flows/{flow['id']}/set", json={}).json()
    assert made["name"] == "Better" and made["kind"] == "playlist"
    assert [i["track_id"] for i in made["items"]] == [C, B]

    assert client.delete(f"/api/music/flows/{flow['id']}").status_code == 200
    assert client.get("/api/music/flows").json() == []
    names = [n["name"] for n in client.get("/api/music/playlists").json()]
    assert sorted(names) == ["Better", "Set"]  # sets survive their flow


def test_flow_errors(client):
    assert client.post("/api/music/flows", json={"name": "x"}).json()["mode"] == "mix"
    bad = [
        {"name": " "},
        {"name": "x", "mode": "z"},
        {"name": "x", "base": "nope"},
    ]
    for body in bad:
        assert client.post("/api/music/flows", json=body).status_code == 400
    assert client.patch("/api/music/flows/nope", json={"name": "y"}).status_code == 400
