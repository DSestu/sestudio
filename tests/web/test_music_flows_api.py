"""Playing a flow or a mix: the queue becomes the playing mix (SPEC-music-flows §7, PR 3)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import library
from sestudio.music import queue
from sestudio.music.modes import NAMES
from sestudio.web.app import create_app
from sestudio.web.routes import music_flows as route

POOL = [
    {
        "id": f"t{i}",
        "library": "local",
        "bpm": 170 + i % 6,
        "genre": "Drum & Bass",
        "duration": 300,
        "energyScale": {"track": i * 3},
        "harmony": {"track": {"tonic": NAMES[i % 12], "mode": "Aeolian"}},
    }
    for i in range(30)
]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(route, "_pool", lambda: [dict(t) for t in POOL])
    library.reset_connection()
    yield TestClient(create_app())
    library.reset_connection()


FORK = {
    "chunks": [
        {"id": "a", "share": 1, "next": ["b", "c"], "layers": {"harmony": []}},
        {
            "id": "b",
            "share": 1,
            "next": [],
            "layers": {"tempo": [[0, 171], [1, 171]], "harmony": []},
        },
        {
            "id": "c",
            "share": 1,
            "next": [],
            "layers": {"tempo": [[0, 174], [1, 174]], "harmony": []},
        },
    ],
    "length": "60",
}


def flow(client, doc=FORK):
    r = client.post("/api/music/flows", json={"name": "Night", "flow": doc})
    assert r.status_code == 200, r.text
    return r.json()


def test_playing_a_flow_fills_the_queue_with_its_joins(client):
    f = flow(client)
    s = client.post(f"/api/music/flows/{f['id']}/play", json={"seed": 2}).json()
    assert s["playing"] and s["current"] == 0 and len(s["items"]) > 5
    assert s["source"]["flow"] == f["id"] and s["source"]["path"][0] == "a"
    assert s["source"]["seed"] == 2
    first, second = s["items"][0], s["items"][1]
    assert first["library"] == "local" and first["flow"]["chunk"] == "a"
    assert second["flow"]["join"] in (
        "match",
        "relative",
        "up",
        "down",
        "mode+",
        "mode-",
        "break",
    )


def test_reroute_keeps_the_played_part(client):
    f = flow(client)
    s = client.post(f"/api/music/flows/{f['id']}/play", json={}).json()
    played = [i["item_id"] for i in s["items"][:3]]
    s = client.post("/api/music/queue/play", json={"item_id": played[2]}).json()
    first_path = s["source"]["path"]
    other = "b" if first_path[1] == "c" else "c"
    s = client.post("/api/music/queue/reroute", json={"choices": {"a": other}}).json()
    assert [i["item_id"] for i in s["items"][:3]] == played and s["current"] == 2
    assert s["source"]["path"] == ["a", other] and s["source"]["choices"] == {
        "a": other
    }
    assert all(i["flow"]["chunk"] in ("a", other) for i in s["items"][3:])
    ids = [i["track_id"] for i in s["items"]]
    assert len(ids) == len(set(ids))


def test_a_hand_made_queue_has_no_source_and_cannot_reroute(client):
    r = client.post("/api/music/queue/reroute", json={})
    assert r.status_code == 400
    assert client.get("/api/music/queue").json()["source"] is None


def test_playing_a_frozen_mix_plays_its_tracks(client):
    f = flow(client)
    m = client.post("/api/music/mixes", json={"name": "Fri", "flow": f["id"]}).json()
    frozen = client.post(f"/api/music/mixes/{m['id']}/freeze").json()["frozen"]
    s = client.post(f"/api/music/mixes/{m['id']}/play").json()
    assert [i["track_id"] for i in s["items"]] == frozen
    assert s["source"]["mix"] == m["id"] and s["source"]["frozen"]
    assert client.post("/api/music/queue/reroute", json={}).status_code == 400


def test_read_the_queue_as_a_flow(client):
    f = flow(client)
    s = client.post(f"/api/music/flows/{f['id']}/play", json={}).json()
    before = [i["track_id"] for i in s["items"]]
    # A hand-made queue: replace it without a source (the synthetic tracks are not on disk, so not via the route).
    queue.add([{"library": "local", "track_id": t} for t in before[:4]], replace=True)
    assert client.get("/api/music/queue").json()["source"] is None
    s = client.post("/api/music/queue/read", json={"name": "Mine"}).json()
    assert s["source"]["flow"] and s["source"]["mix"]
    assert [i["track_id"] for i in s["items"]] == before[:4]
    mix = client.get(f"/api/music/mixes/{s['source']['mix']}").json()
    assert mix["pins"] == {str(k): t for k, t in enumerate(before[:4])}
