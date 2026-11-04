from __future__ import annotations

import json

import numpy as np

from sestudio import library
from sestudio.music import profile, store
from tests.test_music_analysis import db  # noqa: F401


def _row(track_id: str, loud: float, highs: float, intro: float = 1.0) -> None:
    """A stored analysis: 60 s at *loud* RMS, *highs* of the power over 2 kHz, the
    first 12 s at *intro* times the loudness."""
    n = 600
    level = np.full(n, loud, np.float32)
    level[:120] *= intro
    bands = np.full((8, n), np.sqrt((1 - highs) / 5), np.float32)
    bands[5:] = np.sqrt(highs / 3)
    bands = bands * level
    conn = library._connect()
    conn.execute(
        "INSERT INTO music_analysis (track_id, mtime, size, analysed_at, duration, zcr,"
        " bpm, n, bands, loudness, extra) VALUES (?, 0, 0, 0, 60, 0, 174, ?, ?, ?, ?)",
        (
            track_id,
            n,
            bands.astype(np.float16).tobytes(),
            level.astype(np.float16).tobytes(),
            json.dumps({}),
        ),
    )
    conn.commit()


def test_energy_raw_reads_loudness_and_highs():
    bands = np.ones((8, 100), np.float32)
    raw = profile.energy_raw(bands, np.full(100, 0.25, np.float32))
    assert set(raw) == {"track", "intro", "outro"}
    loud, highs = raw["track"]
    assert loud == 0.25
    assert highs == 3 / 8


def test_levels_rank_tracks_against_the_library(db):  # noqa: F811
    for i, (loud, highs) in enumerate(
        [(0.05, 0.1), (0.1, 0.2), (0.2, 0.3), (0.4, 0.4)]
    ):
        _row(f"t{i}", loud, highs)
    store.renormalise()
    got = store.get([f"t{i}" for i in range(4)])
    levels = [got[f"t{i}"]["energyLevel"] for i in range(4)]
    assert levels == list(profile.LEVELS)
    scores = [got[f"t{i}"]["energyScale"]["track"] for i in range(4)]
    assert scores == sorted(scores) and scores[0] < scores[-1]


def test_intro_and_outro_are_on_the_same_scale(db):  # noqa: F811
    _row("quiet-intro", 0.4, 0.3, intro=0.1)
    _row("other", 0.2, 0.3)
    store.renormalise()
    e = store.get(["quiet-intro"])["quiet-intro"]["energyScale"]
    assert e["intro"] < e["outro"]


def test_a_state_from_before_the_scale_is_redone(db):  # noqa: F811
    _row("a", 0.2, 0.3)
    _row("b", 0.3, 0.3)
    state = store.renormalise()
    state.pop("energy")
    conn = library._connect()
    conn.execute(
        "INSERT OR REPLACE INTO music_state (key, value) VALUES ('norm', ?)",
        (json.dumps(state),),
    )
    conn.commit()
    assert "energyLevel" in store.get(["a"])["a"]
