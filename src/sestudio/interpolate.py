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
import os
import shutil
import subprocess
import sys
import sysconfig
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx

from sestudio.config import config_dir, load_config

logger = logging.getLogger(__name__)

MODEL_URL = (
    "https://github.com/AmusementClub/vs-mlrt/releases/download/"
    "external-models/rife_v4.26.7z"
)
#: The member of that archive taken: the v2 export, which pads internally.
_MODEL_MEMBER = "rife_v2/rife_v4.26.onnx"

#: Providers tried in order; the first this onnxruntime build has wins.
_PROVIDERS = (
    "TensorrtExecutionProvider",
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

#: Where the first-use setup is, for the web UI: ``step`` is "idle" before it
#: ever ran, one of :data:`_BUSY` while it runs, then "ready" or "failed";
#: ``progress`` is 0..1 where a step can tell (the model download), else None.
_setup: dict[str, Any] = {"step": "idle", "progress": None, "error": None}
_BUSY = ("starting", "runtime", "model", "measure")


def _failed(what: str, exc: object) -> None:
    """Log a setup failure and keep it for the web UI."""
    logger.warning("%s: %s", what, exc)
    _setup["error"] = f"{what}: {exc}"


def runtime_dir(flavour: str = "") -> Path:
    """Where ONNX Runtime is installed: one folder per Python version and
    platform, as its wheels are built for each — a `uvx` on another Python
    gets its own rather than one that will not import — and per *flavour*
    (see :func:`_flavours`)."""
    tag = f"py{sys.version_info.major}{sys.version_info.minor}"
    return config_dir() / "runtime" / f"{tag}-{sysconfig.get_platform()}{flavour}"


def nvidia_smi() -> str | None:
    """`nvidia-smi`, which an NVIDIA driver installs, or None without one."""
    if found := shutil.which("nvidia-smi"):
        return found
    smi = Path(
        os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe"
    )
    return str(smi) if sys.platform == "win32" and smi.is_file() else None


def _nvidia() -> bool:
    """Whether an NVIDIA GPU is here."""
    return nvidia_smi() is not None


def _flavours() -> list[tuple[str, list[str]]]:
    """The runtimes to install, best first, as (folder suffix, packages).

    An NVIDIA GPU gets NVIDIA's own: TensorRT runs RIFE several times faster on
    it than DirectML does, at the price of a few gigabytes of CUDA, cuDNN and
    TensorRT libraries, fetched once. Everything else, and an NVIDIA install
    that fails, gets the plain one: DirectML on Windows reaches NVIDIA, AMD and
    Intel alike; the plain wheel carries CoreML on a Mac and the CPU on Linux.
    `onnx` builds the model's 8-bit wrapper; py7zr unpacks the model.
    """
    common = ["onnx>=1.16", "py7zr>=0.22"]
    plain = "onnxruntime-directml" if sys.platform == "win32" else "onnxruntime"
    flavours = [("", [f"{plain}>=1.20", *common])]
    if sys.platform in ("win32", "linux") and _nvidia():
        nvidia = ["onnxruntime-gpu[cuda,cudnn]>=1.20", "tensorrt-cu12-libs", *common]
        flavours.insert(0, ("-nvidia", nvidia))
    return flavours


def _importable() -> bool:
    try:
        import onnx  # noqa: F401
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
    for flavour, packages in _flavours():
        target = runtime_dir(flavour)
        if not (target / ".complete").is_file():
            _setup.update(step="runtime", progress=None)
            if not _install_runtime(target, packages):
                continue
        # Last, so the environment's own packages (numpy among them) still win.
        if str(target) not in sys.path:
            sys.path.append(str(target))
            importlib.invalidate_caches()
        if _importable():
            return True
        sys.path.remove(str(target))
    return False


def _install_runtime(target: Path, packages: list[str]) -> bool:
    """Install the runtime into *target*. With uv where it is on the path — a
    `uvx` environment has no pip — else with this interpreter's pip. Built
    beside *target* and moved in only once complete, so an interrupted install
    is never taken for a finished one."""
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
        _failed("Could not install the interpolation runtime", exc)
        return False
    if result.returncode != 0:
        _failed(
            "Could not install the interpolation runtime",
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
        _setup.update(step="model", progress=0.0)
        try:
            with httpx.stream("GET", MODEL_URL, follow_redirects=True, timeout=60) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length") or 0)
                with archive.open("wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)
                        if total:
                            _setup["progress"] = min(1.0, f.tell() / total)
            with py7zr.SevenZipFile(archive) as z:
                z.extract(path=out.parent, targets=[_MODEL_MEMBER])
            unpacked = out.parent / _MODEL_MEMBER
            unpacked.replace(out)
            unpacked.parent.rmdir()  # the archive's folder, now empty
            return out
        except Exception as exc:  # noqa: BLE001 — any failure means "not available"
            _failed("Could not fetch the interpolation model", exc)
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


def wrap(model: Any) -> Any:
    """RIFE taking two HxWx3 8-bit frames (``a``, ``b``) and a time point
    (``t``), giving the HxWx3 8-bit frame between (``frame``).

    The conversions either side of the model — to its 0..1 floats in channels
    first with the time as a seventh plane, and back — then run on the GPU with
    it. On the CPU they took twice as long as the model, and moving floats to
    the GPU and back is four times the bytes of the 8-bit frames.
    """
    from onnx import TensorProto, checker
    from onnx import helper as h

    graph = model.graph
    inner_in, inner_out = graph.input[0].name, graph.output[0].name

    def const(name: str, value: Any, dtype: int = TensorProto.FLOAT) -> Any:
        values = value if isinstance(value, list) else [value]
        return h.make_tensor(
            name, dtype, [len(values)] if isinstance(value, list) else [], values
        )

    before = [
        h.make_node("Cast", ["a"], ["w_af"], to=TensorProto.FLOAT),
        h.make_node("Cast", ["b"], ["w_bf"], to=TensorProto.FLOAT),
        h.make_node("Concat", ["w_af", "w_bf"], ["w_ab"], axis=2),
        h.make_node("Mul", ["w_ab", "w_in"], ["w_ab01"]),
        h.make_node("Shape", ["a"], ["w_shape"]),
        h.make_node("Slice", ["w_shape", "w_zero", "w_two"], ["w_hw"]),
        h.make_node("Concat", ["w_hw", "w_one"], ["w_hw1"], axis=0),
        h.make_node("Expand", ["t", "w_hw1"], ["w_plane"]),
        h.make_node("Concat", ["w_ab01", "w_plane"], ["w_hwc"], axis=2),
        h.make_node("Transpose", ["w_hwc"], ["w_chw"], perm=[2, 0, 1]),
        h.make_node("Unsqueeze", ["w_chw", "w_zero"], [inner_in]),
    ]
    after = [
        h.make_node("Squeeze", [inner_out, "w_zero"], ["w_y"]),
        h.make_node("Transpose", ["w_y"], ["w_yhwc"], perm=[1, 2, 0]),
        h.make_node("Mul", ["w_yhwc", "w_out"], ["w_y255"]),
        h.make_node("Add", ["w_y255", "w_half"], ["w_yr"]),
        h.make_node("Clip", ["w_yr", "w_lo", "w_hi"], ["w_yc"]),
        h.make_node("Cast", ["w_yc"], ["frame"], to=TensorProto.UINT8),
    ]
    nodes = [*before, *graph.node, *after]
    del graph.node[:]
    graph.node.extend(nodes)
    graph.initializer.extend(
        [
            const("w_in", 1 / 255),
            const("w_out", 255.0),
            const("w_half", 0.5),
            const("w_lo", 0.0),
            const("w_hi", 255.0),
            const("w_zero", [0], TensorProto.INT64),
            const("w_two", [2], TensorProto.INT64),
            const("w_one", [1], TensorProto.INT64),
        ]
    )
    frame = ["height", "width", 3]
    del graph.input[:]
    graph.input.extend(
        [
            h.make_tensor_value_info("a", TensorProto.UINT8, frame),
            h.make_tensor_value_info("b", TensorProto.UINT8, frame),
            h.make_tensor_value_info("t", TensorProto.FLOAT, [1]),
        ]
    )
    del graph.output[:]
    graph.output.extend([h.make_tensor_value_info("frame", TensorProto.UINT8, frame)])
    checker.check_model(model)
    return model


def _wrapped(model: Path) -> Path:
    """*model* wrapped (see :func:`wrap`), built beside it once."""
    import onnx

    out = model.with_name(f"{model.stem}_u8.onnx")
    if not out.is_file():
        building = out.with_suffix(".part")
        onnx.save(wrap(onnx.load(str(model))), str(building))
        building.replace(out)
    return out


#: TensorRT, in half precision: one engine for every frame size from 144p to
#: 4K, compiled once — minutes — and kept beside the model. The floor sits well
#: below 144x256: a 144p rung of a narrower picture (254 wide, or 192 at 4:3)
#: falls outside a 256-wide profile and TensorRT refuses it.
_TENSORRT_SHAPES = {
    "trt_profile_min_shapes": "a:64x64x3,b:64x64x3,t:1",
    "trt_profile_opt_shapes": "a:1080x1920x3,b:1080x1920x3,t:1",
    "trt_profile_max_shapes": "a:2160x5120x3,b:2160x5120x3,t:1",
}


def _new_session() -> Any | None:
    if not ensure_runtime():
        return None
    import onnxruntime as ort

    model = ensure_model()
    if model is None:
        return None
    # Building the session, then the first run (where TensorRT compiles its
    # engine — minutes, once) and the timing: one step to the user.
    _setup.update(step="measure", progress=None)
    available = set(ort.get_available_providers())
    chosen = [p for p in _PROVIDERS if p in available]
    if "CUDAExecutionProvider" in available and hasattr(ort, "preload_dlls"):
        # NVIDIA's libraries come as pip packages beside onnxruntime-gpu, which
        # Windows does not search for DLLs until told to.
        ort.preload_dlls()
    try:
        wrapped = _wrapped(model)
    except Exception as exc:  # noqa: BLE001 — onnx missing, or a model it rejects
        _failed("Interpolation unavailable", exc)
        return None
    providers: list[Any] = [
        (
            name,
            {
                "trt_fp16_enable": True,
                "trt_engine_cache_enable": True,
                "trt_engine_cache_path": str(model.parent / "tensorrt"),
                "trt_timing_cache_enable": True,
                **_TENSORRT_SHAPES,
            },
        )
        if name == "TensorrtExecutionProvider"
        else name
        for name in chosen
    ]
    options = ort.SessionOptions()
    if "DmlExecutionProvider" in chosen:
        # DirectML requires both off: it cannot reuse memory patterns across
        # the varying shapes, nor run nodes in parallel.
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    try:
        return ort.InferenceSession(str(wrapped), options, providers=providers)
    except Exception as exc:  # noqa: BLE001 — a provider that will not load
        _failed("Interpolation unavailable", exc)
        return None


#: When the background preparation last started, so a failed one (offline)
#: is tried again a while later rather than on every ask.
_prepared_at: list[float] = []
_prepare_lock = threading.Lock()
_RETRY_AFTER = 600.0


def _prepare() -> None:
    """Everything a first use needs: the runtime, the model, a session, and
    the speed this machine draws at. Once at a time."""
    with _setup_lock:
        if _setup["step"] in _BUSY:
            return
        _setup.update(step="starting", progress=None, error=None)
    try:
        ready = speed() is not None
    except Exception as exc:  # noqa: BLE001 — shown in the UI, not raised in a thread
        _failed("Interpolation setup failed", exc)
        ready = False
    _setup.update(step="ready" if ready else "failed", progress=None)


_setup_lock = threading.Lock()


def setup() -> None:
    """Run the setup again now, from scratch: the model, its TensorRT engine and
    the speed are fetched, built and measured anew. The runtime too, unless
    this process has already loaded it — its libraries are in use then (and
    locked on Windows), so it is kept until the next start."""
    if _setup["step"] in _BUSY:
        return
    _session_cache.clear()
    _speed.clear()
    if "onnxruntime" not in sys.modules:
        for folder in (config_dir() / "runtime").glob(f"{runtime_dir().name}*"):
            shutil.rmtree(folder, ignore_errors=True)
    shutil.rmtree(model_path().parent, ignore_errors=True)
    with _prepare_lock:
        _prepared_at[:] = [time.monotonic()]
    threading.Thread(target=_prepare, daemon=True).start()


def _gpu_name() -> str | None:
    """The NVIDIA GPU's name, as its driver reports it; None without one."""
    if not _nvidia():
        return None
    system = Path(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
    smi = shutil.which("nvidia-smi") or str(system / "nvidia-smi.exe")
    try:
        out = subprocess.run(
            [smi, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return out.splitlines()[0] if out else None


def info() -> dict[str, Any]:
    """Everything the settings page shows: whether it is on, where the setup
    is, and what it found. Never starts the setup."""
    session = _session_cache[0] if _session_cache else None
    ort = sys.modules.get("onnxruntime")
    return {
        "enabled": load_config().frame_interpolation,
        **_setup,
        "nvidia_gpu": _gpu_name(),
        "runtime": f"onnxruntime {ort.__version__}" if ort else None,
        "providers": session.get_providers() if session else [],
        "speed": _speed[0] if _speed else None,
    }


def status() -> dict[str, Any]:
    """Whether interpolation can run here, and on what. Never waits: until the
    runtime and model are on disk and measured, this starts fetching them in
    the background and answers "not available" — the frame rates drawn by AI
    are offered from the next ask once it is done. Turned off in the settings,
    it is never available and fetches nothing."""
    if not load_config().frame_interpolation:
        return {"available": False, "provider": None, "disabled": True}
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


# One model call at a time: DirectML takes the whole process down when two
# threads run the same session at once, and the server builds three segments
# in parallel. The GPU would run them one after another anyway; the CPU work
# around each call still overlaps another thread's.
_run_lock = threading.Lock()


def interpolate(a: Any, b: Any, t: float) -> Any:
    """The frame at *t* (0..1) between *a* and *b*, each HxWx3 uint8 RGB."""
    import numpy as np

    session = _session()
    assert session is not None, "interpolation is not available"
    feed = {"a": a, "b": b, "t": np.array([t], dtype=np.float32)}
    with _run_lock:
        return session.run(None, feed)[0]


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
            _speed.append(_measure())
    return _speed[0] if _speed else None


#: Segments drawn at once (routes/downloaded.py `DRAWN`): measured as they
#: run, one thread's CPU work overlapping another's turn on the GPU.
_BENCH_THREADS = 3


def _measure(pairs: int = 6) -> float:
    """Frames drawn a second by threads drawing at once, each between source
    frames of its own in turn — as a segment does, converting each once."""
    import numpy as np

    width, height = _BENCH_SIZE
    rng = np.random.default_rng(0)
    # Shape compiled for, outside the timing.
    warm = rng.integers(0, 255, (height, width, 3), dtype=np.uint8)
    interpolate(warm, warm, 0.5)

    def work(frames: list[Any]) -> None:
        for left, right in zip(frames, frames[1:]):
            interpolate(left, right, 0.5)

    # Made here: a generator is not to be shared between threads.
    sources = [
        [
            rng.integers(0, 255, (height, width, 3), dtype=np.uint8)
            for _ in range(pairs + 1)
        ]
        for _ in range(_BENCH_THREADS)
    ]
    threads = [threading.Thread(target=work, args=(f,)) for f in sources]
    start = time.perf_counter()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return _BENCH_THREADS * pairs / (time.perf_counter() - start)


def sustains(fps: float, source_fps: float, width: int, height: int) -> bool:
    """Whether drawing *source_fps* up to *fps* at *width* x *height* keeps up
    with playback here. Each second of video needs about *fps* − *source_fps*
    frames drawn, at a cost that grows with the picture's area."""
    drawn = speed()
    if drawn is None:
        return False
    area = (width * height) / (_BENCH_SIZE[0] * _BENCH_SIZE[1])
    return (fps - source_fps) * area <= drawn * _HEADROOM


_stop = threading.local()


def cancellable(stop: threading.Event, build: Callable[[], Any]) -> Any:
    """*build*, run with *stop* as its way out: None at once if *stop* is set
    before it starts, and any drawing it does ends at the next frame once
    *stop* is set. For a segment no player wants any more."""
    if stop.is_set():
        return None
    _stop.event = stop
    try:
        return build()
    finally:
        _stop.event = None


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
        stop = getattr(_stop, "event", None)
        for frame in frames_at(frames, src_fps, out_fps, count):
            if stop is not None and stop.is_set():
                return False
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
