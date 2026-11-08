from sestudio.music import modes, proximity


def trk(
    id,
    tonic=None,
    mode=None,
    bpm=174,
    genre="Drum & Bass",
    e=(50, 50, 50),
    camelot=None,
):
    t = {"id": id, "bpm": bpm, "genre": genre, "camelot": camelot}
    t["energyScale"] = dict(zip(("track", "intro", "outro"), e))
    if tonic:
        notes = [modes.NAMES[p] for p in modes.pcs(modes.NAMES.index(tonic), mode)]
        t["harmony"] = {
            "track": {
                "tonic": tonic,
                "mode": mode,
                "notes": notes,
                "brightness": modes.BRIGHTNESS.get(mode),
            }
        }
    return t


def test_move_kinds():
    a = trk("a", "A", "Aeolian")
    assert proximity.join(a, trk("b", "A", "Aeolian"))["kind"] == "same-key"
    assert proximity.join(a, trk("b", "C", "Ionian"))["kind"] == "pivot"
    j = proximity.join(a, trk("b", "A", "Dorian"))
    assert (j["kind"], j["shared"], j["mood"]) == ("modal-shift", 6, "brighter")
    assert proximity.join(a, trk("b", "E", "Aeolian"))["kind"] == "next-door"
    j = proximity.join(a, trk("b", "C#", "Ionian"))
    assert (j["kind"], j["safe"]) == ("clash", False)


def test_transposition_is_a_good_join():
    a = trk("a", "A", "Aeolian")
    j = proximity.join(a, trk("b", "A#", "Aeolian"))
    assert (j["kind"], j["shared"], j["safe"], j["semitones"]) == (
        "transposed",
        2,
        True,
        1,
    )
    assert proximity.join(a, trk("b", "G", "Aeolian"))["semitones"] == -2
    assert proximity.join(a, trk("b", "D#", "Aeolian"))["semitones"] == 6
    # 5 and 7 semitones share 6 notes: still next door; another mode is no transposition
    assert proximity.join(a, trk("b", "D", "Aeolian"))["kind"] == "next-door"
    assert proximity.join(a, trk("b", "A#", "Ionian"))["kind"] == "clash"
    # a good join: as good as a fifth when a key match is wanted, well ahead of a clash
    cost = [
        proximity.cost(proximity.join(a, trk("b", k, m)))
        for k, m in (("D", "Aeolian"), ("A#", "Aeolian"), ("C#", "Ionian"))
    ]
    assert cost[0] <= cost[1] < cost[2]


def test_camelot_fallback_without_harmony():
    j = proximity.join(trk("a", camelot="8A"), trk("b", camelot="8B"))
    assert (j["kind"], j["shared"]) == ("pivot", 7)
    assert (
        proximity.join(trk("a", camelot="8A"), trk("b", camelot="9A"))["kind"]
        == "next-door"
    )
    j = proximity.join(
        trk("a", camelot="8A"), trk("b", camelot="3A")
    )  # 7 fifths up: a semitone up
    assert (j["kind"], j["safe"], j["semitones"]) == ("transposed", True, 1)
    assert (
        proximity.join(trk("a", camelot="8A"), trk("b", camelot="3B"))["safe"] is False
    )
    assert proximity.join(trk("a"), trk("b"))["kind"] is None


def test_energy_step_uses_outro_then_intro():
    a, b = trk("a", e=(50, 20, 80)), trk("b", e=(50, 30, 90))
    lo = trk("lo", e=(50, 0, 10))
    assert proximity.join(a, b)["energy"] == {"step": "eases off", "delta": -50}
    assert proximity.join(lo, b)["energy"]["step"] == "lifts"
    assert proximity.join(a, trk("c", e=(0, 85, 0)))["energy"]["step"] == "holds"


def test_tempo_and_genre():
    a = trk("a", bpm=100)
    j = proximity.join(a, trk("b", bpm=107))
    assert (j["tempoJump"], j["genreChange"], proximity.tempo_ok(j)) == (
        True,
        False,
        False,
    )
    j = proximity.join(a, trk("b", bpm=107, genre="Dubstep"))
    assert proximity.tempo_ok(j) and j["genreChange"]


def test_fits_after_ranks_and_filters():
    a = trk("a", "A", "Aeolian")
    pool = [
        a,
        trk("next", "E", "Aeolian"),
        trk("same", "A", "Aeolian"),
        trk("clash", "C#", "Ionian"),
        trk("fast", "A", "Aeolian", bpm=200),
        trk("dub", "A", "Aeolian", bpm=140, genre="Dubstep", e=(90, 90, 90)),
    ]

    def ids(f=None):
        return [r["id"] for r in proximity.fits_after(a, pool, f)]

    # Blend ranks: a next-door key at the same tempo and energy before the same key 34 BPM and 40 points away.
    assert ids() == ["same", "next", "dub"]
    assert "clash" in ids({"harmony": "any"}) and "fast" in ids({"tempo": "any"})
    assert ids({"genre": "Dubstep"}) == ["dub"]
    # An energy lean ranks, it never leaves a track out.
    assert ids({"genre": "same", "energy": "lift"}) == ["same", "next"]
    assert set(ids({"energy": "lift"})) == set(ids())


def test_bridges_and_path():
    a, b = (
        trk("a", "A", "Aeolian", e=(10, 10, 10)),
        trk(
            "b", "D", "Ionian", e=(90, 90, 90)
        ),  # 5 notes shared, another mode: a clash
    )
    mid = trk("mid", "E", "Aeolian", e=(50, 50, 50))  # shares 6 notes with each
    other = trk("other", "G", "Ionian", e=(20, 20, 20))
    assert not proximity.join(a, b)["safe"]
    assert proximity.join(a, mid)["safe"] and proximity.join(mid, b)["safe"]
    assert proximity.bridges(a, b, [a, b, mid, other])[0]["id"] == "mid"
    assert proximity.bridge_path(a, b, [a, b, mid]) == ["mid"]
    assert proximity.bridge_path(a, trk("c", "A", "Aeolian"), [mid]) == []
    assert proximity.bridge_path(a, b, [a, b]) is None
