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


def test_energy_is_on_a_fixed_scale_whatever_the_library(db):  # noqa: F811
    _row("loud", 0.4, 0.15)
    store.renormalise()
    alone = store.get(["loud"])["loud"]["energyScale"]["track"]
    for i, (loud, highs) in enumerate([(0.3, 0.12), (0.5, 0.18), (0.45, 0.2)]):
        _row(f"o{i}", loud, highs)
    store.renormalise()
    assert store.get(["loud"])["loud"]["energyScale"]["track"] == alone
    assert "energyLevel" not in store.get(["loud"])["loud"]


def test_close_tracks_get_close_scores():
    a = profile.energy_score((0.30, 0.10))
    b = profile.energy_score((0.32, 0.105))
    assert abs(a - b) < 0.03
    assert (
        profile.energy_score((0.05, 0.015))
        < 0.2
        < 0.8
        < profile.energy_score((0.5, 0.17))
    )


def test_intro_and_outro_are_on_the_same_scale(db):  # noqa: F811
    _row("quiet-intro", 0.4, 0.3, intro=0.1)
    _row("other", 0.2, 0.3)
    store.renormalise()
    e = store.get(["quiet-intro"])["quiet-intro"]["energyScale"]
    assert e["intro"] < e["outro"]
