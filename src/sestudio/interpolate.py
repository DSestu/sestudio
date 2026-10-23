"""Frame interpolation: more frames per second than the source has, made up by AI.

RIFE (Real-Time Intermediate Flow Estimation) draws the frame between two real
ones at any point in time. It runs through ONNX Runtime, which reaches the GPU
on every machine this serves from: DirectML on Windows (NVIDIA, AMD and Intel
alike), CoreML on a Mac, CUDA where onnxruntime-gpu is installed. Without a GPU
it falls back to the CPU, which is far too slow to keep up with playback — the
caller decides from :func:`status` whether to offer it at all.

The model is the RIFE v4.26 export vs-mlrt publishes, its "v2" form: one input
of seven channels (frame A as RGB, frame B as RGB, then a plane holding the time
point between them, all 0..1) at any size, padded inside the model, and one RGB
frame out.

Neither the model nor ONNX Runtime ships with sestudio: tens of megabytes most
installs never use. Both are fetched on first need into the config directory,
which outlives any `uvx` environment, and reused by every launch after. That
first fetch runs in the background (see :func:`status`), so nothing waits on it.
"""

from __future__ import annotations

import importlib
import logging
import shutil
import subprocess
import sys
import sysconfig
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx

from sestudio.config import config_dir

logger = logging.getLogger(__name__)

MODEL_URL = (
    "https://github.com/AmusementClub/vs-mlrt/releases/download/"
    "external-models/rife_v4.26.7z"
)
#: The member of that archive taken: the v2 export, which pads internally.
_MODEL_MEMBER = "rife_v2/rife_v4.26.onnx"

#: Providers tried in order; the first this onnxruntime build has wins.
_PROVIDERS = (
    "CUDAExecutionProvider",
    "DmlExecutionProvider",
    "CoreMLExecutionProvider",
    "ROCMExecutionProvider",
    "MIGraphXExecutionProvider",
    "OpenVINOExecutionProvider",
    "CPUExecutionProvider",
)

#: Mean absolute difference (0..255) between two frames past which they are
#: taken for a cut. RIFE across a cut draws a ghost of both shots, so the frames
#: in between repeat the earlier one instead.
_SCENE_CUT = 40.0

_model_lock = threading.Lock()


def runtime_dir() -> Path:
    """Where ONNX Runtime is installed: one folder per Python version and
    platform, as its wheels are built for each — a `uvx` on another Python
    gets its own rather than one that will not import."""
    tag = f"py{sys.version_info.major}{sys.version_info.minor}"
    return config_dir() / "runtime" / f"{tag}-{sysconfig.get_platform()}"


def _runtime_packages() -> list[str]:
    # DirectML on Windows reaches NVIDIA, AMD and Intel alike; the plain wheel
    # carries CoreML on a Mac, and only the CPU on Linux (onnxruntime-gpu,
    # installed beside sestudio, is picked up first there).
    ort = "onnxruntime-directml" if sys.platform == "win32" else "onnxruntime"
    return [f"{ort}>=1.20", "py7zr>=0.22"]


def _importable() -> bool:
    try:
        import onnxruntime  # noqa: F401
        import py7zr  # noqa: F401
    except ImportError:
        return False
    return True


def ensure_runtime() -> bool:
    """Whether ONNX Runtime imports, installed into :func:`runtime_dir` first
    if it is not already importable (it is in a dev checkout)."""
    if _importable():
        return True
    target = runtime_dir()
    if not (target / ".complete").is_file() and not _install_runtime(target):
        return False
    # Last, so the environment's own packages (numpy among them) still win.
    if str(target) not in sys.path:
        sys.path.append(str(target))
        importlib.invalidate_caches()
    return _importable()


def _install_runtime(target: Path) -> bool:
    """Install the runtime into *target*. With uv where it is on the path — a
    `uvx` environment has no pip — else with this interpreter's pip. Built
    beside *target* and moved in only once complete, so an interrupted install
    is never taken for a finished one."""
    packages = _runtime_packages()
    building = target.with_name(f"{target.name}.part")
    shutil.rmtree(building, ignore_errors=True)
    if uv := shutil.which("uv"):
        command = [uv, "pip", "install", "--quiet", "--python", sys.executable]
    else:
        command = [sys.executable, "-m", "pip", "install", "--quiet"]
    logger.info("Installing the frame interpolation runtime into %s", target)
    try:
        result = subprocess.run(
            [*command, "--target", str(building), *packages],
            timeout=900,
            check=False,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Could not install the interpolation runtime: %s", exc)
        return False
    if result.returncode != 0:
        logger.warning(
            "Could not install the interpolation runtime: %s",
            result.stderr.strip()[-500:],
        )
        shutil.rmtree(building, ignore_errors=True)
        return False
    (building / ".complete").write_text(" ".join(packages), encoding="utf-8")
    shutil.rmtree(target, ignore_errors=True)
    building.rename(target)
    return True


def model_path() -> Path:
    return config_dir() / "models" / "rife_v4.26.onnx"


def ensure_model() -> Path | None:
    """The model on disk, downloaded and unpacked first if it is not. None if
    that failed (offline, say), so the caller offers no interpolation."""
    out = model_path()
    if out.is_file():
        return out
    with _model_lock:
        if out.is_file():
            return out
        try:
            import py7zr
        except ImportError:
            return None
        out.parent.mkdir(parents=True, exist_ok=True)
        archive = out.with_suffix(".7z.part")
        try:
            with httpx.stream("GET", MODEL_URL, follow_redirects=True, timeout=60) as r:
                r.raise_for_status()
                with archive.open("wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)
            with py7zr.SevenZipFile(archive) as z:
                z.extract(path=out.parent, targets=[_MODEL_MEMBER])
            unpacked = out.parent / _MODEL_MEMBER
            unpacked.replace(out)
            unpacked.parent.rmdir()  # the archive's folder, now empty
            return out
        except Exception as exc:  # noqa: BLE001 — any failure means "not available"
            logger.warning("Could not fetch the interpolation model: %s", exc)
            return None
        finally:
            archive.unlink(missing_ok=True)


_session_cache: list[Any] = []
_session_lock = threading.Lock()


def _session() -> Any | None:
    """The ONNX Runtime session, on the best provider this machine has.

    Kept once made; a failure is not, so a model that could not be fetched
    offline is fetched on a later ask."""
    if _session_cache:
        return _session_cache[0]
    with _session_lock:
        if not _session_cache and (session := _new_session()) is not None:
            _session_cache.append(session)
    return _session_cache[0] if _session_cache else None


def _new_session() -> Any | None:
    if not ensure_runtime():
        return None
    import onnxruntime as ort

    model = ensure_model()
    if model is None:
        return None
    available = set(ort.get_available_providers())
    chosen = [p for p in _PROVIDERS if p in available]
    options = ort.SessionOptions()
    if "DmlExecutionProvider" in chosen:
        # DirectML requires both off: it cannot reuse memory patterns across
        # the varying shapes, nor run nodes in parallel.
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    try:
        return ort.InferenceSession(str(model), options, providers=chosen)
    except Exception as exc:  # noqa: BLE001 — a provider that will not load
        logger.warning("Interpolation unavailable: %s", exc)
        return None


#: When the background preparation last started, so a failed one (offline)
#: is tried again a while later rather than on every ask.
_prepared_at: list[float] = []
_prepare_lock = threading.Lock()
_RETRY_AFTER = 600.0


def _prepare() -> None:
    """Everything a first use needs: the runtime, the model, a session, and
    the speed this machine draws at."""
    speed()


def status() -> dict[str, Any]:
    """Whether interpolation can run here, and on what. Never waits: until the
    runtime and model are on disk and measured, this starts fetching them in
    the background and answers "not available" — the frame rates drawn by AI
    are offered from the next ask once it is done."""
    session = _session_cache[0] if _session_cache and _speed else None
    if session is None:
        with _prepare_lock:
            now = time.monotonic()
            if not _prepared_at or now - _prepared_at[0] > _RETRY_AFTER:
                _prepared_at[:] = [now]
                threading.Thread(target=_prepare, daemon=True).start()
        return {"available": False, "provider": None, "preparing": True}
    provider = session.get_providers()[0]
    return {
        "available": True,
        "provider": provider,
        "gpu": provider != "CPUExecutionProvider",
    }


def interpolate(a: Any, b: Any, t: float) -> Any:
    """The frame at *t* (0..1) between *a* and *b*, each HxWx3 uint8 RGB."""
    import numpy as np

    session = _session()
    assert session is not None, "interpolation is not available"
    pair = np.concatenate([a, b], axis=2).astype(np.float32) / 255.0
    plane = np.full((*a.shape[:2], 1), t, dtype=np.float32)
    x = np.concatenate([pair, plane], axis=2).transpose(2, 0, 1)[None]
    y = session.run(None, {session.get_inputs()[0].name: x})[0][0]
    return (y.transpose(1, 2, 0).clip(0, 1) * 255.0 + 0.5).astype(np.uint8)


def frames_at(
    source: Iterator[Any], src_fps: float, out_fps: float, count: int
) -> Iterator[Any]:
    """*count* frames at *out_fps* from *source* frames at *src_fps*.

    Each output frame sits at its own time on the source's clock; one that lands
    on a source frame is that frame, one between two is drawn by RIFE, and one
    across a cut repeats the frame before it. *source* must run at least one
    frame past the last output time, so the final in-between has its right side.
    """
    import numpy as np

    left = next(source, None)
    right = next(source, None)
    index = 0  # of *left* on the source's clock
    for k in range(count):
        position = k * src_fps / out_fps
        while right is not None and position >= index + 1:
            left, right, index = right, next(source, None), index + 1
        # Past the source's last frame: the end, however many were asked for.
        if left is None or (right is None and position >= index + 1):
            return
        t = position - index
        if t < 1e-3 or right is None:
            yield left
            continue
        cut = float(np.abs(left[::8, ::8].astype(np.int16) - right[::8, ::8]).mean())
        yield left if cut > _SCENE_CUT else interpolate(left, right, t)


def read_frames(stdout: Any, width: int, height: int) -> Iterator[Any]:
    """Raw RGB frames off an ffmpeg pipe, as HxWx3 uint8 arrays."""
    import numpy as np

    size = width * height * 3
    while True:
        raw = stdout.read(size)
        if len(raw) < size:
            return
        yield np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)


#: The frame drawing speed is measured at, and the share of it a rate may use.
_BENCH_SIZE = (1280, 720)
# shortcut: one flat 25% margin for decoding, encoding and the three segments
# built at once; measure the whole pipeline if offered rates still stutter.
_HEADROOM = 0.75

_speed: list[float] = []
_speed_lock = threading.Lock()


def speed() -> float | None:
    """In-between frames this machine draws a second at 720p; None when it
    cannot draw at all. Measured once, on first ask: the first run is not timed,
    as that is where a provider compiles for the shape."""
    if _speed:
        return _speed[0]
    with _speed_lock:
        if not _speed and _session() is not None:
            import numpy as np

            width, height = _BENCH_SIZE
            a = np.zeros((height, width, 3), dtype=np.uint8)
            b = np.full((height, width, 3), 255, dtype=np.uint8)
            interpolate(a, b, 0.5)
            runs, start = 5, time.perf_counter()
            for _ in range(runs):
                interpolate(a, b, 0.5)
            _speed.append(runs / (time.perf_counter() - start))
    return _speed[0] if _speed else None


def sustains(fps: float, source_fps: float, width: int, height: int) -> bool:
    """Whether drawing *source_fps* up to *fps* at *width* x *height* keeps up
    with playback here. Each second of video needs about *fps* − *source_fps*
    frames drawn, at a cost that grows with the picture's area."""
    drawn = speed()
    if drawn is None:
        return False
    area = (width * height) / (_BENCH_SIZE[0] * _BENCH_SIZE[1])
    return (fps - source_fps) * area <= drawn * _HEADROOM


def run_pipeline(
    decode: list[str],
    encode: list[str],
    width: int,
    height: int,
    src_fps: float,
    out_fps: float,
    count: int,
    timeout: float,
) -> bool:
    """Decode with one ffmpeg, interpolate, and feed another that encodes.

    True when the encoder finished cleanly. Both are killed past *timeout*, as
    a plain segment encode would be.
    """
    dec = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    enc = subprocess.Popen(encode, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    watchdog = threading.Timer(timeout, lambda: (dec.kill(), enc.kill()))
    watchdog.start()
    try:
        assert dec.stdout is not None and enc.stdin is not None
        frames = read_frames(dec.stdout, width, height)
        for frame in frames_at(frames, src_fps, out_fps, count):
            enc.stdin.write(frame.tobytes())
        enc.stdin.close()
        return enc.wait() == 0
    except (OSError, ValueError):  # a pipe closed by the watchdog or a crash
        return False
    finally:
        watchdog.cancel()
        dec.kill()
        dec.wait()
        if enc.poll() is None:
            enc.kill()
            enc.wait()
