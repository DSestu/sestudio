"""Blend playlists: fields, pins on edits, re-order with moved rows, fill from a flow, mixes carried over."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.music import flows, mixes, modes, playlists
from sestudio.web.app import create_app
from sestudio.web.routes import music_playlists

NAMES = [f"t{i}.m4a" for i in range(9)]
IDS = [downloaded.track_id(n) for n in NAMES]
ENERGY = [
    50,
    20,
    80,
    35,
    95,
    10,
    65,
    40,
    75,
]  # a jumbled run: the engine has work to do


def trk(i):
    notes = [modes.NAMES[p] for p in modes.pcs(modes.NAMES.index("A"), "Aeolian")]
    return {
        "id": IDS[i], "bpm": 128, "genre": "House", "duration": 300,
        "title": f"Song {i}", "artist": "Them", "library": "local",
        "energyScale": {"track": ENERGY[i], "intro": ENERGY[i], "outro": ENERGY[i]},
        "harmony": {"track": {"tonic": "A", "mode": "Aeolian", "notes": notes, "brightness": 0}},
    }  # fmt: skip


@pytest.fixture()
def client(tmp_path, monkeypatch):
    out = tmp_path / "out"
    out.mkdir()
    for name in NAMES:
        (out / name).write_bytes(b"x")
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(downloaded, "audio_info", lambda f: ("", "", "", None))
    by_id = {t["id"]: t for t in map(trk, range(9))}
    monkeypatch.setattr(
        music_playlists,
        "_set_tracks",
        lambda ids: [by_id.get(i, {"id": i}) for i in ids],
    )
    monkeypatch.setattr(music_playlists, "_flows_pool", lambda: list(by_id.values()))
    library.reset_connection()
    downloaded.invalidate()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(out)})
    yield c
    library.reset_connection()


def mk(client, n=6, **patch):
    r = client.post("/api/music/playlists", json={"kind": "playlist", "name": "P"})
    pid = r.json()["id"]
    tracks = [{"track_id": i} for i in IDS[:n]]
    client.post(f"/api/music/playlists/{pid}/items", json={"tracks": tracks})
    if patch:
        r = client.patch(f"/api/music/playlists/{pid}", json=patch)
        assert r.status_code == 200, r.text
    return pid


def tids(node):
    return [i["track_id"] for i in node["items"]]


def test_fields_default_and_roundtrip(client):
    pid = mk(client, 0)
    node = client.get("/api/music/playlists").json()[0]
    assert (node["blend"], node["shape"], node["pins"]) == (False, "Lift", {})
    r = client.patch(f"/api/music/playlists/{pid}", json={"shape": "Arc"})
    assert r.json()["shape"] == "Arc" and "moved" not in r.json()  # hand: nothing moves
    assert (
        client.patch(f"/api/music/playlists/{pid}", json={"shape": "x"}).status_code
        == 400
    )
    r = client.patch(f"/api/music/playlists/{pid}", json={"blend": True})
    assert r.json()["blend"] is True
    assert client.get("/api/music/playlists").json()[0]["blend"] is True


def test_hand_playlist_edits_do_not_reorder(client):
    pid = mk(client, 5)
    r = client.post(
        f"/api/music/playlists/{pid}/items",
        json={"tracks": [{"track_id": IDS[5]}], "index": 1},
    )
    assert tids(r.json()) == [IDS[0], IDS[5], *IDS[1:5]] and "moved" not in r.json()


def test_switching_to_blend_reorders_fully(client):
    pid = mk(client, 9)
    r = client.patch(f"/api/music/playlists/{pid}", json={"blend": True}).json()
    energy = [ENERGY[IDS.index(t)] for t in tids(r)]
    assert sorted(tids(r)) == sorted(IDS) and r["moved"]
    assert energy[0] < energy[-1]  # Lift: it rises
    assert set(r["moved"]) <= {i["item_id"] for i in r["items"]}


def test_add_at_index_pins_and_moves_few(client):
    pid = mk(client, 6, blend=True)
    before = client.post(f"/api/music/playlists/{pid}/blend", json={}).json()
    r = client.post(
        f"/api/music/playlists/{pid}/items",
        json={"tracks": [{"track_id": IDS[8]}], "index": 2},
    ).json()
    new = r["items"][2]
    assert new["track_id"] == IDS[8] and r["pins"] == {new["item_id"]: 2}
    assert len(r["moved"]) <= 3 and len(r["items"]) == len(before["items"]) + 1
    # a hand move pins too, and a removal drops the pin with its item
    mv = client.post(
        f"/api/music/playlists/{pid}/items/move",
        json={"item_id": r["items"][0]["item_id"], "index": 4},
    ).json()
    assert (
        mv["items"][4]["item_id"] == r["items"][0]["item_id"] and len(mv["pins"]) == 2
    )
    rm = client.delete(f"/api/music/playlists/{pid}/items/{new['item_id']}").json()
    assert new["item_id"] not in rm["pins"] and "moved" in rm


def test_blend_start_keeps_the_prefix_and_full_reorders(client):
    pid = mk(client, 9, blend=True)
    now = tids(
        client.post(f"/api/music/playlists/{pid}/blend", json={"start": 4}).json()
    )
    again = client.post(
        f"/api/music/playlists/{pid}/blend", json={"start": 4, "full": True}
    ).json()
    assert tids(again)[:4] == now[:4]
    stay = client.post(f"/api/music/playlists/{pid}/blend", json={}).json()
    assert stay["moved"] == [] or len(stay["moved"]) < 9


def test_fill_adds_tracks_and_sets_the_shape(client):
    flow = mixes.flow_create(
        "Rise",
        {
            "chunks": [
                {
                    "id": "a",
                    "layers": {"energy": [{"from": 0, "to": 1, "lean": "lift"}]},
                }
            ]
        },
    )
    pid = mk(client, 3, blend=True)
    held = {
        i["track_id"] for i in client.get("/api/music/playlists").json()[0]["items"]
    }
    r = client.post(
        f"/api/music/playlists/{pid}/fill", json={"flow": flow["id"], "minutes": 15}
    )
    assert r.status_code == 200, r.text
    node = r.json()
    assert node["shape"] == f"flow:{flow['id']}" and len(node["added"]) >= 2
    got = {i["item_id"]: i["track_id"] for i in node["items"]}
    assert all(got[a] not in held for a in node["added"]) and len(got) == 3 + len(
        node["added"]
    )
    assert isinstance(node["moved"], list)
    assert (
        client.post(
            f"/api/music/playlists/{pid}/fill", json={"flow": "nope", "minutes": 5}
        ).status_code
        == 400
    )


def test_shape_curve_follows_the_lean():
    up = flows.shape_curve(
        [
            {
                "id": "a",
                "share": 1,
                "layers": {"energy": [{"from": 0, "to": 1, "lean": "lift"}]},
            }
        ]
    )
    assert up[0] == 50 and up[-1] > up[0] and up == sorted(up)


def test_mixes_become_blend_playlists_once(client):
    flow = mixes.flow_create("Rise", {"chunks": [{"id": "a", "layers": {}}]})
    live = mixes.mix_create("Live", flow["id"], minutes=20, pins={"1": IDS[3]})
    mixes.mix_create("Hand", None, tracks=IDS[:3])
    pool = music_playlists._flows_pool()
    assert playlists.migrate_mixes(pool) == 2
    assert playlists.migrate_mixes(pool) == 0
    nodes = client.get("/api/music/playlists").json()
    folder = next(n for n in nodes if n["kind"] == "folder")
    assert folder["name"] == "Mixes"
    mine = {n["name"]: n for n in nodes if n["parent"] == folder["id"]}
    a, b = mine["Live"], mine["Hand"]
    assert (
        a["blend"]
        and a["shape"] == f"flow:{flow['id']}"
        and a["from_mix"] == live["id"]
    )
    assert tids(a)[1] == IDS[3] and list(a["pins"].values()) == [1]
    assert b["shape"] == "Lift" and tids(b) == IDS[:3] and len(b["pins"]) == 3


def test_restore_puts_items_pins_and_mode_back(client):
    pid = mk(client, 6, blend=True)
    before = client.post(f"/api/music/playlists/{pid}/blend", json={}).json()
    gone = before["items"][2]["item_id"]
    client.post(
        f"/api/music/playlists/{pid}/items/move",
        json={"item_id": before["items"][0]["item_id"], "index": 3},
    )
    client.request(
        "DELETE",
        f"/api/music/playlists/{pid}/items/{gone}",
        json={"weights": {"energy": 1}},
    )
    r = client.post(
        f"/api/music/playlists/{pid}/restore",
        json={k: before[k] for k in ("items", "parts", "pins", "blend", "shape")},
    ).json()
    assert r["items"] == before["items"] and r["pins"] == before["pins"]
    bad = client.post(
        f"/api/music/playlists/{pid}/restore",
        json={"items": [{"x": 1}], "blend": True, "shape": "Lift"},
    )
    assert bad.status_code == 400


def test_fill_dry_run_saves_nothing_and_matches_the_real_fill(client):
    flow = mixes.flow_create("Rise", {"chunks": [{"id": "a", "layers": {}}]})
    pid = mk(client, 3, blend=True)
    url = f"/api/music/playlists/{pid}/fill"
    body = {"flow": flow["id"], "minutes": 15}
    before = client.get("/api/music/playlists").json()[0]
    dry = client.post(url, json={**body, "dry_run": True}).json()
    assert client.get("/api/music/playlists").json()[0] == before
    real = client.post(url, json=body).json()
    got = {i["item_id"]: i["track_id"] for i in real["items"]}
    assert sorted(dry["candidates"]) == sorted(got[a] for a in real["added"])


def test_fill_fits_counts_what_each_flow_could_add(client):
    flow = mixes.flow_create("Rise", {"chunks": [{"id": "a", "layers": {}}]})
    pid = mk(client, 3, blend=True)
    r = client.get(f"/api/music/playlists/{pid}/fill/fits")
    assert r.status_code == 200, r.text
    fits = r.json()
    assert flow["id"] in fits and all(isinstance(n, int) for n in fits.values())
    # Tracks already in the playlist are not counted.
    assert 0 < fits[flow["id"]] <= len(IDS) - 3
