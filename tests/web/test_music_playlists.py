"""Music playlists: tree CRUD and moves, items, parts, play, smart rules."""

from __future__ import annotations

import json
import os
import time

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.music import playlists, queue, store
from sestudio.web.app import create_app

NAMES = ["a.m4a", "b.m4a", "c.m4a", "d.m4a"]
A, B, C, D = (downloaded.track_id(n) for n in NAMES)
ONLINE = {
    "library": "online",
    "track_id": "yt:abcdefghijk",
    "title": "Streamed",
    "artist": "Them",
    "duration": 60,
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    out = tmp_path / "out"
    out.mkdir()
    for name in NAMES:
        (out / name).write_bytes(b"x")
    # d.m4a was added long ago
    old = time.time() - 40 * 86400
    os.utime(out / "d.m4a", (old, old))
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(downloaded, "audio_info", lambda f: ("", "", "", None))
    library.reset_connection()
    downloaded.invalidate()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(out)})
    yield c
    library.reset_connection()


def mk(client, kind, name, **kw):
    r = client.post("/api/music/playlists", json={"kind": kind, "name": name, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def add(client, pid, *ids, **kw):
    tracks = [{"track_id": i} for i in ids]
    r = client.post(f"/api/music/playlists/{pid}/items", json={"tracks": tracks, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def ids(items):
    return [i["track_id"] for i in items]


def test_tree_create_rename_move_delete(client):
    f1, f2 = mk(client, "folder", "Sets"), mk(client, "folder", "Chill")
    pl = mk(client, "playlist", "Friday", parent=f1["id"])
    assert pl["parts"] == [] and pl["items"] == []

    r = client.patch(f"/api/music/playlists/{pl['id']}", json={"name": " Saturday "})
    assert r.json()["name"] == "Saturday"
    assert (
        client.patch(f"/api/music/playlists/{pl['id']}", json={"name": " "}).status_code
        == 400
    )

    nodes = client.post(
        f"/api/music/playlists/{pl['id']}/move", json={"parent": f2["id"]}
    ).json()
    assert {n["id"]: n["parent"] for n in nodes}[pl["id"]] == f2["id"]

    # a folder cannot go into itself or its subtree; a playlist holds nothing
    sub = mk(client, "folder", "Deep", parent=f1["id"])
    bad = client.post(
        f"/api/music/playlists/{f1['id']}/move", json={"parent": sub["id"]}
    )
    assert bad.status_code == 400
    assert (
        client.post(
            "/api/music/playlists",
            json={"kind": "playlist", "name": "x", "parent": pl["id"]},
        ).status_code
        == 400
    )

    # reorder at the top
    nodes = client.post(
        f"/api/music/playlists/{f2['id']}/move", json={"index": 0}
    ).json()
    assert [n["id"] for n in nodes if n["parent"] is None] == [f2["id"], f1["id"]]

    client.delete(f"/api/music/playlists/{f2['id']}")
    left = {n["id"] for n in client.get("/api/music/playlists").json()}
    assert left == {f1["id"], sub["id"]}
    assert client.delete("/api/music/playlists/nope").status_code == 400


def test_items_add_move_remove_cross_source(client):
    pl = mk(client, "playlist", "Mixed")
    node = add(client, pl["id"], A, B, C)
    assert (
        client.post(
            f"/api/music/playlists/{pl['id']}/items",
            json={"tracks": [ONLINE], "index": 1},
        ).status_code
        == 200
    )
    items = client.get("/api/music/playlists").json()[0]["items"]
    assert ids(items) == [A, "yt:abcdefghijk", B, C]
    assert items[1]["title"] == "Streamed" and items[1]["library"] == "online"

    first = node["items"][0]["item_id"]
    r = client.post(
        f"/api/music/playlists/{pl['id']}/items/move",
        json={"item_id": first, "index": 3},
    )
    assert ids(r.json()["items"]) == ["yt:abcdefghijk", B, C, A]
    r = client.delete(f"/api/music/playlists/{pl['id']}/items/{first}")
    assert ids(r.json()["items"]) == ["yt:abcdefghijk", B, C]
    assert add_unknown(client, pl["id"]) == 404


def add_unknown(client, pid):
    r = client.post(
        f"/api/music/playlists/{pid}/items", json={"tracks": [{"track_id": "zzz"}]}
    )
    return r.status_code


def test_parts_make_a_set(client):
    pl = mk(client, "playlist", "Set")
    node = add(client, pl["id"], A, B)
    r = client.post(f"/api/music/playlists/{pl['id']}/parts", json={"name": "Peak"})
    node = r.json()
    # the loose items became "Part 1"
    assert [p["name"] for p in node["parts"]] == ["Part 1", "Peak"]
    assert node["items"] == [] and ids(node["parts"][0]["items"]) == [A, B]
    p1, p2 = (p["id"] for p in node["parts"])

    node = add(client, pl["id"], C, part=p2)
    moved = node["parts"][0]["items"][0]["item_id"]
    r = client.post(
        f"/api/music/playlists/{pl['id']}/items/move",
        json={"item_id": moved, "part": p2, "index": 0},
    )
    parts = r.json()["parts"]
    assert ids(parts[0]["items"]) == [B] and ids(parts[1]["items"]) == [A, C]

    r = client.patch(
        f"/api/music/playlists/{pl['id']}/parts/{p2}", json={"name": "Cool", "index": 0}
    )
    assert [p["name"] for p in r.json()["parts"]] == ["Cool", "Part 1"]

    r = client.delete(
        f"/api/music/playlists/{pl['id']}/parts/{p2}"
    )  # Cool: first, joins the next
    node = r.json()
    assert [p["name"] for p in node["parts"]] == ["Part 1"]
    assert ids(node["parts"][0]["items"]) == [A, C, B]
    r = client.delete(
        f"/api/music/playlists/{pl['id']}/parts/{p1}"
    )  # the last one: a plain list
    assert r.json()["parts"] == [] and ids(r.json()["items"]) == [A, C, B]


def test_play_replaces_the_queue_in_order(client):
    pl = mk(client, "playlist", "Set")
    add(client, pl["id"], A, B)
    node = client.post(
        f"/api/music/playlists/{pl['id']}/parts", json={"name": "Two"}
    ).json()
    p2 = node["parts"][1]["id"]
    add(client, pl["id"], C, part=p2)

    client.post("/api/music/queue", json={"tracks": [{"track_id": D}]})
    r = client.post(f"/api/music/playlists/{pl['id']}/play", json={})
    assert ids(r.json()["items"]) == [A, B, C]
    r = client.post(f"/api/music/playlists/{pl['id']}/play", json={"part": p2})
    assert ids(r.json()["items"]) == [C]
    assert queue.get_state()["playing"] is True
    folder = mk(client, "folder", "F")
    assert (
        client.post(f"/api/music/playlists/{folder['id']}/play", json={}).status_code
        == 400
    )


def test_smart_rules(client):
    conn = library._connect()
    for tid, bpm, genre in [(A, 128.0, "House"), (B, 170.0, "DnB"), (C, None, None)]:
        conn.execute(
            "INSERT INTO music_analysis (track_id, mtime, size, analysed_at, duration, zcr,"
            " bpm, n, bands, loudness, extra) VALUES (?, 0, 0, 0, 1, 0, ?, 0, x'', x'', ?)",
            (tid, bpm, json.dumps({"genre": genre} if genre else {})),
        )
    conn.commit()

    def got(**rules):
        s = mk(client, "smart", "s", rules=rules)
        r = client.get(f"/api/music/playlists/{s['id']}/tracks")
        return {t["track_id"] for t in r.json()}

    assert got() == {A, B, C, D}
    assert got(genres=["house"]) == {A}
    assert got(genres=["H-O-U-S-E"]) == {A}
    assert got(bpm_min=120, bpm_max=140) == {A}
    assert got(bpm_min=150) == {B}
    assert got(added_days=7) == {A, B, C}  # d.m4a is 40 days old
    queue.add([{"library": "local", "track_id": A}], play_now=True)
    assert got(never_played=True) == {B, C, D}

    s = mk(client, "smart", "Fast", rules={"bpm_min": 150})
    r = client.post(f"/api/music/playlists/{s['id']}/play", json={})
    assert ids(r.json()["items"]) == [B]


def test_matches_unit():
    rules = playlists.clean_rules(
        {"genres": ["House"], "bpm_min": "120", "added_days": 1}
    )
    track = {"mtime": 100.0, "bpm": 125, "genre": "house", "played": True}
    assert playlists.matches(rules, track, now=100.0 + 3600)
    assert not playlists.matches(rules, {**track, "bpm": 100}, now=100.0)
    assert not playlists.matches(rules, track, now=100.0 + 2 * 86400)


def test_matches_mood_and_energy():
    t = {"mtime": 0.0, "brightness": -2, "energy": 70}
    m = lambda **r: playlists.matches(playlists.clean_rules(r), t, now=0.0)  # noqa: E731
    assert m(mood_max=-1, energy_min=60)  # "Dark & driving"
    assert not m(mood_min=0)
    assert not m(energy_min=80)
    assert not playlists.matches(
        playlists.clean_rules({"mood_max": 0}), {"mtime": 0.0}, now=0.0
    )


def test_reorder_items(client):
    pl = mk(client, "playlist", "P")
    got = client.post(
        f"/api/music/playlists/{pl['id']}/items",
        json={"tracks": [{"library": "local", "track_id": t} for t in (A, B, C)]},
    ).json()
    order = [i["item_id"] for i in got["items"]][::-1]
    url = f"/api/music/playlists/{pl['id']}/items/reorder"
    r = client.post(url, json={"order": order})
    assert [i["item_id"] for i in r.json()["items"]] == order
    assert client.post(url, json={"order": order[:2]}).status_code == 400


def test_genre_override(client):
    conn = library._connect()
    conn.execute(
        "INSERT INTO music_analysis (track_id, mtime, size, analysed_at, duration, zcr,"
        " bpm, n, bands, loudness, extra) VALUES (?, 0, 0, 0, 1, 0, 128, 1, ?, ?, ?)",
        (A, bytes(16), bytes(2), json.dumps({"genre": "House", "genreConf": 0.4})),
    )
    conn.commit()
    r = client.put(f"/api/music/tracks/{A}/genre", json={"genre": "Techno"})
    assert r.status_code == 200
    assert (
        client.put(f"/api/music/tracks/{B}/genre", json={"genre": "x"}).status_code
        == 404
    )
    store.set_extra(A, {"genre": "House"})  # a re-profile keeps the choice
    got = store.get([A])[A]
    assert (got["genre"], got["genreConf"]) == ("Techno", 1.0)
    s = mk(client, "smart", "t", rules={"genres": ["techno"]})
    refs = client.get(f"/api/music/playlists/{s['id']}/tracks").json()
    assert [t["track_id"] for t in refs] == [A]


def test_reorder_whole_set_keeps_part_sizes(client):
    pl = mk(client, "playlist", "S")
    base = f"/api/music/playlists/{pl['id']}"
    client.post(f"{base}/parts", json={"name": "One"})
    p2 = client.post(f"{base}/parts", json={"name": "Two"}).json()["parts"][1]["id"]
    refs = [{"library": "local", "track_id": t} for t in (A, B, C)]
    client.post(f"{base}/items", json={"tracks": refs, "part": None, "index": 0})
    client.post(f"{base}/items", json={"tracks": [refs[0]], "part": p2})
    node = {n["id"]: n for n in client.get("/api/music/playlists").json()}[pl["id"]]
    ids = [i["item_id"] for p in node["parts"] for i in p["items"]]
    r = client.post(f"{base}/items/reorder", json={"order": ids[::-1], "whole": True})
    parts = r.json()["parts"]
    assert [len(p["items"]) for p in parts] == [len(p["items"]) for p in node["parts"]]
    assert [i["item_id"] for p in parts for i in p["items"]] == ids[::-1]
