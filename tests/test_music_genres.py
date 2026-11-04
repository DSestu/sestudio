from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from sestudio import interpolate
from sestudio.music import genres


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("DnB", "Drum & Bass"),
        ("Drum and Bass", "Drum & Bass"),
        ("drum & bass", "Drum & Bass"),
        ("Drum 'n' Bass", "Drum & Bass"),
        ("Neuro", "Neurofunk"),
        ("neurofunk", "Neurofunk"),
        ("Liquid", "Liquid Drum & Bass"),
        ("Liquid Funk", "Liquid Drum & Bass"),
        ("Hip Hop", "Hip-hop"),
        ("(17)", None),
        ("Other", None),
        ("", None),
        (None, None),
        ("Dubstep; Bass", "Dubstep"),
        ("Experimental Weirdness", "Experimental Weirdness"),
        ("Metal", "Metal"),
        ("METAL", "Metal"),
        ("metal", "Metal"),
        ("heavy metal", "Heavy Metal"),
        ("POP", "Pop"),
        ("80s", "80s"),
    ],
)
def test_tag_spellings_are_unified(raw, expected):
    assert genres.normalise(raw) == expected


def test_a_source_states_its_genre_by_field_then_category_then_tag():
    assert genres.source_genre({"genre": "Drum & Bass"}) == "Drum & Bass"
    assert genres.source_genre({"genres": ["Neuro"]}) == "Neurofunk"
    assert genres.source_genre({"categories": ["Music"], "tags": ["live", "dnb"]}) == (
        "Drum & Bass"
    )
    assert genres.source_genre({"categories": ["Music"], "tags": ["live"]}) is None


LABELS = [
    "Electronic---Drum n Bass",
    "Electronic---Halftime",
    "Electronic---Dubstep",
    "Electronic---Jungle",
    "Electronic---Techno",
    "Electronic---Experimental",
    "Rock---Punk",
    "Non-Music---Speech",
]


def _acts(**p: float) -> np.ndarray:
    return np.array([p.get(f"a{i}", 0.0) for i in range(len(LABELS))])


def test_styles_map_to_the_apps_genres():
    assert genres.style_genre("Electronic---Drum n Bass") == "Drum & Bass"
    assert genres.style_genre("Electronic---Halftime") == "Drum & Bass"
    assert genres.style_genre("Electronic---Jungle") == "Jungle"
    assert genres.style_genre("Electronic---Deep House") == "House"
    assert genres.style_genre("Electronic---Glitch") == "Electronic"
    assert genres.style_genre("Hip Hop---Trap") == "Hip-hop"
    assert genres.style_genre("Non-Music---Speech") is None


def test_the_best_genre_wins_and_a_close_runner_up_trims_confidence():
    clear = genres.from_activations(_acts(a0=0.8, a2=0.1), LABELS)
    assert clear == {"genre": "Drum & Bass", "genreConf": 0.8}
    close = genres.from_activations(_acts(a0=0.5, a2=0.45), LABELS)
    assert close["genre"] == "Drum & Bass"
    assert close["genreConf"] < 0.5 * 0.9


def test_a_style_we_do_not_name_does_not_beat_a_real_genre():
    got = genres.from_activations(_acts(a5=0.5, a4=0.4), LABELS)
    assert got["genre"] == "Techno"


def test_drum_and_bass_is_refined_to_neurofunk_only():
    dnb = {"genre": "Drum & Bass", "genreConf": 0.6}
    assert genres.refine(dnb, "Neurofunk")["genre"] == "Neurofunk"
    assert genres.refine(dnb, "Liquid Drum & Bass")["genre"] == "Drum & Bass"
    other = {"genre": "Dubstep", "genreConf": 0.6}
    assert genres.refine(other, "Neurofunk") == other


def test_mel_features_match_essentias_musicnn_input():
    t = np.arange(2048) / genres.RATE
    x = (0.5 * np.sin(2 * np.pi * 440 * t) + 0.2 * np.sin(2 * np.pi * 3000 * t)).astype(
        np.float32
    )
    m = genres.mel(x)
    assert m.shape == (7, genres.BANDS)
    # Frame 3 as Essentia's TensorflowInputMusiCNN computes it, at bands 12-14 and 65-66.
    assert m[3, 12:15] == pytest.approx([5.38, 6.089, 5.675], abs=0.01)
    assert m[3, 65:67] == pytest.approx([4.784, 4.615], abs=0.01)
    assert m[3, 40] == pytest.approx(0, abs=0.01)


def test_a_patch_is_128_frames_and_short_audio_is_padded():
    assert genres.patches(np.zeros(genres.PATCH_SAMPLES * 2, np.float32)).shape == (
        128,
        96,
    )
    assert genres.patches(np.zeros(5000, np.float32)).shape == (128, 96)


class FakeSession:
    """Answers like the Discogs model: 400 activations, a Drum n Bass one high."""

    def __init__(self):
        self.batches: list[np.ndarray] = []

    def get_inputs(self):
        return [type("I", (), {"name": "melspectrogram"})()]

    def run(self, _outputs, feed):
        batch = feed["melspectrogram"]
        self.batches.append(batch)
        out = np.zeros((len(batch), len(LABELS)), np.float32)
        out[:, 0] = 0.7
        return [out]


@pytest.fixture()
def fake_model(monkeypatch):
    sess = FakeSession()
    monkeypatch.setattr(genres, "_session", sess)
    monkeypatch.setattr(genres, "_labels", LABELS)
    monkeypatch.setattr(genres, "model_enabled", lambda: True)
    rng = np.random.default_rng(0)
    monkeypatch.setattr(
        genres,
        "_window",
        lambda _path, _start: (0.3 * rng.standard_normal(33024)).astype(np.float32),
    )
    return sess


def test_the_model_path_runs_eight_windows_in_one_batch(fake_model):
    got = genres.classify("any.flac", 240.0)
    assert got["genre"] == "Drum & Bass"
    assert fake_model.batches[0].shape == (genres.WINDOWS, 128, 96)


def test_silent_windows_are_left_out(fake_model, monkeypatch):
    loud = iter([True, False] * 4)
    monkeypatch.setattr(
        genres,
        "_window",
        lambda *_: np.full(33024, 0.3 if next(loud) else 0.0, np.float32),
    )
    genres.classify("any.flac", 240.0)
    assert len(fake_model.batches[0]) == 4


RULES = {
    "genre": "Neurofunk",
    "genreConf": 0.55,
    "genreSource": "rules",
    "v2": 1,
}


def test_priority_is_tag_then_model_then_rules(fake_model):
    tagged = genres.decide(RULES, "x", 240.0, "Techno")
    assert (tagged["genre"], tagged["genreConf"], tagged["genreSource"]) == (
        "Techno",
        1.0,
        "tag",
    )
    online = genres.decide(RULES, "x", 240.0, "Dubstep", "source")
    assert online["genreSource"] == "source"
    modelled = genres.decide(RULES, "x", 240.0, None)
    # The model says Drum & Bass; the rules' Neurofunk refines it.
    assert (modelled["genre"], modelled["genreSource"]) == ("Neurofunk", "model")
    assert modelled["genreV"] == genres.VERSION


def test_without_the_model_the_rules_stay_and_the_decision_is_provisional(monkeypatch):
    monkeypatch.setattr(genres, "model_enabled", lambda: False)
    got = genres.decide(RULES, "x", 240.0, None)
    assert (got["genre"], got["genreSource"], got["genreV"]) == (
        "Neurofunk",
        "rules",
        0,
    )


def test_an_unavailable_model_falls_back_to_the_rules(monkeypatch):
    monkeypatch.setattr(genres, "model_enabled", lambda: True)
    monkeypatch.setattr(genres, "_session", None)
    monkeypatch.setattr(genres, "_get_session", lambda: None)
    got = genres.decide(RULES, "x", 240.0, None)
    assert (got["genre"], got["genreSource"], got["genreV"]) == (
        "Neurofunk",
        "rules",
        0,
    )


def test_a_redecision_keeps_the_rules_for_refining(fake_model):
    first = genres.decide(RULES, "x", 240.0, None)
    again = genres.decide(first, "x", 240.0, None)
    assert again["genre"] == "Neurofunk"


def test_status_says_where_the_genres_come_from(monkeypatch):
    monkeypatch.setattr(genres, "model_enabled", lambda: False)
    assert genres.status()["genre"] == "rules"
    monkeypatch.setattr(genres, "model_enabled", lambda: True)
    for step, shown in (
        ("ready", "model"),
        ("runtime", "installing"),
        ("failed", "unavailable"),
    ):
        monkeypatch.setitem(genres._state, "step", step)
        assert genres.status()["genre"] == shown


def test_the_model_is_fetched_once_and_checked(tmp_path, monkeypatch):
    monkeypatch.setattr(genres, "config_dir", lambda: tmp_path)
    blob = b"model"
    entry = ("m.onnx", __import__("hashlib").sha256(blob).hexdigest())
    calls: list[str] = []

    def fake_download(url, to, state=None):
        calls.append(url)
        to.write_bytes(blob)

    monkeypatch.setattr(interpolate, "_download", fake_download)
    out = genres._fetch(entry)
    assert out == tmp_path / "models" / "genre" / "m.onnx"
    assert genres._fetch(entry) == out
    assert len(calls) == 1
    # A file that is not the pinned one is refused and nothing is kept.
    bad = ("n.onnx", "0" * 64)
    assert genres._fetch(bad) is None
    assert not (tmp_path / "models" / "genre" / "n.onnx").exists()
    assert genres._state["error"]


# --- the shared ONNX Runtime ------------------------------------------------ #


@pytest.fixture()
def no_ort(tmp_path: Path, monkeypatch):
    """onnxruntime importable only from an installed runtime folder; uv on the path."""
    monkeypatch.setattr(interpolate, "config_dir", lambda: tmp_path / "cfg")
    monkeypatch.setattr(sys, "path", list(sys.path))
    on_path = lambda: any(  # noqa: E731
        p.startswith(str(tmp_path / "cfg" / "runtime")) for p in sys.path
    )
    monkeypatch.setattr(interpolate, "_ort_importable", on_path)
    monkeypatch.setattr(interpolate, "_importable", on_path)
    monkeypatch.setattr(interpolate.shutil, "which", lambda name: "/usr/bin/uv")
    monkeypatch.setattr(interpolate, "_nvidia", lambda: True)


def _fake_install(commands):
    def run(command, **_kw):
        commands.append(command)
        Path(command[command.index("--target") + 1]).mkdir(parents=True)
        return subprocess.CompletedProcess(command, 0, "", "")

    return run


def test_the_plain_runtime_is_installed_when_none_is_there(no_ort, monkeypatch):
    commands: list[list[str]] = []
    monkeypatch.setattr(interpolate.subprocess, "run", _fake_install(commands))
    state = {"step": "idle", "progress": None, "error": None}
    ai = dict(interpolate._setup)

    assert interpolate.ensure_runtime(state, shared=True)

    # An NVIDIA GPU is here, yet genre installs only the plain CPU flavour.
    assert len(commands) == 1
    assert not any("nvidia" in c or "[cuda" in c for c in commands[0])
    assert (interpolate.runtime_dir() / ".complete").is_file()
    assert not interpolate.runtime_dir("-nvidia").exists()
    assert interpolate._setup == ai


def test_an_installed_flavour_is_reused_even_the_nvidia_one(no_ort, monkeypatch):
    nvidia = interpolate.runtime_dir("-nvidia")
    nvidia.mkdir(parents=True)
    (nvidia / ".complete").write_text("x")
    monkeypatch.setattr(
        interpolate.subprocess, "run", lambda *a, **k: pytest.fail("installed")
    )
    assert interpolate.ensure_runtime({}, shared=True)
    assert str(nvidia) in sys.path


def test_a_genre_install_failure_stays_out_of_the_ai_setup(no_ort, monkeypatch):
    monkeypatch.setattr(
        interpolate.subprocess,
        "run",
        lambda c, **k: subprocess.CompletedProcess(c, 1, "", "no network"),
    )
    state: dict = {"step": "idle", "progress": None, "error": None}
    before = dict(interpolate._setup)
    assert not interpolate.ensure_runtime(state, shared=True)
    assert "no network" in state["error"]
    assert interpolate._setup == before


def test_an_already_importable_runtime_needs_no_install(monkeypatch):
    monkeypatch.setattr(interpolate, "_ort_importable", lambda: True)
    monkeypatch.setattr(
        interpolate.subprocess, "run", lambda *a, **k: pytest.fail("installed")
    )
    assert interpolate.ensure_runtime({}, shared=True)
