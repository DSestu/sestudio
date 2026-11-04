from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.media import ffmpeg_binary
from sestudio.music import analysis, genres, runner, store
from sestudio.web.app import create_app

SR = 22050


def _write_wav(path: Path, x: np.ndarray) -> None:
    if path.suffix == ".flac":  # an extension the library lists as music
        wav = path.with_suffix(".wav.tmp")
        _write_wav(wav.with_suffix(".wav"), x)
        subprocess.run(
            [
                ffmpeg_binary(),
                "-v",
                "error",
                "-y",
                "-i",
                str(wav.with_suffix(".wav")),
                str(path),
            ],
            check=True,
        )
        wav.with_suffix(".wav").unlink()
        return
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def clicks(bpm: float, seconds: float = 30) -> np.ndarray:
    """A kick-like thump on every beat, louder on the first of each bar."""
    x = np.zeros(int(SR * seconds))
    t = np.arange(int(SR * 0.08)) / SR
    thump = np.sin(2 * np.pi * 60 * t) * np.exp(-t * 40)
    for i, at in enumerate(np.arange(0.3, seconds - 0.1, 60 / bpm)):
        s = int(at * SR)
        x[s : s + len(thump)] += thump * (1.0 if i % 4 == 0 else 0.6)
    return x


def sine(freq: float, seconds: float = 5) -> np.ndarray:
    return 0.5 * np.sin(2 * np.pi * freq * np.arange(int(SR * seconds)) / SR)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library.reset_connection()
    yield
    library.reset_connection()


@pytest.fixture()
def root(tmp_path):
    out = tmp_path / "music"
    out.mkdir()
    downloaded.invalidate()
    return out


def test_click_track_tempo_and_downbeat(tmp_path):
    f = tmp_path / "c.wav"
    _write_wav(f, clicks(174))
    a = analysis.analyse_file(str(f))
    assert a.bpm == pytest.approx(174, abs=0.2)
    # Frames are stamped at their start, as in the prototype: one window early.
    assert a.beat0 == pytest.approx(0.3 - 1024 / 11025, abs=0.03)
    # The downbeat sits a whole number of beats from the first beat.
    beats = (a.bar0 - a.beat0) / (60 / a.bpm)
    assert beats == pytest.approx(round(beats), abs=0.05)
    assert 0 <= round(beats) < 4
    assert a.duration == pytest.approx(30, abs=0.1)


def test_bass_sine_lives_in_the_bass_bands(tmp_path):
    f = tmp_path / "s.wav"
    _write_wav(f, sine(60))
    a = analysis.analyse_file(str(f))
    means = a.bands.mean(axis=1)
    assert a.bands.shape[0] == 8
    assert int(np.argmax(means)) == 0
    assert means[0] > 5 * means[3:].max()
    assert a.bpm is None  # too short for a tempo


def test_storage_round_trip_and_normalisation(db, tmp_path):
    for name, x in (("bass", sine(60)), ("treble", sine(1800))):
        f = tmp_path / f"{name}.wav"
        _write_wav(f, x)
        store.save(name, 1.0, 10, analysis.analyse_file(str(f)))
    store.renormalise()
    got = store.get(["bass", "treble", "nope"])
    assert set(got) == {"bass", "treble"}
    bass, treble = got["bass"], got["treble"]
    assert len(bass["bands"]) == 8
    assert all(0 <= v <= 100 for row in bass["bands"] for v in row)
    assert bass["balance"][0] > bass["balance"][2]
    assert treble["balance"][2] > treble["balance"][0]
    # Normalised across the library: each band's loudest 2 % reach the cap.
    assert max(bass["bands"][0]) == 100
    # Brighter track gets the higher hue; the range is 195..320.
    assert bass["hue"] == 195
    assert treble["hue"] == 320
    assert bass["bpm"] is None


def test_renormalise_only_after_ten_percent_growth(db, tmp_path):
    f = tmp_path / "a.wav"
    _write_wav(f, sine(100))
    raw = analysis.analyse_file(str(f))
    for i in range(20):
        store.save(f"t{i}", 1.0, 1, raw)
    assert store.renormalise_if_needed() is True  # nothing normalised yet
    assert store.renormalise_if_needed() is False
    store.save("t20", 1.0, 1, raw)  # +5 %
    assert store.renormalise_if_needed() is False
    store.save("t21", 1.0, 1, raw)
    store.save("t22", 1.0, 1, raw)  # +15 %
    assert store.renormalise_if_needed() is True
    assert store._get_state()["n"] == 23


def test_runner_analyses_new_files_once_and_serves_them(
    db, root, tmp_path, monkeypatch
):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    _write_wav(root / "Artist - One.flac", clicks(150, 12))
    _write_wav(root / "Artist - Two.flac", sine(60))
    # Not an audio file: ignored.
    (root / "notes.txt").write_text("x")
    assert runner.run_once(root, workers=2) == 2
    assert runner.status().items() >= {"done": 2, "total": 2, "running": False}.items()
    assert runner.run_once(root, workers=2) == 0

    downloaded.invalidate()
    ids = [f.track_id for f in downloaded.scan(root) if f.kind == "audio"]
    assert len(ids) == 2
    got = store.get(ids)
    assert set(got) == set(ids)

    # A changed file is analysed again.
    _write_wav(root / "Artist - Two.flac", sine(60, 13))
    downloaded.invalidate()
    assert runner.run_once(root, workers=2) == 1


def test_a_broken_file_is_skipped_and_not_retried(db, root):
    (root / "Broken.m4a").write_bytes(b"not audio")
    assert runner.run_once(root, workers=1) == 0
    assert runner.run_once(root, workers=1) == 0
    assert store.count() == 0


def test_analysis_api(db, root, tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    downloaded.invalidate()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(root)})
    _write_wav(root / "Artist - Bass.flac", sine(60))
    _write_wav(root / "Artist - Hi.flac", sine(1800))
    runner.run_once(root, workers=2)
    ids = [f.track_id for f in downloaded.scan(root)]

    one = c.get(f"/api/music/tracks/{ids[0]}/analysis")
    assert one.status_code == 200
    assert {
        "bpm",
        "beat0",
        "bar0",
        "bpmConf",
        "hue",
        "bands",
        "loudness",
        "balance",
    } <= set(one.json())
    batch = c.get("/api/music/tracks/analysis", params={"ids": ",".join([*ids, "zzz"])})
    assert set(batch.json()) == set(ids)
    light = c.get("/api/music/tracks/summary", params={"ids": ",".join(ids)}).json()
    assert set(light) == set(ids)
    assert "bands" not in light[ids[0]] and "bpm" in light[ids[0]]
    assert c.get("/api/music/tracks/zzz/analysis").status_code == 404
    assert c.get("/api/music/analysis/status").json()["total"] == 2
    assert c.post("/api/music/analysis/renormalise").json() == {"tracks": 2}


@pytest.mark.exclude_ci
def test_real_library_bpms():
    folder = Path("/mnt/r/Musique/Android/neuro soundcloud")
    if not folder.is_dir():
        pytest.skip("test music not mounted")
    first = sorted(folder.glob("*.m4a"))[0]
    a = analysis.analyse_file(str(first))
    assert a.bpm and 70 <= a.bpm <= 200


def _tagged(path: Path, genre: str) -> None:
    raw = path.with_name("raw.flac")
    _write_wav(raw, clicks(174, 12))
    cmd = [ffmpeg_binary(), "-v", "error", "-y", "-i", str(raw)]
    subprocess.run([*cmd, "-metadata", f"genre={genre}", str(path)], check=True)
    raw.unlink()


def test_the_genre_is_the_file_tag_and_the_user_overrides_it(db, root, tmp_path):
    _tagged(root / "Artist - Tagged.flac", "Drum and Bass")
    runner.run_once(root, workers=1)
    downloaded.invalidate()
    tid = next(f.track_id for f in downloaded.scan(root) if f.kind == "audio")
    got = store.get([tid])[tid]
    assert (got["genre"], got["genreConf"], got["genreSource"]) == (
        "Drum & Bass",
        1.0,
        "tag",
    )
    assert store.set_genre(tid, "Liquid Drum & Bass")
    assert store.get([tid])[tid]["genreSource"] == "user"


def test_spellings_of_one_genre_show_as_the_most_used_one(db, root, tmp_path):
    for name, tag in [("A", "synthpop"), ("B", "Synth-Pop"), ("C", "SYNTH POP")]:
        _tagged(root / f"Artist - {name}.flac", tag)
    runner.run_once(root, workers=1)
    downloaded.invalidate()
    ids = [f.track_id for f in downloaded.scan(root) if f.kind == "audio"]
    assert {g["genre"] for g in store.get(ids).values()} == {"Synth Pop"}
    assert store.set_genre(ids[0], "synthpop")
    assert store.set_genre(ids[1], "Synthpop")
    assert {g["genre"] for g in store.get(ids).values()} == {"Synthpop"}


def test_an_untagged_track_gets_the_models_genre_else_the_rules(
    db, root, tmp_path, monkeypatch
):
    _write_wav(root / "Artist - Plain.flac", clicks(174, 12))
    monkeypatch.setattr(genres, "model_enabled", lambda: True)
    monkeypatch.setattr(genres, "_get_session", lambda: None)
    runner.run_once(root, workers=1)
    downloaded.invalidate()
    tid = next(f.track_id for f in downloaded.scan(root) if f.kind == "audio")
    assert store.get([tid])[tid]["genreSource"] == "rules"
    assert tid in store.pending_genre(True)  # retried once the model works
    assert tid not in store.pending_genre(False)

    monkeypatch.setattr(
        genres, "classify", lambda *_: {"genre": "Jungle", "genreConf": 0.6}
    )
    runner.run_once(root, workers=1)
    got = store.get([tid])[tid]
    assert (got["genre"], got["genreSource"]) == ("Jungle", "model")
    assert tid not in store.pending_genre(True)
