"""The server music queue: every op, stale revisions, restarts, the change feed."""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.music import queue
from sestudio.web.app import create_app
from sestudio.web.routes import music_queue as route

NAMES = ["a.m4a", "b.m4a", "c.m4a", "d.m4a"]
A, B, C, D = (downloaded.track_id(n) for n in NAMES)


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


def tracks(*ids: str) -> list[dict]:
    return [{"track_id": i} for i in ids]


def add(client, *ids, **kw):
    r = client.post("/api/music/queue", json={"tracks": tracks(*ids), **kw})
    assert r.status_code == 200, r.text
    return r.json()


def order(state) -> list[str]:
    return [i["track_id"] for i in state["items"]]


def test_empty_queue(client):
    s = client.get("/api/music/queue").json()
    assert (s["rev"], s["items"], s["current"], s["playing"]) == (0, [], -1, False)
    assert s["default_mix"] == "sync"


def test_add_at_index_and_twice(client):
    add(client, A, B)
    s = add(client, C, index=1)
    assert order(s) == [A, C, B]
    s = add(client, A)  # same track again: its own item id
    assert order(s) == [A, C, B, A]
    assert len({i["item_id"] for i in s["items"]}) == 4
    assert add(client, D, index=99)["items"][-1]["track_id"] == D
    assert order(add(client, D, index=-5))[0] == D
    assert s["current"] == 0


def test_unknown_track_rejected(client):
    r = client.post("/api/music/queue", json={"tracks": tracks("nope")})
    assert r.status_code == 404
    r = client.post(
        "/api/music/queue", json={"tracks": [{"library": "other", "track_id": A}]}
    )
    assert r.status_code == 404
    assert client.post("/api/music/queue", json={"tracks": []}).status_code == 400
    assert client.get("/api/music/queue").json()["rev"] == 0


def test_play_now_and_replace(client):
    add(client, A, B)
    s = add(client, C, index=1, play_now=True)
    assert (s["current"], s["playing"]) == (1, True)
    s = add(client, D, A, replace=True)
    assert order(s) == [D, A]
    assert (s["current"], s["playing"]) == (0, True)


def test_replace_can_start_mid_list(client):
    s = add(client, A, B, C, replace=True, start=2)
    assert order(s) == [A, B, C]
    assert (s["current"], s["playing"]) == (2, True)


def test_remove_move_play(client):
    s = add(client, A, B, C)
    ids = [i["item_id"] for i in s["items"]]
    s = client.post("/api/music/queue/play", json={"item_id": ids[1]}).json()
    assert (s["current"], s["playing"]) == (1, True)
    s = client.post("/api/music/queue/move", json={"item_id": ids[2], "to": 0}).json()
    assert order(s) == [C, A, B] and s["current"] == 2  # the playing row followed B
    s = client.post("/api/music/queue/move", json={"item_id": ids[2], "to": 99}).json()
    assert order(s) == [A, B, C]
    # removing the playing row hands over to the one that slid into its place
    s = client.delete(f"/api/music/queue/{ids[1]}").json()
    assert order(s) == [A, C] and s["current"] == 1
    assert client.delete("/api/music/queue/zzz").status_code == 400
    client.delete(f"/api/music/queue/{ids[0]}")
    s = client.delete(f"/api/music/queue/{ids[2]}").json()
    assert (s["items"], s["current"], s["playing"]) == ([], -1, False)


def test_order(client):
    s = add(client, A, B, C)
    ids = [i["item_id"] for i in s["items"]]
    client.post("/api/music/queue/play", json={"item_id": ids[1]})
    s = client.post(
        "/api/music/queue/order", json={"item_ids": [ids[2], ids[1], ids[0]]}
    ).json()
    assert order(s) == [C, B, A] and s["current"] == 1  # the playing row is followed
    # every item exactly once, or nothing changes
    for bad in ([ids[0], ids[1]], [ids[0], ids[0], ids[1]], [*ids, "zzz"]):
        assert (
            client.post("/api/music/queue/order", json={"item_ids": bad}).status_code
            == 400
        )
    assert order(client.get("/api/music/queue").json()) == [C, B, A]


def test_transport(client):
    add(client, A, B)
    t = client.post
    s = t("/api/music/queue/transport", json={"action": "play", "position": 12}).json()
    assert (s["playing"], s["position"]) == (True, 12)
    s = t("/api/music/queue/transport", json={"action": "seek", "position": 40}).json()
    assert (s["playing"], s["position"]) == (True, 40)
    s = t("/api/music/queue/transport", json={"action": "pause", "position": 41}).json()
    assert (s["playing"], s["position"]) == (False, 41)
    s = t("/api/music/queue/transport", json={"action": "next"}).json()
    assert (s["current"], s["playing"], s["position"]) == (1, True, 0)
    # end of the queue: stop on the last track, unless repeating
    s = t("/api/music/queue/transport", json={"action": "next"}).json()
    assert (s["current"], s["playing"]) == (1, False)
    t("/api/music/queue/transport", json={"action": "repeat", "repeat": True})
    s = t("/api/music/queue/transport", json={"action": "next"}).json()
    assert (s["current"], s["playing"], s["repeat"]) == (0, True, True)
    s = t("/api/music/queue/transport", json={"action": "prev"}).json()
    assert s["current"] == 0
    assert t("/api/music/queue/transport", json={"action": "seek"}).status_code == 400
    assert t("/api/music/queue/transport", json={"action": "dance"}).status_code == 422


def test_mix_settings(client):
    add(client, A, B)
    r = client.put(f"/api/music/queue/mix/{A}/{B}", json={"bars": 16, "nudge": 9999})
    s = r.json()
    assert s["mix"][f"{A}>{B}"] == {
        "mode": "sync", "bars": 16, "tempo": True, "swap": True, "nudge": 500,
    }  # fmt: skip
    r = client.put(f"/api/music/queue/mix/{A}/{B}", json={"bars": 7})
    assert r.status_code == 400
    r = client.put(f"/api/music/queue/mix/{A}/nope", json={})
    assert r.status_code == 404
    s = client.put("/api/music/queue/mix/default", json={"mode": "fade"}).json()
    assert s["default_mix"] == "fade"
    assert (
        client.put("/api/music/queue/mix/default", json={"mode": "x"}).status_code
        == 400
    )


def test_stale_rev_is_409(client):
    s = add(client, A)
    rev = s["rev"]
    ok = client.post(
        "/api/music/queue", json={"tracks": tracks(B)}, headers={"If-Match": str(rev)}
    )
    assert ok.status_code == 200
    stale = client.post(
        "/api/music/queue", json={"tracks": tracks(C)}, headers={"If-Match": str(rev)}
    )
    assert stale.status_code == 409
    assert order(stale.json()) == [A, B] and stale.json()["rev"] == rev + 1
    item = ok.json()["items"][0]["item_id"]
    assert client.delete(f"/api/music/queue/{item}?rev={rev}").status_code == 409
    assert client.delete(f"/api/music/queue/{item}?rev={rev + 1}").status_code == 200
    r = client.delete("/api/music/queue/q1", headers={"If-Match": "abc"})
    assert r.status_code == 400


def test_survives_restart(client):
    s = add(client, A, B, play_now=True)
    client.post("/api/music/queue/transport", json={"action": "seek", "position": 30})
    client.put(f"/api/music/queue/mix/{A}/{B}", json={"mode": "fade"})
    client.put("/api/music/queue/mix/default", json={"mode": "fade"})
    before = client.get("/api/music/queue").json()
    library.reset_connection()  # re-open the database file
    after = client.get("/api/music/queue").json()
    for key in ("rev", "items", "current", "position", "playing", "mix", "default_mix"):
        assert after[key] == before[key]
    # item ids keep counting up rather than reusing a removed one
    nxt = add(client, C)["items"][-1]["item_id"]
    assert nxt not in {i["item_id"] for i in s["items"]}


def test_event_feed_emits_each_op(client):
    """One event per change, named after its op, revisions strictly increasing."""

    async def scenario() -> list[tuple[str, dict]]:
        async def never() -> bool:
            return False

        feed = route.event_stream(never, ping=0.05)
        got: list[tuple[str, dict]] = []

        async def next_event() -> tuple[str, dict]:
            while True:
                chunk = await anext(feed)
                if chunk.startswith(":"):  # keep-alive
                    continue
                lines = dict(ln.split(": ", 1) for ln in chunk.strip().split("\n"))
                return lines["event"], json.loads(lines["data"])

        got.append(await next_event())  # the snapshot
        ids: list[str] = []
        ref = lambda *t: [{"library": "local", "track_id": x} for x in t]  # noqa: E731
        steps = [
            lambda: queue.add(ref(A, B, C)),
            lambda: queue.move(ids[0], 2),
            lambda: queue.play(ids[1]),
            lambda: queue.transport("pause", 5),
            lambda: queue.transport("next"),
            lambda: queue.set_mix(A, B, {"mode": "fade"}),
            lambda: queue.set_default_mix("fade"),
            lambda: queue.remove(ids[2]),
        ]
        for step in steps:
            state = await asyncio.to_thread(step)
            if not ids:
                ids = [i["item_id"] for i in state["items"]]
            got.append(await next_event())
        await feed.aclose()
        return got

    got = asyncio.run(scenario())
    assert [e for e, _ in got] == [
        "state", "ins", "mv", "go", "transport", "go", "mix", "mixd", "rm",
    ]  # fmt: skip
    revs = [d["rev"] for _, d in got]
    assert revs == sorted(set(revs)) and revs[-1] == 8
    assert all("hash" in d for _, d in got)
    assert got[2][1] == {**got[2][1], "from": 0, "to": 2}
    assert queue._subs == set()


def test_keepalive_and_disconnect(client):
    async def scenario() -> list[str]:
        calls = 0

        async def disconnected() -> bool:
            nonlocal calls
            calls += 1
            return calls > 2

        return [c async for c in route.event_stream(disconnected, ping=0.02)]

    chunks = asyncio.run(scenario())
    assert chunks[0].startswith("id: 0\nevent: state")
    assert chunks[1:] == [": ping\n\n"] * 2
    assert queue._subs == set()


def test_play_at_a_position_keeps_the_transport_state(client):
    s = add(client, A, B)
    ids = [i["item_id"] for i in s["items"]]
    client.post("/api/music/queue/transport", json={"action": "pause", "position": 3})
    s = client.post(
        "/api/music/queue/play", json={"item_id": ids[1], "position": 42}
    ).json()
    assert (s["current"], s["playing"], s["position"]) == (1, False, 42)
