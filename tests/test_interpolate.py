"""Which frames AI draws, and where, when the frame rate goes up.

The model itself is faked: what matters here is the timing — which output
frames are the source's own, which are drawn and at what point between two —
and that a cut is never drawn across.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import httpx
import numpy as np
import pytest

from sestudio import downloaded, interpolate


def _frames(values: list[int]) -> list[np.ndarray]:
    return [np.full((4, 4, 3), v, dtype=np.uint8) for v in values]


@pytest.fixture()
def drawn(monkeypatch) -> list[tuple[int, int, float]]:
    """Each call to the model, as (left value, right value, time point)."""
    calls: list[tuple[int, int, float]] = []

    def fake(a, b, t):
        calls.append((int(a[0, 0, 0]), int(b[0, 0, 0]), round(t, 3)))
        return np.full_like(a, 255)

    monkeypatch.setattr(interpolate, "interpolate", fake)
    return calls


def test_doubling_draws_one_frame_halfway_between_each_pair(drawn):
    out = list(interpolate.frames_at(iter(_frames([10, 20, 30])), 24, 48, 4))

    assert [int(f[0, 0, 0]) for f in out] == [10, 255, 20, 255]
    assert drawn == [(10, 20, 0.5), (20, 30, 0.5)]


def test_24_to_60_draws_at_two_fifths_steps(drawn):
    out = list(interpolate.frames_at(iter(_frames([0, 10, 20, 30])), 24, 60, 5))

    assert len(out) == 5
    # Output k sits at k * 24/60 = 0.4 k on the source's clock.
    assert drawn == [(0, 10, 0.4), (0, 10, 0.8), (10, 20, 0.2), (10, 20, 0.6)]


def test_a_cut_repeats_the_frame_before_it_instead_of_a_ghost(drawn):
    out = list(interpolate.frames_at(iter(_frames([0, 200])), 24, 48, 2))

    assert [int(f[0, 0, 0]) for f in out] == [0, 0]
    assert drawn == []


def test_the_last_frame_repeats_when_the_source_runs_out(drawn):
    out = list(interpolate.frames_at(iter(_frames([10, 20])), 24, 48, 4))

    assert [int(f[0, 0, 0]) for f in out] == [10, 255, 20, 20]


def test_output_ends_with_the_source_however_many_were_asked_for(drawn):
    """A TV stream asks for frames without end; it must still finish."""
    out = list(interpolate.frames_at(iter(_frames([10, 20])), 24, 48, 10**9))

    assert len(out) == 4


def test_a_higher_rate_segment_is_decoded_drawn_and_encoded(
    tmp_path: Path, monkeypatch
):
    file = tmp_path / "film.mkv"
    file.write_bytes(b"x")
    tracks = downloaded.MediaTracks(
        audio=[], subtitles=[], video_width=1920, video_height=1080, video_fps=24.0
    )
    monkeypatch.setattr(downloaded, "tracks_of", lambda _f: tracks)
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 600.0)
    monkeypatch.setattr(downloaded, "_hls_dir", lambda: tmp_path / "hls")
    monkeypatch.setattr(downloaded, "ffmpeg_binary", lambda: "ffmpeg")
    monkeypatch.setattr(downloaded, "h264_encoder", lambda: "libx264")
    seen: dict = {}

    def fake_pipeline(decode, encode, width, height, src_fps, out_fps, count, timeout):
        seen.update(decode=decode, encode=encode, size=(width, height), count=count)
        Path(encode[-1]).write_bytes(b"segment")
        return True

    monkeypatch.setattr(interpolate, "run_pipeline", fake_pipeline)
    monkeypatch.setattr(interpolate, "status", lambda: {"gpu": True})
    monkeypatch.setattr(
        downloaded.subprocess, "run", lambda *a, **k: pytest.fail("plain encode")
    )

    assert downloaded.hls_segment(file, "film.mkv", 2, audio=1, rung=720, fps=60)

    decode, encode = seen["decode"], seen["encode"]
    # Scaled before drawing: a lighter rung is cheaper to interpolate.
    assert seen["size"] == (1280, 720)
    assert "scale=1280:720,format=rgb24" in decode
    # Two frames past the end, so the last ones have a right-hand side.
    assert decode[decode.index("-t") + 1] == f"{6 + 2 / 24:.3f}"
    assert seen["count"] == 360
    assert encode[encode.index("-r") + 1] == "60"
    # The chosen audio track, from the source read a second time.
    assert "1:a:1?" in encode
    # Priced up for the extra frames: 2500k at sqrt(60/24).
    assert encode[encode.index("-maxrate") + 1] == "3952k"


def test_without_a_gpu_the_source_rate_is_sent(tmp_path: Path, monkeypatch):
    """A rate saved on another machine must not set the CPU drawing frames it
    cannot keep up with."""
    file = tmp_path / "film.mkv"
    file.write_bytes(b"x")
    tracks = downloaded.MediaTracks(
        audio=[], subtitles=[], video_width=1920, video_height=1080, video_fps=24.0
    )
    monkeypatch.setattr(downloaded, "tracks_of", lambda _f: tracks)
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 600.0)
    monkeypatch.setattr(downloaded, "_hls_dir", lambda: tmp_path / "hls")
    monkeypatch.setattr(downloaded, "ffmpeg_binary", lambda: "ffmpeg")
    monkeypatch.setattr(downloaded, "h264_encoder", lambda: "libx264")
    monkeypatch.setattr(interpolate, "status", lambda: {"gpu": False})
    monkeypatch.setattr(
        interpolate, "run_pipeline", lambda *a, **k: pytest.fail("drew on the CPU")
    )
    commands: list[list[str]] = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        Path(command[-1]).write_bytes(b"segment")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(downloaded.subprocess, "run", fake_run)

    assert downloaded.hls_segment(file, "film.mkv", 2, fps=60)
    assert "-vf" not in commands[0]


def test_a_lower_rate_only_drops_frames(tmp_path: Path, monkeypatch):
    file = tmp_path / "film.mkv"
    file.write_bytes(b"x")
    tracks = downloaded.MediaTracks(
        audio=[], subtitles=[], video_width=1920, video_height=1080, video_fps=60.0
    )
    monkeypatch.setattr(downloaded, "tracks_of", lambda _f: tracks)
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 600.0)
    monkeypatch.setattr(downloaded, "_hls_dir", lambda: tmp_path / "hls")
    monkeypatch.setattr(downloaded, "ffmpeg_binary", lambda: "ffmpeg")
    monkeypatch.setattr(downloaded, "h264_encoder", lambda: "libx264")
    monkeypatch.setattr(
        interpolate, "run_pipeline", lambda *a, **k: pytest.fail("drew frames")
    )
    commands: list[list[str]] = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        Path(command[-1]).write_bytes(b"segment")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(downloaded.subprocess, "run", fake_run)

    assert downloaded.hls_segment(file, "film.mkv", 2, fps=30)
    assert commands[0][commands[0].index("-vf") + 1] == "fps=30"


def test_the_model_is_fetched_once_and_unpacked_into_place(
    tmp_path: Path, monkeypatch, httpx_mock
):
    py7zr = pytest.importorskip("py7zr")
    member = tmp_path / "src" / "rife_v2" / "rife_v4.26.onnx"
    member.parent.mkdir(parents=True)
    member.write_bytes(b"onnx")
    archive = tmp_path / "m.7z"
    with py7zr.SevenZipFile(archive, "w") as z:
        z.write(member, "rife_v2/rife_v4.26.onnx")
    httpx_mock.add_response(url=interpolate.MODEL_URL, content=archive.read_bytes())
    monkeypatch.setattr(interpolate, "config_dir", lambda: tmp_path / "cfg")

    out = interpolate.ensure_model()

    assert out == tmp_path / "cfg" / "models" / "rife_v4.26.onnx"
    assert out.read_bytes() == b"onnx"
    # Nothing left behind but the model itself.
    assert [p.name for p in out.parent.iterdir()] == ["rife_v4.26.onnx"]
    # On disk now: no second download (httpx_mock fails on an unexpected one).
    assert interpolate.ensure_model() == out


def test_no_model_offline_means_no_interpolation(
    tmp_path: Path, monkeypatch, httpx_mock
):
    httpx_mock.add_exception(httpx.ConnectError("offline"), url=interpolate.MODEL_URL)
    monkeypatch.setattr(interpolate, "config_dir", lambda: tmp_path / "cfg")

    assert interpolate.ensure_model() is None
    assert not list((tmp_path / "cfg" / "models").iterdir())


def test_a_rate_is_sustained_when_drawing_it_fits_the_measured_speed(monkeypatch):
    monkeypatch.setattr(interpolate, "speed", lambda: 100.0)

    # 24 → 60 at 720p: 36 drawn a second, within 75% of 100.
    assert interpolate.sustains(60, 24, 1280, 720)
    # The same at 1080p costs 2.25 times as much: 81, past the budget.
    assert not interpolate.sustains(60, 24, 1920, 1080)
    # And nothing is sustained where nothing can be drawn.
    monkeypatch.setattr(interpolate, "speed", lambda: None)
    assert not interpolate.sustains(30, 24, 640, 360)


# --- the runtime, installed on first need ---------------------------------- #


@pytest.fixture()
def no_runtime(tmp_path: Path, monkeypatch):
    """ONNX Runtime importable only from its cache folder, as in a `uvx`
    environment; uv on the path."""
    monkeypatch.setattr(interpolate, "config_dir", lambda: tmp_path / "cfg")
    monkeypatch.setattr(interpolate.sys, "path", list(interpolate.sys.path))
    monkeypatch.setattr(
        interpolate,
        "_importable",
        lambda: str(interpolate.runtime_dir()) in interpolate.sys.path,
    )
    monkeypatch.setattr(interpolate.shutil, "which", lambda name: "/usr/bin/uv")
    monkeypatch.setattr(interpolate, "_nvidia", lambda: False)


def test_the_runtime_is_installed_once_into_the_config_dir(no_runtime, monkeypatch):
    import sysconfig

    commands: list[list[str]] = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        Path(command[command.index("--target") + 1]).mkdir(parents=True)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(interpolate.subprocess, "run", fake_run)

    assert interpolate.ensure_runtime()

    command = commands[0]
    # uv, as a uvx environment has no pip, for the interpreter running this.
    assert command[:3] == ["/usr/bin/uv", "pip", "install"]
    assert command[command.index("--python") + 1] == interpolate.sys.executable
    target = interpolate.runtime_dir()
    # One folder per Python and platform: the wheels differ between them.
    version = interpolate.sys.version_info
    assert target.name == f"py{version.major}{version.minor}-{sysconfig.get_platform()}"
    assert (target / ".complete").is_file()

    # A later launch starts without it on the path, and installs nothing.
    interpolate.sys.path.remove(str(target))
    monkeypatch.setattr(
        interpolate.subprocess, "run", lambda *a, **k: pytest.fail("reinstalled")
    )
    assert interpolate.ensure_runtime()
    assert len(commands) == 1


def test_a_failed_install_leaves_nothing_taken_for_finished(no_runtime, monkeypatch):
    def fake_run(command, **_kwargs):
        Path(command[command.index("--target") + 1]).mkdir(parents=True)
        return subprocess.CompletedProcess(command, 1, "", "no network")

    monkeypatch.setattr(interpolate.subprocess, "run", fake_run)

    assert not interpolate.ensure_runtime()
    runtime = interpolate.runtime_dir()
    assert not runtime.exists()
    assert not runtime.with_name(f"{runtime.name}.part").exists()


def test_status_never_waits_and_prepares_only_once(monkeypatch):
    started: list[bool] = []
    monkeypatch.setattr(interpolate, "_session_cache", [])
    monkeypatch.setattr(interpolate, "_prepared_at", [])
    monkeypatch.setattr(interpolate, "_prepare", lambda: started.append(True))

    first = interpolate.status()
    second = interpolate.status()

    assert first == second == {"available": False, "provider": None, "preparing": True}
    assert started == [True]


def test_the_wrapped_model_takes_and_gives_8_bit_frames():
    """The conversions run inside the model: frames in as they are decoded, the
    frame out as it is encoded — here around a stand-in that answers frame A."""
    pytest.importorskip("onnx")
    ort = pytest.importorskip("onnxruntime")
    from onnx import TensorProto
    from onnx import helper as h

    # input 1x7xHxW -> its first three channels, as RIFE's output is shaped.
    stand_in = h.make_model(
        h.make_graph(
            [h.make_node("Slice", ["input", "s", "e", "ax"], ["output"])],
            "stand_in",
            [h.make_tensor_value_info("input", TensorProto.FLOAT, [1, 7, "h", "w"])],
            [h.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, "h", "w"])],
            [
                h.make_tensor("s", TensorProto.INT64, [1], [0]),
                h.make_tensor("e", TensorProto.INT64, [1], [3]),
                h.make_tensor("ax", TensorProto.INT64, [1], [1]),
            ],
        ),
        opset_imports=[h.make_opsetid("", 16)],
        # RIFE's own: a newer default is more than onnxruntime reads.
        ir_version=8,
    )
    wrapped = interpolate.wrap(stand_in)
    session = ort.InferenceSession(
        wrapped.SerializeToString(), providers=["CPUExecutionProvider"]
    )
    rng = np.random.default_rng(3)
    a = rng.integers(0, 256, (5, 7, 3), dtype=np.uint8)
    b = rng.integers(0, 256, (5, 7, 3), dtype=np.uint8)

    (frame,) = session.run(None, {"a": a, "b": b, "t": np.array([0.4], np.float32)})

    assert frame.dtype == np.uint8 and frame.shape == (5, 7, 3)
    # Through 0..1 floats and back, unchanged.
    assert np.array_equal(frame, a)


def test_an_nvidia_gpu_gets_nvidia_s_runtime_first_and_the_plain_one_failing_that(
    no_runtime, monkeypatch
):
    monkeypatch.setattr(interpolate, "_nvidia", lambda: True)
    monkeypatch.setattr(interpolate.sys, "platform", "win32")
    tried: list[list[str]] = []

    def fake_run(command, **_kwargs):
        packages = command[command.index("--target") + 2 :]
        tried.append(packages)
        Path(command[command.index("--target") + 1]).mkdir(parents=True)
        failed = any(p.startswith("onnxruntime-gpu") for p in packages)
        return subprocess.CompletedProcess(command, 1 if failed else 0, "", "")

    monkeypatch.setattr(interpolate.subprocess, "run", fake_run)

    assert interpolate.ensure_runtime()

    assert tried[0][:2] == ["onnxruntime-gpu[cuda,cudnn]>=1.20", "tensorrt-cu12-libs"]
    assert tried[1][0] == "onnxruntime-directml>=1.20"
    # Kept apart, so the plain one installed after is never taken for NVIDIA's.
    assert not interpolate.runtime_dir("-nvidia").exists()
    assert (interpolate.runtime_dir() / ".complete").is_file()


def test_turned_off_it_is_never_available_and_fetches_nothing(tmp_path, monkeypatch):
    from sestudio.config import AppConfig, save_config

    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    save_config(AppConfig(frame_interpolation=False))
    started: list[bool] = []
    monkeypatch.setattr(interpolate, "_prepared_at", [])
    monkeypatch.setattr(interpolate, "_prepare", lambda: started.append(True))

    assert interpolate.status()["available"] is False
    assert interpolate.status()["disabled"] is True
    assert started == []


def test_the_setup_reports_ready_or_why_it_failed(monkeypatch):
    monkeypatch.setattr(interpolate, "_setup", dict(interpolate._setup, step="idle"))
    monkeypatch.setattr(interpolate, "speed", lambda: 42.0)
    interpolate._prepare()
    assert interpolate._setup["step"] == "ready"
    assert interpolate._setup["error"] is None

    def offline() -> None:
        interpolate._failed("Could not fetch the interpolation model", "no network")

    monkeypatch.setattr(interpolate, "speed", offline)
    interpolate._prepare()
    assert interpolate._setup["step"] == "failed"
    assert "no network" in interpolate._setup["error"]


def test_a_setup_already_running_is_not_started_twice(monkeypatch):
    monkeypatch.setattr(interpolate, "_setup", dict(interpolate._setup, step="model"))
    monkeypatch.setattr(interpolate, "speed", lambda: pytest.fail("started twice"))
    interpolate._prepare()
    assert interpolate._setup["step"] == "model"
