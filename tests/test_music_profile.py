from __future__ import annotations

import numpy as np
import pytest

from sestudio import downloaded
from sestudio.music import analysis, profile, runner, store
from tests.test_music_analysis import _write_wav, clicks, db, root, sine  # noqa: F401


def chords(notes: list[list[float]], each: float = 4) -> np.ndarray:
    return np.concatenate([sum(sine(f, each) for f in c) / len(c) for c in notes])


C, Am = [261.63, 329.63, 392.0], [220.0, 261.63, 329.63]
F, G = [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]
Dm, Em = [146.83, 174.61, 220.0], [164.81, 196.0, 246.94]


@pytest.mark.parametrize(
    ("progression", "key", "camelot"),
    [
        ([C, Am, F, G, C], "C major", "8B"),
        ([Am, Dm, Em, Am], "A minor", "8A"),
    ],
)
def test_key_of_a_chord_progression(db, tmp_path, progression, key, camelot):  # noqa: F811
    f = tmp_path / "chords.wav"
    _write_wav(f, chords(progression))
    got = analysis.analyse_file(str(f)).extra
    assert (got["key"], got["camelot"]) == (key, camelot)
    assert got["keyConf"] > 0


def test_structure_of_quiet_loud_quiet(db, tmp_path):  # noqa: F811
    """16 quiet bars, 32 loud ones, 16 quiet ones, through the whole pipeline."""
    rng = np.random.default_rng(0)
    parts = []
    for bars, level in ((16, 0.1), (32, 1.0), (16, 0.1)):
        x = clicks(128, bars * 240 / 128) * level
        if level > 0.5:  # hats
            x += 0.2 * rng.standard_normal(len(x)) * (np.arange(len(x)) % 2756 < 400)
        parts.append(x)
    f = tmp_path / "arr.wav"
    _write_wav(f, np.concatenate(parts))
    got = analysis.analyse_file(str(f)).extra
    segs = got["structure"]
    assert [s["label"] for s in segs] == ["intro", "drop", "outro"]
    assert all(s["start_bar"] % 4 == 0 for s in segs)
    assert segs[1]["start_bar"] in (12, 16, 20) and segs[2]["start_bar"] in (44, 48, 52)
    assert max(got["energy"][:10]) < min(got["energy"][20:44])


def test_structure_on_known_bars():
    groups = np.full((3, 64), 0.1)
    loud = np.full(64, 0.1)
    loud[16:48] = 1
    groups[:, 16:48] = 1
    segs = profile.structure(groups, profile.energy(groups, loud))
    assert segs == [
        {"label": "intro", "start_bar": 0, "end_bar": 16},
        {"label": "drop", "start_bar": 16, "end_bar": 48},
        {"label": "outro", "start_bar": 48, "end_bar": 64},
    ]
    # A ramp before a drop is a buildup, a dip between two drops a breakdown.
    loud = np.concatenate(
        [
            np.full(16, 0.1),
            np.linspace(0.1, 0.5, 8),
            np.ones(24),
            np.full(16, 0.2),
            np.ones(24),
        ]
    )
    groups = np.stack([loud] * 3)
    labels = [
        s["label"] for s in profile.structure(groups, profile.energy(groups, loud))
    ]
    assert "buildup" in labels
    assert "breakdown" in labels


def test_v2_is_served_and_old_rows_are_profiled_again(db, root, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    _write_wav(root / "Artist - Chords.flac", chords([C, Am, F, G, C]))
    runner.run_once(root, workers=1)
    downloaded.invalidate()
    tid = next(f.track_id for f in downloaded.scan(root) if f.kind == "audio")
    got = store.get([tid])[tid]
    assert got["camelot"] == "8B"
    assert "chroma" not in got
    store.set_extra(tid, {})  # a row from before v2
    assert store.pending_v2() == [tid]
    assert runner.run_once(root, workers=1) == 1
    assert store.pending_v2() == []
    assert store.get([tid])[tid]["camelot"] == "8B"


def test_genre_rules():
    en = np.tile([0.3, 0.9], 16)
    bass = np.stack([np.full(32, 0.6), np.full(32, 0.2), np.full(32, 0.1)])
    assert profile.genre(174, bass, en)["genre"] in (
        "Drum & Bass",
        "Neurofunk",
        "Liquid Drum & Bass",
    )
    assert profile.genre(145, bass, en)["genre"] == "Dubstep"
    assert profile.genre(95, bass, en)["genre"] == "Hip-hop"
    assert profile.genre(None, bass, en) is None
