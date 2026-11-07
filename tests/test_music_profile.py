from __future__ import annotations

import numpy as np
import pytest

from sestudio import downloaded
from sestudio.music import analysis, keynet, profile, runner, store
from tests.test_music_analysis import SR, _write_wav, clicks, db, root, sine  # noqa: F401


def chords(notes: list[list[float]], each: float = 4) -> np.ndarray:
    return np.concatenate([sum(sine(f, each) for f in c) / len(c) for c in notes])


# Triads with their root an octave or two below, as a bass line plays it: S-KEY
# (like the original torch model) misreads bare sine triads.
C, Am = [261.63, 329.63, 392.0, 130.81], [220.0, 261.63, 329.63, 110.0]
F, G = [174.61, 220.0, 261.63, 87.31], [196.0, 246.94, 293.66, 98.0]
Dm, E = [146.83, 174.61, 220.0, 73.42], [164.81, 207.65, 246.94, 82.41]


@pytest.mark.parametrize(
    ("progression", "key", "camelot"),
    [
        ([C, F, G, C], "C major", "8B"),
        ([Am, Dm, E, Am], "A minor", "8A"),
    ],
)
def test_key_of_a_chord_progression(db, tmp_path, progression, key, camelot):  # noqa: F811
    f = tmp_path / "chords.wav"
    _write_wav(f, chords(progression))
    got = analysis.analyse_file(str(f)).extra
    assert (got["key"], got["camelot"]) == (key, camelot)
    assert got["keyConf"] > 0


def test_key_survives_kicks_and_noise():
    """Drums and hiss used to outvote the notes: every track came out 5A or 10A."""
    x = chords([Am, Dm, E, Am])
    x += clicks(174, len(x) / SR)[: len(x)]
    x += 0.1 * np.random.default_rng(0).standard_normal(len(x))
    got = profile.key_fields(*keynet.key(x[::2]))  # 22050 -> the 11025 Hz keynet reads
    assert (got["key"], got["camelot"]) == ("A minor", "8A")


def test_key_needs_a_few_seconds():
    assert keynet.key(np.zeros(keynet.HOP * 100)) is None


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
    raw = analysis.analyse_file(str(f))
    got, ph = raw.extra, profile.phrase_phase(raw.bpm, raw.bar0)
    segs = got["structure"]
    assert [s["label"] for s in segs] == ["intro", "drop", "outro"]
    assert all((s["start_bar"] - ph) % 4 == 0 for s in segs[1:])  # on the phrase grid
    assert segs[1]["start_bar"] in range(11, 21) and segs[2]["start_bar"] in range(
        43, 53
    )
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


def test_phrases_start_on_the_musics_first_bar():
    # 172 BPM: a bar is 1.395 s. A first whole bar at 1.37 s means the music began on a
    # downbeat near 0 s that bars() skipped, so its phrases fall on bars 3, 7, 11…
    assert profile.phrase_phase(172, 1.367) == 3
    assert profile.phrase_phase(172, 0.025) == 0
    assert profile.phrase_phase(172, 0.6) == 0
    # The grid follows the phase: the drop that starts on music bar 16 is cut at bar 15.
    groups = np.full((3, 64), 0.1)
    loud = np.full(64, 0.1)
    loud[15:47] = 1
    groups[:, 15:47] = 1
    segs = profile.structure(groups, profile.energy(groups, loud), phase=3)
    assert [(s["label"], s["start_bar"]) for s in segs] == [
        ("intro", 0),
        ("drop", 15),
        ("outro", 47),
    ]


def test_one_name_in_a_row_is_one_section_and_nothing_breaks_down_before_a_drop():
    # quiet, a step up that is still quiet, a drop whose bass changes halfway, quiet
    loud = np.concatenate(
        [np.full(16, 0.1), np.full(16, 0.3), np.ones(32), np.full(16, 0.1)]
    )
    groups = np.stack([loud] * 3)
    groups[0, 48:64] = 0.4  # the switch-up: less bass, same energy
    segs = profile.structure(groups, profile.energy(groups, loud))
    labels = [s["label"] for s in segs]
    assert labels.count("drop") == 1
    assert "breakdown" not in labels[: labels.index("drop")]
    assert all(a["label"] != b["label"] for a, b in zip(segs, segs[1:]))
    assert segs[0]["start_bar"] == 0 and segs[-1]["end_bar"] == 80
