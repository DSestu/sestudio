"""Best blend of a given set, Blend by weights, harmony moves, Fix all (SPEC-music-library §2.7, §2.8)."""

import pytest
from fastapi.testclient import TestClient

from sestudio.music import blend, builder, modes, proximity
from sestudio.web.app import create_app
from sestudio.web.routes import music as music_routes


def trk(i, tonic, mode, bpm=128, genre="House", e=50, eo=None, ei=None):
    notes = [modes.NAMES[p] for p in modes.pcs(modes.NAMES.index(tonic), mode)]
    return {
        "id": f"t{i}", "bpm": bpm, "genre": genre, "duration": 300,
        "energyScale": {"track": e, "intro": ei if ei is not None else e, "outro": eo if eo is not None else e},
        "harmony": {"track": {"tonic": tonic, "mode": mode, "notes": notes, "brightness": modes.BRIGHTNESS.get(mode)}},
    }  # fmt: skip


A = trk(0, "A", "Aeolian")


def clashes(ts):
    return sum(proximity.join(a, b)["move"] == "clash" for a, b in zip(ts, ts[1:]))


def test_moves_marks_and_problems():
    j = proximity.explain(A, trk(1, "A", "Aeolian"))
    assert (j["move"], j["mark"], j["problems"]) == ("same-key", "smooth", [])
    assert proximity.join(A, trk(1, "B", "Aeolian"))["move"] == "lift"
    assert proximity.join(A, trk(1, "G", "Aeolian"))["move"] == "drop"
    clash = proximity.explain(A, trk(1, "C#", "Ionian"))
    assert clash["move"] == "clash" and clash["problems"] == ["clash"]
    # a lift is a transposition, not a clash (SPEC-key-transposition)
    assert "clash" not in proximity.explain(A, trk(1, "B", "Aeolian"))["problems"]
    tempo = proximity.join(
        trk(0, "A", "Aeolian", bpm=128), trk(1, "A", "Aeolian", bpm=150)
    )
    assert proximity.problems(tempo) == ["tempo"]
    across = proximity.join(
        trk(0, "A", "Aeolian", bpm=128, genre="House"),
        trk(1, "A", "Aeolian", bpm=150, genre="DnB"),
    )
    assert (
        proximity.problems(across) == []
    )  # a tempo jump across a genre change is fine
    energy = proximity.join(
        trk(0, "A", "Aeolian", eo=20), trk(1, "A", "Aeolian", ei=60)
    )
    assert proximity.problems(energy) == ["energy"]


def test_defaults_reproduce_the_app_and_weights_change_what_counts():
    b = trk(1, "C#", "Ionian", genre="House")  # a clash, same genre
    c = trk(2, "A", "Aeolian", genre="Techno")  # same key, other genre
    # no weights: today's Blend, to the digit
    assert (
        proximity.join(A, b)["blend"]
        == proximity.join(A, b, "hold", None, None)["blend"]
    )
    assert blend.layer_weights(blend.DEFAULT_IMPORTANCE) == pytest.approx(blend.WEIGHTS)
    keys = {"harmony": 1, "mood": 0.1, "energy": 0.1, "genre": 0.05}
    genre = {"harmony": 0.05, "mood": 0.1, "energy": 0.1, "genre": 1}
    assert (
        proximity.join(A, b, "hold", keys)["blend"]
        < proximity.join(A, c, "hold", keys)["blend"]
    )
    assert (
        proximity.join(A, b, "hold", genre)["blend"]
        > proximity.join(A, c, "hold", genre)["blend"]
    )
    # welcome: a lift made as good as the same key stops costing harmony
    lift = trk(3, "B", "Aeolian")
    assert (
        proximity.join(A, lift, "hold", None, {"lift": 1.0})["blend"]
        > proximity.join(A, lift)["blend"]
    )
    # cost still follows the blend
    j = proximity.join(A, b)
    assert proximity.cost(j) == (1 - j["blend"]) * proximity.COST_SCALE


def mixed():
    keys = [
        ("A", "Aeolian"),
        ("C#", "Ionian"),
        ("E", "Aeolian"),
        ("F", "Ionian"),
        ("D", "Aeolian"),
        ("G#", "Dorian"),
    ]
    return [trk(i, *keys[i % 6], e=10 + 9 * i) for i in range(10)]  # fmt: skip


def test_order_set_lowers_clashes_and_keeps_pins():
    tracks = mixed()
    out = builder.order_set(tracks)
    assert sorted(t["id"] for t in out) == sorted(t["id"] for t in tracks)
    assert clashes(out) < clashes(tracks)
    pinned = builder.order_set(tracks, {"3": "t7", 0: "t2"})
    assert pinned[3]["id"] == "t7" and pinned[0]["id"] == "t2" and len(pinned) == 10
    keys = builder.order_set(
        tracks, None, "Arc", {"harmony": 1, "mood": 0.05, "energy": 0.05, "genre": 0.05}
    )
    genre = builder.order_set(
        tracks, None, "Arc", {"harmony": 0.05, "mood": 0.05, "energy": 0.05, "genre": 1}
    )
    assert clashes(keys) <= clashes(genre)
    assert builder.order_set(tracks[:2]) == tracks[:2]
    # an id without an analysis still comes out, as an unknown
    out = builder.order_set([*tracks[:4], {"id": "online"}])
    assert "online" in [t["id"] for t in out] and len(out) == 5


def test_shape_moves_the_energy():
    # Same key throughout, so only energy and the shape decide.
    tracks = [trk(i, "A", "Aeolian", e=10 + 9 * i) for i in range(10)]
    e = lambda t: t["energyScale"]["track"]  # noqa: E731
    lift = [e(t) for t in builder.order_set(tracks, None, "Lift")]
    ease = [e(t) for t in builder.order_set(tracks, None, "Ease")]
    arc = [e(t) for t in builder.order_set(tracks, None, "Arc")]
    assert lift[0] < lift[-1] and sum(lift[-3:]) > sum(lift[:3])
    assert ease[0] > ease[-1] and sum(ease[-3:]) < sum(ease[:3])
    assert max(arc) in arc[2:8]  # the peak sits in the middle


def test_fix_set_inserts_a_bridge_or_moves_and_keeps_kept():
    a, b = trk(0, "A", "Aeolian"), trk(1, "C#", "Ionian")  # a clash
    pool = [trk(2, "E", "Aeolian"), trk(3, "F#", "Aeolian"), trk(4, "G#", "Aeolian")]
    before = builder._count([a, b], ())
    r = builder.fix_set([a, b], pool)
    assert r["left"] <= before and (r["inserted"] or r["moved"] or r["left"] == before)
    assert {t["id"] for t in r["order"]} <= {a["id"], b["id"], *(t["id"] for t in pool)}
    kept = builder.fix_set([a, b], pool, kept=[f"{a['id']}>{b['id']}"])
    assert kept["order"] == [a, b] and kept["inserted"] == [] and kept["left"] == 0


def test_order_and_fix_api(monkeypatch):
    tracks = mixed()
    by_id = {t["id"]: t for t in tracks}
    monkeypatch.setattr(
        music_routes, "_analyses", lambda ids: {i: by_id[i] for i in ids if i in by_id}
    )
    monkeypatch.setattr(
        music_routes.store, "stamps", lambda: {t["id"]: 1 for t in tracks}
    )
    c = TestClient(create_app())
    ids = [t["id"] for t in tracks]
    r = c.post(
        "/api/music/set/order",
        json={"ids": [*ids, "online"], "pins": {"2": "t5"}, "shape": "Lift"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["order"][2] == "t5" and set(body["order"]) == {*ids, "online"}
    assert len(body["joins"]) == len(ids) and {
        "move",
        "blend",
        "mark",
        "problems",
    } <= set(body["joins"][0])
    assert (
        c.post("/api/music/set/order", json={"ids": ids, "shape": "Zig"}).status_code
        == 400
    )
    f = c.post(
        "/api/music/set/fix", json={"ids": ids[:4], "kept": [f"{ids[0]}>{ids[1]}"]}
    ).json()
    assert {"order", "joins", "inserted", "moved", "left"} <= set(f)
    s = c.post("/api/music/set/spot", json={"ids": ids[:5], "id": ids[1]}).json()
    assert (
        sorted(s["order"]) == sorted(ids[:5]) and len(s["joins"]) == 4 and "left" in s
    )
    assert (
        c.post("/api/music/set/spot", json={"ids": ids[:3], "id": "zz"}).status_code
        == 404
    )
    br = c.post(
        "/api/music/proximity/bridges",
        json={"a": ids[0], "b": ids[1], "strict": False, "limit": 3},
    ).json()
    assert len(br["results"]) == 3 and "left" in br["results"][0]
    fits = c.post(
        "/api/music/proximity/fits-after",
        json={
            "track": ids[0],
            "filters": {"harmony": "any", "tempo": "any"},
            "weights": {"genre": 1},
        },
    ).json()
    assert fits["results"]


def test_move_to_best_lowers_the_problems():
    a, b, c = trk(0, "A", "Aeolian"), trk(1, "C#", "Ionian"), trk(2, "A", "Aeolian")
    d = trk(3, "C#", "Ionian")
    out = builder.move_to_best([a, b, c, d], b)
    assert builder._count(out, ()) < builder._count([a, b, c, d], ())


def test_order_set_reads_each_pair_once(monkeypatch):
    tracks = mixed()
    seen: list[tuple[str, str]] = []
    real = proximity.join

    def counting(a, b, *args, **kw):
        seen.append((a["id"], b["id"]))
        return real(a, b, *args, **kw)

    monkeypatch.setattr(proximity, "join", counting)
    builder.order_set(tracks, None, "Arc")
    assert len(seen) == len(set(seen))


def test_clash_penalty_follows_harmony_only_upwards():
    assert builder.clash_penalty(None) == pytest.approx(builder.SWAP_CLASH)
    keys = {"harmony": 1, "mood": 0.4, "energy": 0.35, "genre": 0.2}
    energy = {"harmony": 0.05, "mood": 0.05, "energy": 1, "genre": 0.05}
    assert builder.clash_penalty(keys) > builder.SWAP_CLASH
    assert builder.clash_penalty(energy) == pytest.approx(builder.SWAP_CLASH)
