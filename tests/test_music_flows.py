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
    mix = flows.render(chunk, LIB, minutes=30, seed=1)
    kinds = [m["join"] for m in mix]
    assert kinds[1] == "match" and "up" in kinds and "break" in kinds
    assert sum(1 for m in mix if m["event"] and m["event"]["realised"]) == 2
    assert all(not m["relaxed"] for m in mix)


def test_pull_never_excludes_a_track():
    narrow = [trk(1, 172, "F"), trk(2, 172, "B", "Ionian"), trk(3, 150, "F")]
    band = [
        {
            "id": "p",
            "share": 1,
            "layers": {"tempo": [[0, 172], [1, 172]], "harmony": []},
        }
    ]
    mix = flows.render(band, narrow, minutes=9, seed=1, pins={0: "1"})
    assert (
        mix[1]["track_id"] == "2"
        and mix[1]["join"] == "break"
        and not mix[1]["relaxed"]
    )
    free = [{"id": "p", "share": 1, "layers": {"harmony": []}}]
    assert (
        flows.render(free, narrow, minutes=9, seed=1, pins={0: "1"})[1]["track_id"]
        == "3"
    )


def test_seed_pins_and_relaxation():
    flow = [
        {
            "id": "x",
            "share": 1,
            "layers": {
                "tempo": [[0, 172], [1, 172]],
                "genre": [{"from": 0, "to": 1, "genres": ["Drum & Bass"]}],
            },
        }
    ]
    ids = lambda m: [x["track_id"] for x in m]  # noqa: E731
    m1 = flows.render(flow, LIB, minutes=30, seed=7)
    assert ids(m1) == ids(flows.render(flow, LIB, minutes=30, seed=7))
    assert len(set(ids(m1))) == len(m1)
    assert (
        flows.render(flow, LIB, minutes=30, seed=7, pins={2: "29"})[2]["track_id"]
        == "29"
    )
    far = [
        {"id": "y", "share": 1, "layers": {"tempo": [[0, 164], [1, 164]]}}
    ]  # 6 off: tempo alone reaches
    mf = flows.render(far, LIB, minutes=10, seed=1)
    assert len(mf) >= 2 and all(m["relaxed"] for m in mf)
    assert mf[0]["relaxed"] == ["tempo"]  # one layer alone, not the whole ladder


def test_fork_resolution():
    fork = {
        "chunks": [
            {"id": "a", "share": 1, "next": ["b", "c"], "layers": {}},
            {
                "id": "b",
                "share": 1,
                "next": [],
                "layers": {"tempo": [[0, 124], [1, 124]]},
            },
            {
                "id": "c",
                "share": 1,
                "next": [],
                "layers": {"tempo": [[0, 172], [1, 172]]},
            },
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
    assert layers["tempo"][0] == [0, 170] and layers["tempo"][-1] == [1, 174]
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
                    {"id": "a", "layers": {"harmony": [{"at": 0, "kind": "lift"}]}}
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
