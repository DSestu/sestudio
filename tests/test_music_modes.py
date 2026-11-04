from __future__ import annotations

import numpy as np
import pytest

from sestudio import downloaded
from sestudio.music import genres, keynet, modes, profile, runner, store
from tests.test_music_analysis import _write_wav, db, root  # noqa: F401

RATE = keynet.RATE
E = 4  # pitch class


def tone(midi: int, seconds: float) -> np.ndarray:
    t = np.arange(int(RATE * seconds)) / RATE
    f = 440 * 2 ** ((midi - 69) / 12)
    return 0.3 * np.sin(2 * np.pi * f * t) + 0.1 * np.sin(4 * np.pi * f * t)


def phrase(steps: tuple[int, ...], tonic: int = 52, held: float = 2.0) -> np.ndarray:
    """Each step held in turn over a sub drone on the tonic, as a bass plays it."""
    melody = np.concatenate([tone(tonic + 12 + s, held) for s in steps])
    return melody + 0.6 * tone(tonic - 12, len(melody) / RATE)[: len(melody)]


def skey_for(pc: int, minor: bool) -> np.ndarray:
    """S-KEY's 24 outputs, all on one key."""
    p = np.full(24, 1e-3)
    p[12 + (pc + 1) % 12 if minor else (pc - 9) % 12] = 1
    return p / p.sum()


@pytest.mark.parametrize("mode", ["Phrygian", "Aeolian", "Dorian", "Harmonic minor"])
def test_reads_the_mode_on_the_tonic(mode):
    x = phrase(modes.SCALES[mode])
    got = modes.read(x, skey_for(E, minor=True))
    assert got.label == f"E {mode}"
    assert not got.unsure
    assert got.contrast > modes.UNSURE_CONTRAST


def test_profile_holds_the_played_notes():
    prof = modes.profile(phrase(modes.SCALES["Phrygian"]))
    played = {modes.NAMES[(E + s) % 12] for s in modes.SCALES["Phrygian"]}
    assert {modes.NAMES[i] for i in np.argsort(-prof)[:7]} == played


def test_unsure_when_the_deciding_notes_are_not_played():
    """E minor pentatonic has neither 2nd nor 6th: Aeolian, Dorian and Phrygian all fit."""
    got = modes.read(phrase((0, 3, 5, 7, 10)), skey_for(E, minor=True))
    assert got.tonic == "E"
    assert got.unsure
    assert "barely played" in got.reason


def test_skey_mass_and_label_match_keynet_order():
    for pc in range(12):
        for minor in (False, True):
            p = skey_for(pc, minor)
            assert int(np.argmax(modes.skey_mass(p))) == pc
            name = f"{modes.NAMES[pc]} {'minor' if minor else 'major'}"
            assert modes.skey_label(p) == name


def test_brightness_runs_lydian_to_locrian():
    assert modes.BRIGHTNESS["Lydian"] == 3
    assert modes.BRIGHTNESS["Aeolian"] == -1
    assert modes.BRIGHTNESS["Locrian"] == -3
    assert "Phrygian dominant" not in modes.BRIGHTNESS


def test_analyse_reads_track_intro_and_outro():
    x = np.concatenate([phrase(modes.SCALES["Aeolian"])] * 3)
    got = modes.analyse(x)
    assert got is not None
    assert set(got) == {"track", "intro", "outro"}
    assert got["track"]["tonic"] == "E"
    assert modes.analyse(np.zeros(1000)) is None


def test_tracks_get_their_harmony_and_old_ones_get_it_added(
    db,  # noqa: F811
    root,  # noqa: F811
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    x = phrase(modes.SCALES["Phrygian"])
    up = np.interp(np.arange(len(x) * 2) / 2, np.arange(len(x)), x)  # 11025 -> 22050
    _write_wav(root / "Artist - Phrygian.flac", np.concatenate([up] * 2))
    runner.run_once(root, workers=1)
    downloaded.invalidate()
    tid = next(f.track_id for f in downloaded.scan(root) if f.kind == "audio")
    got = store.get([tid])[tid]["harmony"]
    assert {"track", "intro", "outro"} <= set(got)
    assert (got["track"]["tonic"], got["track"]["mode"]) == ("E", "Phrygian")

    # A track profiled before modes existed: the pass adds them and keeps the rest.
    old = {"v2": profile.VERSION, "genre": "Ambient", "genreSource": "tag"}
    store.set_extra(tid, old | {"genreConf": 1.0, "genreV": genres.VERSION})
    assert store.pending_modes() == [tid]
    assert runner.run_once(root, workers=1) == 0
    assert store.pending_modes() == []
    after = store.get([tid])[tid]
    assert after["genre"] == "Ambient"
    assert after["harmony"]["track"]["mode"] == "Phrygian"
    assert runner.status()["modes"] == {"done": 1, "total": 1}
