"""The flow generator (SPEC-music-flows §4–§7) and the flow / mix documents."""

import pytest

from sestudio import library
from sestudio.music import flows, mixes
from sestudio.music.modes import NAMES


def trk(i, bpm=172, tonic="F", mode="Aeolian", e=50, genre="Drum & Bass", dur=300):
    t = {
        "id": str(i),
        "bpm": bpm,
        "genre": genre,
        "duration": dur,
        "energyScale": {"track": e},
    }
    if tonic:
        t["harmony"] = {"track": {"tonic": tonic, "mode": mode}}
    return t


def J(a, b):
    return flows.join(trk(1, tonic=a[0], mode=a[1]), trk(2, tonic=b[0], mode=b[1]))


def test_join_kinds():
    assert J(("F", "Aeolian"), ("F", "Aeolian")) == "match"
    assert J(("F", "Aeolian"), ("G#", "Ionian")) == "relative"
    assert J(("F", "Aeolian"), ("C", "Aeolian")) == "up"
    assert J(("F", "Aeolian"), ("A#", "Aeolian")) == "down"
    assert J(("F", "Aeolian"), ("F", "Dorian")) == "mode+"
    assert J(("F", "Aeolian"), ("F", "Phrygian")) == "mode-"
    assert J(("F", "Aeolian"), ("D#", "Ionian")) == "up"  # the relative of the dominant
    assert J(("F", "Aeolian"), ("B", "Ionian")) == "break"
    assert (
        J(("F", "Aeolian"), ("F#", "Aeolian")) == "lift"
    )  # the same scale, up a semitone
    assert J(("F", "Aeolian"), ("D#", "Aeolian")) == "lower"  # down two
    assert J(("F", "Aeolian"), ("B", "Aeolian")) == "lift"  # the tritone counts as up
    assert J(("F", "Aeolian"), ("F", "Harmonic minor")) == "mode+"  # a raised seventh
    assert flows.join(trk(1, tonic=None), trk(2)) is None


def test_fit_is_a_score_not_a_gate():
    assert (
        flows.fit("match"),
        flows.fit("relative"),
        flows.fit("up"),
        flows.fit("break"),
    ) == (1, 0.8, 0.6, 0)
    assert (
        flows.fit("up", "up"),
        flows.fit("match", "up"),
        flows.fit("break", "break"),
    ) == (1, 0.5, 1)
    assert flows.fit(None) == 0.4


LIB = [trk(i, bpm=170 + i % 6, tonic=NAMES[i % 12], e=i * 3) for i in range(30)]
#: The same, every track close in energy: harmony decides.
NEAR = [trk(i, bpm=170 + i % 6, tonic=NAMES[i % 12], e=50 + i % 5) for i in range(30)]


def test_match_by_default_and_events_realised_once():
    chunk = [
        {
            "id": "c",
            "share": 1,
            "layers": {
                "harmony": [{"at": 0.4, "kind": "up"}, {"at": 0.7, "kind": "break"}]
            },
        }
    ]
    # Major keys too: between minor keys alone every far move is the same scale moved (a lift or a drop).
    lib = NEAR + [
        trk(100 + i, bpm=172, tonic=NAMES[i], mode="Ionian", e=52) for i in range(12)
    ]
    mix = flows.render(chunk, lib, minutes=30, seed=1)
    kinds = [m["join"] for m in mix]
    assert kinds[1] == "match" and "up" in kinds and "break" in kinds
    assert sum(1 for m in mix if m["event"] and m["event"]["realised"]) == 2
    assert not any(m["blend"]["blocked"] for m in mix)


def test_only_a_must_keeps_a_track_out():
    narrow = [trk(1, 172, "F"), trk(2, 172, "B", "Ionian"), trk(3, 150, "F")]
    soft = [{"id": "p", "share": 1, "layers": {"harmony": []}}]
    # A 22 BPM jump in key still blends better than a clash at the same tempo...
    assert (
        flows.render(soft, narrow, minutes=9, seed=1, pins={0: "1"})[1]["track_id"]
        == "3"
    )
    # ...until tempo is a Must: then the big jump is out and the clash plays.
    firm = [
        {
            "id": "p",
            "share": 1,
            "layers": {"harmony": [], "settings": {"tempo": "must"}},
        }
    ]
    mix = flows.render(firm, narrow, minutes=9, seed=1, pins={0: "1"})
    assert mix[1]["track_id"] == "2" and mix[1]["join"] == "break"
    assert not mix[1]["blend"]["blocked"]


def test_seed_and_pins():
    flow = [
        {
            "id": "x",
            "share": 1,
            "layers": {
                "start": {"tempo": 172},
                "genre": [{"from": 0, "to": 1, "genres": ["Drum & Bass"]}],
            },
        }
    ]
    ids = lambda m: [x["track_id"] for x in m]  # noqa: E731
    m1 = flows.render(flow, LIB, minutes=30, seed=7)
    assert ids(m1) == ids(flows.render(flow, LIB, minutes=30, seed=7))
    assert len(set(ids(m1))) == len(m1)
    pinned = flows.render(flow, LIB, minutes=30, seed=7, pins={2: "29"})
    assert pinned[2]["track_id"] == "29" and pinned[2]["pinned"]


ALBUM = [
    trk(
        i,
        bpm=174 + (i % 3) - 1,
        tonic=NAMES[(i * 7) % 12],
        e=40 + (i * 37) % 50,
        dur=240,
    )
    for i in range(40)
]


def test_a_small_album_fills_the_whole_flow():
    # Story 1: energies all over a 40-track album, a flow asking for a hold never stops short.
    flow = [
        {"id": "a", "share": 1, "layers": {"start": {"energy": 0.6}, "harmony": []}}
    ]
    # 160 minutes is longer than the album (40 × 220 s): it plays every track, none left out.
    mix = flows.render(flow, ALBUM, minutes=160, seed=3)
    assert len(mix) == 40
    assert "relaxed" not in mix[0]


def test_lift_climbs_and_ease_falls_in_small_steps():
    # Story 3: the set goes somewhere without a level to hit.
    lib = [trk(i, bpm=174, tonic="F", e=e) for i, e in enumerate(range(10, 100, 2))]
    flow = [
        {
            "id": "up",
            "share": 1,
            "layers": {
                "start": {"energy": 0.3},
                "energy": [{"from": 0, "to": 1, "lean": "lift"}],
            },
        },
    ]
    up = [
        m["blend"]["steps"]["energy"]
        for m in flows.render(flow, lib, minutes=40, seed=1)[1:]
    ]
    assert sum(up) / len(up) > 2 and max(abs(d) for d in up) <= 12
    flow[0]["layers"] = {
        "start": {"energy": 0.8},
        "energy": [{"from": 0, "to": 1, "lean": "ease"}],
    }
    down = [
        m["blend"]["steps"]["energy"]
        for m in flows.render(flow, lib, minutes=40, seed=1)[1:]
    ]
    assert sum(down) / len(down) < -2


def test_must_keeps_every_join_under_the_big_jump():
    # Story 4: with energy and tempo as Must, no join jumps further than the limits.
    flow = [
        {
            "id": "a",
            "share": 1,
            "layers": {"settings": {"energy": "must", "tempo": "must"}},
        }
    ]
    lib = [trk(i, bpm=140 + i * 3, tonic="F", e=(i * 23) % 100) for i in range(24)]
    for m in flows.render(flow, lib, minutes=60, seed=2)[1:]:
        if not m["blend"]["blocked"]:
            assert abs(m["blend"]["steps"]["energy"]) <= 33
            assert abs(m["blend"]["steps"]["tempo"]) <= 8


def test_old_curves_read_as_leans_and_a_start():
    old = {
        "tempo": [[0, 172], [1, 145]],
        "energy": [[0, 0.3], [0.33, 0.8], [0.8, 0.8], [1, 0.4]],
        "colour": [{"from": 0, "to": 1, "colour": "dark"}],
    }
    new = flows.upgrade(old)
    assert new["start"] == {"energy": 0.3, "tempo": 172}
    assert [b["lean"] for b in new["energy"]] == ["lift", "hold", "ease"]
    assert "tempo" not in new
    assert new["settings"] == {"harmony": "ignore", "colour": "must"}
    assert flows.upgrade(new) == new


def test_fork_resolution():
    # The generator takes the future it fills best: one whose genre Must nothing in the library meets loses.
    techno = [{"from": 0, "to": 1, "genres": ["Techno"], "strict": "must"}]
    dnb = [{"from": 0, "to": 1, "genres": ["Drum & Bass"], "strict": "must"}]
    fork = {
        "chunks": [
            {"id": "a", "share": 1, "next": ["b", "c"], "layers": {}},
            {"id": "b", "share": 1, "next": [], "layers": {"genre": techno}},
            {"id": "c", "share": 1, "next": [], "layers": {"genre": dnb}},
        ]
    }
    path, auto = flows.resolve(fork, {}, LIB, minutes=30, seed=1)
    assert auto == {"a": "c"} and [c["id"] for c in path] == ["a", "c"]
    path, auto = flows.resolve(fork, {"a": "b"}, LIB, minutes=30, seed=1)
    assert [c["id"] for c in path] == ["a", "b"] and auto == {}


def test_read_a_hand_list_as_a_flow():
    tracks = [
        trk(1, 170, "F", e=20),
        trk(2, 172, "F", e=40),
        trk(3, 174, "C", e=60),
        trk(4, 174, "C", e=80),
    ]
    flow = flows.read(tracks)
    layers = flow["chunks"][0]["layers"]
    assert layers["start"] == {"tempo": 170.0, "energy": 0.2}
    assert layers["energy"] == [{"from": 0.0, "to": 1.0, "lean": "lift"}]
    assert layers["harmony"] == [{"at": round(2 / 3, 3), "kind": "up"}]


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library.reset_connection()
    yield
    library.reset_connection()


def test_presets_seed_once_and_documents_round_trip(db):
    assert [f["name"] for f in mixes.flows_list()] == [
        "Come-down",
        "Deep",
        "Plateau",
        "Peak",
        "Warm-up",
    ]
    assert all(f["preset"] for f in mixes.flows_list())
    f = mixes.flow_create(
        "Night",
        {
            "chunks": [
                {
                    "id": "a",
                    "share": 1,
                    "next": ["b"],
                    "layers": {"tempo": [[0, 170], [1, 172]]},
                },
                {
                    "id": "b",
                    "share": 2,
                    "next": [],
                    "layers": {"harmony": [{"at": 0.5, "kind": "up"}]},
                },
            ],
            "pull": "light",
        },
    )
    assert mixes.flow_get(f["id"])["pull"] == "light" and len(mixes.flows_list()) == 6
    with pytest.raises(mixes.Invalid):
        mixes.flow_create(
            "bad", {"chunks": [{"id": "a", "next": ["zz"], "layers": {}}]}
        )
    with pytest.raises(mixes.Invalid):
        mixes.flow_create(
            "bad",
            {
                "chunks": [
                    {"id": "a", "layers": {"harmony": [{"at": 0, "kind": "soar"}]}}
                ]
            },
        )


def test_frozen_mix_ignores_a_flow_change(db):
    f = mixes.flow_create(
        "One",
        {
            "chunks": [
                {"id": "a", "share": 1, "layers": {"tempo": [[0, 172], [1, 172]]}}
            ]
        },
    )
    m = mixes.mix_create("Tonight", f["id"], seed=3)
    live = mixes.render_mix(m, LIB)
    assert live["path"] == ["a"] and len(live["mix"]) > 3
    frozen_ids = [x["track_id"] for x in live["mix"]]
    m = mixes.mix_update(m["id"], frozen=frozen_ids)
    mixes.flow_update(
        f["id"],
        None,
        {
            "chunks": [
                {"id": "a", "share": 1, "layers": {"tempo": [[0, 150], [1, 150]]}}
            ]
        },
    )
    assert [
        x["track_id"] for x in mixes.render_mix(mixes.mix_get(m["id"]), LIB)["mix"]
    ] == frozen_ids
    thawed = mixes.mix_update(m["id"], frozen=None)
    assert [x["track_id"] for x in mixes.render_mix(thawed, LIB)["mix"]] != frozen_ids


def test_hand_list_becomes_a_live_mix_with_pins(db):
    m = mixes.mix_create("neuro 2024", None, tracks=["1", "2", "3"])
    assert m["frozen"] == ["1", "2", "3"] and m["flow"] is None
    m = mixes.read_as_flow(m["id"], "neuro 2024 flow", LIB)
    assert (
        m["flow"]
        and m["frozen"] is None
        and m["pins"] == {"0": "1", "1": "2", "2": "3"}
    )
    assert [x["track_id"] for x in mixes.render_mix(m, LIB)["mix"][:3]] == [
        "1",
        "2",
        "3",
    ]


def test_branch_conditions_hold_when_the_fork_is_reached():
    assert flows.holds(
        {"kind": "skips", "count": 2, "of": 4}, 0, {"skips": [False, True, False, True]}
    )
    assert not flows.holds(
        {"kind": "skips", "count": 2, "of": 4},
        0,
        {"skips": [True, True, False, False, False, False]},
    )
    assert flows.holds({"kind": "session", "minutes": 60}, 61, {})
    assert not flows.holds({"kind": "session", "minutes": 60}, 30, {})
    late = {"kind": "time", "after": "23:00"}
    assert not flows.holds(late, 20, {"clock": 22 * 60 + 30})  # 22:50
    assert flows.holds(late, 40, {"clock": 22 * 60 + 30})  # 23:10
    assert flows.holds(late, 0, {"clock": 23 * 60 + 30})  # started after it
    assert flows.holds(
        {"kind": "time", "after": "01:00"}, 90, {"clock": 23 * 60 + 40}
    )  # past midnight


def test_a_condition_takes_the_fork_before_the_generator_but_not_before_a_choice():
    fork = {
        "chunks": [
            {
                "id": "a",
                "share": 1,
                "next": ["b", "c"],
                "layers": {},
                "when": {"b": {"kind": "skips", "count": 1, "of": 2}},
            },
            {
                "id": "b",
                "share": 1,
                "next": [],
                "layers": {"genre": [{"from": 0, "to": 1, "genres": ["Techno"]}]},
            },
            {
                "id": "c",
                "share": 1,
                "next": [],
                "layers": {"genre": [{"from": 0, "to": 1, "genres": ["Drum & Bass"]}]},
            },
        ]
    }
    path, auto = flows.resolve(fork, {}, LIB, {"skips": [True]}, minutes=30, seed=1)
    assert [c["id"] for c in path] == ["a", "b"] and auto == {"a": "b"}
    assert flows.resolve(fork, {}, LIB, {"skips": [False]}, minutes=30, seed=1)[1] == {
        "a": "c"
    }
    assert [
        c["id"]
        for c in flows.resolve(
            fork, {"a": "c"}, LIB, {"skips": [True]}, minutes=30, seed=1
        )[0]
    ] == ["a", "c"]
    assert flows.resolve(fork, {}, LIB, None, minutes=30, seed=1)[1] == {
        "a": "c"
    }  # no context: conditions ignored


def test_conditions_are_validated(db):
    ok = {
        "chunks": [
            {
                "id": "a",
                "next": ["b", "c"],
                "layers": {},
                "when": {"b": {"kind": "session", "minutes": 45}},
            },
            {"id": "b", "layers": {}},
            {"id": "c", "layers": {}},
        ]
    }
    assert mixes.flow_create("x", ok)["chunks"][0]["when"] == {
        "b": {"kind": "session", "minutes": 45}
    }
    with pytest.raises(mixes.Invalid):
        mixes.flow_create(
            "x",
            {
                **ok,
                "chunks": [
                    {**ok["chunks"][0], "when": {"b": {"kind": "mood"}}},
                    *ok["chunks"][1:],
                ],
            },
        )
    with pytest.raises(mixes.Invalid):
        mixes.flow_create(
            "x",
            {
                **ok,
                "chunks": [
                    {**ok["chunks"][0], "when": {"zz": {"kind": "session"}}},
                    *ok["chunks"][1:],
                ],
            },
        )


def test_colour_blocks_keep_the_key_colour_and_never_stop_short():
    assert [
        flows.colour(trk(1, mode=m))
        for m in ("Lydian", "Dorian", "Phrygian", "Harmonic minor")
    ] == [
        "bright",
        "warm",
        "dark",
        "exotic",
    ]
    assert flows.colour(trk(1, tonic=None)) is None
    lib = [trk(1, mode="Ionian"), trk(2, mode="Aeolian"), trk(3, tonic=None)]
    layers = {"colour": [{"from": 0, "to": 0.5, "colour": "bright"}]}
    # A stretch keeps its colour; an unread key is not left out; outside the block anything goes.
    assert [t["id"] for t in flows.fits(layers, 0, 0.5, lib)] == ["1", "3"]
    assert len(flows.fits(layers, 0.5, 1, lib)) == 3
    # Rendering never stops short: with no bright track left a blocked one plays, and says so.
    mix = flows.render(
        [
            {
                "id": "a",
                "share": 1,
                "next": [],
                "layers": {"colour": [{"from": 0, "to": 1, "colour": "bright"}]},
            }
        ],
        lib[1:2],
        minutes=5,
    )
    assert mix and mix[0]["blend"]["blocked"]


def test_a_flow_keeps_its_length_in_minutes(db):
    f = mixes.flow_create(
        "Lanes",
        {
            "chunks": [
                {
                    "id": "all",
                    "layers": {"colour": [{"from": 0, "to": 1, "colour": "dark"}]},
                }
            ],
            "length": "95",
        },
    )
    assert f["length"] == "95" and mixes.length_minutes(f) == 95
    assert (
        mixes.flow_create("x", {"chunks": [{"id": "a"}], "length": "9999"})["length"]
        == "endless"
    )
    with pytest.raises(mixes.Invalid):
        mixes.flow_create(
            "bad",
            {
                "chunks": [
                    {
                        "id": "a",
                        "layers": {"colour": [{"from": 0, "to": 1, "colour": "grey"}]},
                    }
                ]
            },
        )


# --- sources (SPEC-flows-tab §2) ---------------------------------------------------


def tagged(i, **kw):
    t = trk(i, bpm=172, tonic="F", e=50)
    t.update(title=f"song {i}", **kw)
    return t


SRC_LIB = (
    [tagged(i, library="dm", artist="Deadmau5", album="RAT") for i in range(4)]
    + [tagged(10 + i, library="dm", artist="Deadmau5", album="P56") for i in range(4)]
    + [tagged(20 + i, library="neuro", artist="Noisia", album="X") for i in range(6)]
)
ONE = {"chunks": [{"id": "a", "share": 1, "next": [], "layers": {}}]}


def ids(rendered):
    return [m["track_id"] for m in rendered["mix"]]


def test_scope_same_kind_adds_up_kinds_narrow():
    def only(*s):
        return [{"kind": k, "value": v, "rule": "only"} for k, v in s]

    got, _, narrowed = flows.scope(SRC_LIB, only(("album", "RAT"), ("album", "p56")))
    assert narrowed and {t["id"] for t in got} == {
        str(i) for i in [0, 1, 2, 3, 10, 11, 12, 13]
    }
    got, _, _ = flows.scope(SRC_LIB, only(("library", "dm"), ("album", "RAT")))
    assert {t["id"] for t in got} == {"0", "1", "2", "3"}
    got, lean, narrowed = flows.scope(
        SRC_LIB, [{"kind": "artist", "value": "noisia", "rule": "lean"}]
    )
    assert not narrowed and len(got) == len(SRC_LIB)
    assert set(lean) == {str(20 + i) for i in range(6)}


def test_lean_ranks_first_without_removing():
    lean = [{"kind": "artist", "value": "Noisia", "rule": "lean"}]
    out = ids(mixes.render_flow(ONE, SRC_LIB, minutes=120, sources=lean))
    assert out[:6] == [x for x in out if int(x) >= 20][:6]  # Noisia first
    assert len(out) == len(SRC_LIB)  # the rest still plays


def test_only_then_stop_squeezes_the_flow():
    only = [{"kind": "album", "value": "RAT", "rule": "only"}]
    r = mixes.render_flow(ONE, SRC_LIB, minutes=120, sources=only, then="stop")
    assert sorted(ids(r)) == ["0", "1", "2", "3"]
    assert r["minutes"] == pytest.approx(4 * (300 - flows.BLEND_S) / 60)


def test_only_then_similar_fills_from_the_library():
    only = [{"kind": "album", "value": "RAT", "rule": "only"}]
    out = ids(mixes.render_flow(ONE, SRC_LIB, minutes=60, sources=only))
    assert sorted(out[:4]) == ["0", "1", "2", "3"] and len(out) > 4


def test_pinned_tracks_stay_outside_the_sources():
    only = [{"kind": "album", "value": "X", "rule": "only"}]
    r = mixes.render_flow(
        ONE, SRC_LIB, minutes=60, pins={"0": "0"}, sources=only, then="stop"
    )
    assert ids(r)[0] == "0" and set(ids(r)[1:]) <= {str(20 + i) for i in range(6)}


def test_a_song_in_two_files_plays_once():
    a, b = tagged(1, artist="Skrillex"), tagged(2, artist="skrillex ")
    b["title"] = "SONG 1"
    out = [m["track_id"] for m in flows.render(ONE["chunks"], [a, b], minutes=30)]
    assert len(out) == 1


def test_play_keeps_its_sources_through_a_reroute(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from sestudio import downloaded
    from sestudio.web.app import create_app
    from sestudio.web.routes import music_flows

    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library._conn = None
    downloaded.invalidate()
    monkeypatch.setattr(music_flows, "_pool", lambda: SRC_LIB)
    c = TestClient(create_app())
    flow = c.post("/api/music/flows", json={"name": "F", "flow": ONE}).json()
    only = [{"kind": "artist", "value": "Noisia", "rule": "only"}]
    r = c.post(
        f"/api/music/flows/{flow['id']}/play",
        json={"sources": only, "then": "stop", "minutes": 120},
    )
    assert r.status_code == 200, r.text
    q = c.get("/api/music/queue").json()
    assert q["source"]["sources"] == only and q["source"]["then"] == "stop"
    noisia = {str(20 + i) for i in range(6)}
    assert {it["track_id"] for it in q["items"]} <= noisia
    r = c.post("/api/music/queue/reroute", json={"seed": 7})
    assert r.status_code == 200, r.text
    q = c.get("/api/music/queue").json()
    assert {it["track_id"] for it in q["items"]} <= noisia
    assert q["source"]["sources"] == only


def test_the_picker_lists_and_counts_sources(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from sestudio import downloaded
    from sestudio.web.app import create_app
    from sestudio.web.routes import music_flows

    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library._conn = None
    downloaded.invalidate()
    monkeypatch.setattr(music_flows, "_pool", lambda: SRC_LIB)
    c = TestClient(create_app())
    lists = c.get("/api/music/flows/sources").json()
    assert [r["value"] for r in lists["library"]] == ["dm", "neuro"]
    assert lists["album"][0] == {
        "value": "X",
        "label": "X",
        "count": 6,
        "sub": "Noisia",
    }
    assert lists["genre"] == [
        {"value": "Drum & Bass", "label": "Drum & Bass", "count": 14}
    ]
    got = c.post(
        "/api/music/flows/scope",
        json={
            "sources": [
                {"kind": "library", "value": "dm", "rule": "only"},
                {"kind": "album", "value": "RAT", "rule": "lean"},
            ]
        },
    ).json()
    assert got == {
        "count": 8,
        "lean": 4,
        "seconds": round(8 * (300 - flows.BLEND_S)),
        "narrowed": True,
    }


def test_the_set_plays_as_a_flow_leaning_on_its_tracks(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from sestudio import downloaded
    from sestudio.web.app import create_app
    from sestudio.web.routes import music_flows

    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library._conn = None
    downloaded.invalidate()
    monkeypatch.setattr(music_flows, "_pool", lambda: SRC_LIB)
    got, lean, narrowed = flows.scope(
        SRC_LIB, [{"kind": "id", "value": "3", "rule": "lean"}]
    )
    assert not narrowed and set(lean) == {"3"} and len(got) == len(SRC_LIB)
    c = TestClient(create_app())
    picked = ["20", "21", "22"]
    r = c.post("/api/music/set/flow", json={"ids": picked, "name": "My set"})
    assert r.status_code == 200, r.text
    q = c.get("/api/music/queue").json()
    assert [s["value"] for s in q["source"]["sources"]] == picked
    assert any(f["name"] == "My set" for f in c.get("/api/music/flows").json())
    assert c.post("/api/music/set/flow", json={"ids": ["nope"]}).status_code == 400
