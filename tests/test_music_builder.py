import pytest

from sestudio.music import builder, modes, proximity

SCALES = [
    ("A", "Aeolian"),
    ("E", "Aeolian"),
    ("D", "Aeolian"),
    ("A", "Dorian"),
    ("C", "Ionian"),
]


def trk(i, genre, bpm, energy, tonic, mode):
    notes = [modes.NAMES[p] for p in modes.pcs(modes.NAMES.index(tonic), mode)]
    return {
        "id": f"{genre[:3]}{i}", "genre": genre, "bpm": bpm, "duration": 200 + i,
        "energyScale": {"track": energy, "intro": energy, "outro": energy},
        "harmony": {"track": {"tonic": tonic, "mode": mode, "notes": notes, "brightness": modes.BRIGHTNESS.get(mode)}},
    }  # fmt: skip


# A library of 60 tracks in keys that all sit within 6 notes of A Aeolian.
POOL = [
    trk(i, g, bpm + i % 3, 10 + (i * 7) % 90, *SCALES[i % len(SCALES)])
    for g, bpm in (("Drum & Bass", 174), ("Dubstep", 140))
    for i in range(30)
]


@pytest.mark.parametrize("name", list(builder.PRESETS))
def test_each_preset_builds_a_valid_set(name):
    arc = builder.PRESETS[name]
    got = builder.build_arc(POOL, arc, 45 * 60, seed=1)
    slots = got["slots"]
    assert got["duration"] >= 45 * 60 and len({s["id"] for s in slots}) == len(slots)
    assert got["clashes"] == 0
    for s in slots[1:]:
        j = s["join"]
        assert j["safe"] and (not j["tempoJump"] or j["genreChange"])
    # The genre follows the arc: the opening and closing tracks are the first and last genre drawn.
    by_id = {t["id"]: t for t in POOL}
    assert by_id[slots[0]["id"]]["genre"] == arc["genre"][0]["g"]
    assert by_id[slots[-1]["id"]]["genre"] == arc["genre"][-1]["g"]
    assert got["genreChanges"] == len(arc["genre"]) - 1


def test_energy_follows_the_arc():
    by_id = {t["id"]: t for t in POOL}
    got = builder.build_arc(POOL, builder.PRESETS["Slow burn"], 40 * 60)
    e = [by_id[s["id"]]["energyScale"]["track"] for s in got["slots"]]
    half = len(e) // 2
    assert sum(e[half:]) / (len(e) - half) > sum(e[:half]) / half + 15


def test_seed_is_deterministic_and_try_another_differs():
    arc = builder.PRESETS["Warm-up, peak, cool-down"]

    def ids(s):
        return [x["id"] for x in builder.build_arc(POOL, arc, 1800, seed=s)["slots"]]

    assert ids(3) == ids(3)
    assert any(ids(s) != ids(3) for s in range(4, 9))


def test_start_track_opens_the_set_and_skip_is_honoured():
    arc = builder.PRESETS["Slow burn"]
    seed_track = POOL[3]
    got = builder.build_arc(POOL, arc, 1200, start=seed_track, skip={POOL[4]["id"]})
    ids = [s["id"] for s in got["slots"]]
    assert (
        ids[0] == seed_track["id"]
        and POOL[4]["id"] not in ids
        and got["slots"][0]["join"] is None
    )


def test_stops_when_the_library_runs_out():
    got = builder.build_arc(POOL[:3], builder.PRESETS["Slow burn"], 3600)
    assert len(got["slots"]) <= 3


def test_joins_match_proximity():
    got = builder.build_arc(POOL, builder.PRESETS["Flat out"], 900)
    a, b = (next(t for t in POOL if t["id"] == s["id"]) for s in got["slots"][:2])
    assert got["slots"][1]["join"] == proximity.join(a, b)


def test_a_copy_of_a_track_is_not_picked_again():
    # The same file in two libraries: another id, the same analysis.
    copies = [{**t, "id": t["id"] + "-copy"} for t in POOL]
    got = builder.build_arc(POOL + copies, builder.PRESETS["Slow burn"], 40 * 60)
    ids = [s["id"].removesuffix("-copy") for s in got["slots"]]
    assert len(set(ids)) == len(ids)


def test_old_energy_points_read_as_a_start_and_leans():
    arc = builder.upgrade(
        {
            "energy": [0.35, 0.7, 0.95, 0.4],
            "mood": [0],
            "genre": [{"g": "Drum & Bass", "x1": 1}],
        }
    )
    assert arc["start"] == 0.35
    assert [s["lean"] for s in arc["energy"]] == ["lift", "ease"]
    assert arc["energy"][-1]["x1"] == 1
    assert builder.upgrade(arc) == arc
    assert builder.build_arc(POOL, arc, 20 * 60)["slots"]
