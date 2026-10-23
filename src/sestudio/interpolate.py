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
frame out. Fetched once, on first use, into the config directory.
"""

from __future__ import annotations

import logging
import subprocess
import threading
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
    try:
        import onnxruntime as ort
    except ImportError:
        return None
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


def status() -> dict[str, Any]:
    """Whether interpolation can run here, and on what. Loads the model."""
    session = _session()
    if session is None:
        return {"available": False, "provider": None}
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
        if left is None:
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
