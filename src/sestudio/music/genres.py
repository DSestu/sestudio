"""Where a track's genre comes from (SPEC-music §9): tag, source, model, rules.

Priority, highest first: the user's own choice (``genre_override``, applied by
:mod:`sestudio.music.store`), the file's tag or the online source's genre
(confidence 1.0), Essentia's Discogs model run offline through ONNX Runtime,
and last the DSP rules of :mod:`sestudio.music.profile`.

The model is ``discogs-effnet-bsdynamic-1`` from https://essentia.upf.edu/models/
(18 MB, CC BY-NC-SA 4.0, so for non-commercial use only): its 400 sigmoid
outputs are Discogs styles. Essentia publishes the matching ``genre_discogs400``
head as TensorFlow only, but the extractor's own ``activations`` are the same
400 styles, so one ONNX file is enough. It lists no Neurofunk or Liquid Funk:
Drum & Bass is refined into Neurofunk by the rules; Liquid only comes from a tag.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from sestudio import interpolate
from sestudio.config import config_dir, load_config
from sestudio.media import ffmpeg_binary

logger = logging.getLogger(__name__)

#: Bump to have tracks decided again (tags and model) on the next pass.
VERSION = 1

_BASE = "https://essentia.upf.edu/models/feature-extractors/discogs-effnet/"
#: (file, sha256) of the model and of its label list.
MODEL_FILE = (
    "discogs-effnet-bsdynamic-1.onnx",
    "a280825b334797cf677939db8cd5762c0392aedd0ca6415dbc1cd083f045e43c",
)
LABELS_FILE = (
    "discogs-effnet-bsdynamic-1.json",
    "a2e85b2e7372d5f8e0f35bdd6aeae1139f101087d183d0b2fb60b0ea0f01a0ff",
)
SIZE_MB = 18

RATE = 16000
FRAME, HOP, BANDS, PATCH = 512, 256, 96, 128
#: Samples that make exactly one patch of PATCH frames.
PATCH_SAMPLES = (PATCH - 1) * HOP + FRAME
WINDOWS = 8
_SILENT = 1e-3
_RETRY_AFTER = 600.0

#: The model's own state, apart from the AI frames' (``interpolate._setup``).
_state: dict[str, Any] = {"step": "idle", "progress": None, "error": None}
_lock = threading.Lock()
_session: Any = None
_labels: list[str] = []
_failed_at = 0.0


# --- metadata -----------------------------------------------------------------

_ALIASES = {
    "Drum & Bass": "dnb drumnbass drumandbass drumbass drumnbassmusic dandb",
    "Neurofunk": "neuro neurofunk neurodnb neurodrumandbass neurodrumbass",
    "Liquid Drum & Bass": (
        "liquid liquidfunk liquiddnb liquiddrumandbass liquiddrumbass liquiddrumnbass"
    ),
    "Jungle": "jungle",
    "Dubstep": "dubstep brostep",
    "Techno": "techno",
    "House": "house",
    "Trance": "trance",
    "Hip-hop": "hiphop hiphoprap rap",
    "Electronic": "electronic electronica edm dance electronicdance",
    "Ambient": "ambient",
    "R&B": "rnb randb rhythmandblues",
}
_BY_KEY = {k: name for name, keys in _ALIASES.items() for k in keys.split()}
#: Tags that say nothing: a number is an ID3v1 index, the rest a placeholder.
_JUNK = {"other", "unknown", "genre", "none", "misc", "music", "various", "blank"}


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.casefold().replace("&", "and"))


def normalise(raw: str | None) -> str | None:
    """A genre tag in the app's spelling: known aliases are unified ("DnB",
    "drum & bass" -> "Drum & Bass"), others title-cased by :func:`spell`,
    placeholders give None. A tag listing several takes the first."""
    for part in re.split(r"[;/,|]", raw or ""):
        part = re.sub(r"^\(\d+\)", "", part).strip()
        key = _key(part)
        if not key or key.isdigit() or key in _JUNK:
            continue
        return spell(part)
    return None


def spell(genre: str) -> str:
    """One spelling per genre, so "METAL", "metal" and "Metal" group as one, and
    "heavy-metal", "Heavy_Metal" and "heavy metal" as "Heavy Metal": the app's own
    for a genre it knows, else words split by single spaces, each capitalised (capped)."""
    if name := _BY_KEY.get(_key(genre)):
        return name
    words = re.split(r"[\s_.-]+", genre.strip(" _.-").lower())
    return " ".join(w[:1].upper() + w[1:] for w in words)[:60]


def source_genre(info: dict[str, Any]) -> str | None:
    """The genre an online source states: yt-dlp's ``genre`` (SoundCloud,
    YouTube Music), else a category, else a tag that is a genre we know."""
    for field in ("genre", "genres"):
        value = info.get(field)
        for v in value if isinstance(value, list) else [value]:
            if g := normalise(v if isinstance(v, str) else None):
                return g
    for v in [*(info.get("categories") or []), *(info.get("tags") or [])]:
        if isinstance(v, str) and (g := _BY_KEY.get(_key(v))):
            return g
    return None


# --- styles -> the app's genres ----------------------------------------------

_ELECTRONIC = {
    "Drum & Bass": "Drum n Bass|Halftime",
    "Neurofunk": "Neurofunk",
    "Liquid Drum & Bass": "Liquid Funk",
    "Jungle": "Jungle",
    "Dubstep": "Dubstep",
    "Breakbeat": "Breakbeat|Breaks|Big Beat|Progressive Breaks|Broken Beat",
    "Techno": "Techno|Deep Techno|Hard Techno|Minimal Techno|Dub Techno|Schranz",
    "House": (
        "House|Deep House|Tech House|Progressive House|Electro House|Acid House"
        "|Garage House|Tribal House|Tropical House|Italo House|Euro House|Hard House"
    ),
    "Trance": (
        "Trance|Psy-Trance|Goa Trance|Hard Trance|Progressive Trance|Tech Trance"
    ),
    "Hardcore": "Hardcore|Gabber|Speedcore|Happy Hardcore|Makina|Hardstyle",
    "Garage": "UK Garage|Speed Garage",
    "Ambient": "Ambient|Dark Ambient|Drone|New Age",
    "Downtempo": "Downtempo|Trip Hop|Chillwave",
}
_PARENTS = {
    "Hip Hop": "Hip-hop", "Rock": "Rock", "Pop": "Pop", "Jazz": "Jazz",
    "Classical": "Classical", "Reggae": "Reggae", "Funk / Soul": "Funk / Soul",
    "Folk, World, & Country": "Folk", "Latin": "Latin", "Blues": "Blues",
}  # fmt: skip
# A tag naming one of the model's genres ("POP", "hip hop") takes its spelling.
for _name in [*_ELECTRONIC, *_PARENTS.values()]:
    _BY_KEY.setdefault(_key(_name), _name)
_STYLE = {
    f"Electronic---{s}": genre
    for genre, ss in _ELECTRONIC.items()
    for s in ss.split("|")
}


def style_genre(label: str) -> str | None:
    """The app's genre for a Discogs ``Parent---Style`` label (None: not music we name)."""
    if label in _STYLE:
        return _STYLE[label]
    parent = label.partition("---")[0]
    return "Electronic" if parent == "Electronic" else _PARENTS.get(parent)


def from_activations(acts: np.ndarray, labels: list[str]) -> dict[str, Any] | None:
    """The best app genre of 400 style probabilities (a genre scores its best
    style); confidence is that score, trimmed when the runner-up is close."""
    scores: dict[str, float] = {}
    for label, p in zip(labels, acts):
        if g := style_genre(label):
            scores[g] = max(scores.get(g, 0.0), float(p))
    if not scores:
        return None
    # A style we do not name (Experimental, Glitch...) must not beat a real genre.
    scores["Electronic"] = scores.get("Electronic", 0.0) * 0.6
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (name, top), second = ranked[0], (ranked[1][1] if len(ranked) > 1 else 0.0)
    conf = top * (0.7 + 0.3 * float(np.clip((top - second) / 0.3, 0, 1)))
    return {"genre": name, "genreConf": round(conf, 2)}


def refine(model: dict[str, Any], rules: str | None) -> dict[str, Any]:
    """The model names Drum & Bass; the rules may tell it is Neurofunk. Their
    "Liquid" is not taken: it labelled most neuro as liquid, and the model has
    no liquid signal to check it against."""
    if model["genre"] == "Drum & Bass" and rules == "Neurofunk":
        return {**model, "genre": rules}
    return model


# --- mel features: Essentia's TensorflowInputMusiCNN, in numpy -----------------


def _hz_to_mel(f: np.ndarray) -> np.ndarray:
    # Slaney: linear under 1 kHz, logarithmic above.
    f = np.asarray(f, dtype=np.float64)
    return np.where(
        f >= 1000,
        15 + np.log(np.maximum(f, 1) / 1000) / (np.log(6.4) / 27),
        f * 3 / 200,
    )


def _mel_to_hz(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float64)
    return np.where(m >= 15, 1000 * np.exp(np.log(6.4) / 27 * (m - 15)), m * 200 / 3)


def _filters() -> np.ndarray:
    freqs = np.arange(FRAME // 2 + 1) * RATE / FRAME
    edges = _mel_to_hz(np.linspace(_hz_to_mel(0), _hz_to_mel(RATE / 2), BANDS + 2))
    lo, mid, hi = edges[:-2, None], edges[1:-1, None], edges[2:, None]
    tri = np.maximum(
        0, np.minimum((freqs - lo) / (mid - lo), (hi - freqs) / (hi - mid))
    )
    return tri * (2 / (hi - lo))  # each band has unit area


_FILTERS = _filters()
_WINDOW = np.hanning(FRAME)  # symmetric, as Essentia's


def mel(x: np.ndarray) -> np.ndarray:
    """(frames, 96) ``log10(1 + 10000 * mel power)`` of mono 16 kHz audio:
    512-sample Hann frames every 256, Slaney mel bands to 8 kHz, the last frame
    zero-padded. Matches Essentia's TensorflowInputMusiCNN to ~1e-5."""
    n = max(int(np.ceil((len(x) - FRAME) / HOP)) + 1, 1)
    padded = np.zeros(FRAME + HOP * (n - 1), dtype=np.float32)
    padded[: len(x)] = x
    idx = np.arange(n)[:, None] * HOP + np.arange(FRAME)[None, :]
    power = np.abs(np.fft.rfft(padded[idx] * _WINDOW, axis=1)) ** 2
    return np.log10(1 + 10000 * (power @ _FILTERS.T)).astype(np.float32)


def patches(x: np.ndarray) -> np.ndarray:
    """One (128, 96) patch of mel frames from the start of *x*, zero-padded when short."""
    m = mel(x[:PATCH_SAMPLES])[:PATCH]
    return np.pad(m, ((0, PATCH - len(m)), (0, 0)))


# --- decoding and running -----------------------------------------------------


def _window(path: str, start: float) -> np.ndarray:
    cmd = [ffmpeg_binary(), "-v", "error", "-ss", f"{start:.2f}", "-i", path]
    cmd += ["-t", "2.2", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=False).stdout
    return (
        np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32)
        / 32768
    )


def audio_patches(
    path: str, duration: float, signal: np.ndarray | None = None
) -> np.ndarray:
    """WINDOWS patches spread over the middle 80 % of the track (silent ones dropped).

    Cut from *signal* (the whole track, mono at ``RATE``) when the caller has it:
    a decode per window was most of the time the model took.
    """
    span = PATCH_SAMPLES / RATE
    centres = duration * np.linspace(0.1, 0.9, WINDOWS)
    starts = np.clip(centres - span / 2, 0, max(duration - span, 0))

    def window(start: float) -> np.ndarray:
        if signal is None:
            return _window(path, start)
        i = int(round(start, 2) * RATE)  # _window seeks to 1/100 s
        return signal[i : i + int(2.2 * RATE)]

    out = [(x, patches(x)) for x in (window(float(s)) for s in starts) if len(x)]
    loud = [p for x, p in out if float(np.sqrt(np.mean(x**2))) > _SILENT]
    return np.stack(loud or [p for _, p in out]) if out else np.zeros((0, PATCH, BANDS))


def ready() -> bool:
    """Whether the model is loaded: :func:`decide` will not fetch or build it."""
    return _session is not None


def classify(
    path: str, duration: float, batch: np.ndarray | None = None
) -> dict[str, Any] | None:
    """The model's genre of an audio file (from its :func:`audio_patches` *batch*
    when the caller has them), or None when the model is not usable."""
    sess = _get_session()
    if sess is None:
        return None
    if batch is None:
        batch = audio_patches(path, duration)
    if not len(batch):
        return None
    name = sess.get_inputs()[0].name
    acts = sess.run(["activations"], {name: batch.astype(np.float32)})[0]
    return from_activations(acts.mean(0), _labels)


def _models_dir() -> Path:
    return config_dir() / "models" / "genre"


def _fetch(entry: tuple[str, str]) -> Path | None:
    name, digest = entry
    out = _models_dir() / name
    if out.is_file():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    part = out.with_name(name + ".part")
    try:
        interpolate._download(_BASE + name, part, _state)
        if hashlib.sha256(part.read_bytes()).hexdigest() != digest:
            raise ValueError(f"{name} is not the file this version expects")
        part.replace(out)
        return out
    except Exception as exc:  # noqa: BLE001 — offline, disk full, changed file
        interpolate._failed("Could not fetch the genre model", exc, _state)
        return None
    finally:
        part.unlink(missing_ok=True)


def _get_session() -> Any | None:
    """The model's ONNX Runtime session, built (and its files fetched) on first use.

    None, quietly, when it cannot be: the caller falls back to the rules, and a
    failure is not retried for ten minutes."""
    global _session, _labels, _failed_at
    if _session is not None:
        return _session
    with _lock:
        if _session is not None:
            return _session
        if _failed_at and time.monotonic() - _failed_at < _RETRY_AFTER:
            return None
        _state.update(step="starting", progress=None, error=None)
        try:
            if not interpolate.ensure_runtime(_state, shared=True):
                raise RuntimeError(_state["error"] or "ONNX Runtime is not available")
            model, labels = _fetch(MODEL_FILE), _fetch(LABELS_FILE)
            if model is None or labels is None:
                raise RuntimeError(_state["error"] or "model not available")
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            _session = ort.InferenceSession(
                str(model), opts, providers=["CPUExecutionProvider"]
            )
            _labels = json.loads(labels.read_text(encoding="utf-8"))["classes"]
            _state.update(step="ready", progress=None, error=None)
        except Exception as exc:  # noqa: BLE001 — any failure means "rules only"
            _failed_at = time.monotonic()
            _state.update(step="failed", error=_state["error"] or str(exc))
            logger.warning("Genre model unavailable: %s", exc)
            return None
        return _session


# --- the decision -------------------------------------------------------------


def model_enabled() -> bool:
    if os.environ.get("SESTUDIO_MUSIC_GENRE_MODEL", "1").strip().casefold() in (
        "0", "false", "no", "off",
    ):  # fmt: skip
        return False
    return load_config().music_genre_model


def status() -> dict[str, Any]:
    """``genre``: "model" (ready, or to be fetched), "installing", "unavailable"
    or "rules" (the setting is off)."""
    if not model_enabled():
        genre = "rules"
    elif _state["step"] in ("starting", "runtime", "model"):
        genre = "installing"
    elif _state["step"] == "failed":
        genre = "unavailable"
    else:
        genre = "model"
    return {
        "genre": genre,
        "genreProgress": _state["progress"],
        "genreError": _state["error"],
    }


def decide(
    extra: dict[str, Any],
    path: str,
    duration: float,
    tag: str | None,
    tag_source: str = "tag",
    patches: np.ndarray | None = None,
) -> dict[str, Any]:
    """*extra* (a v2 profile, rules genre included) with its genre chosen: tag
    or source, else the model, else what the rules said. ``genreV`` marks the
    decision as final; 0 means the model was wanted but could not run."""
    out = dict(extra)
    if out.get("genreSource", "rules") == "rules":
        out["genreRules"] = out.get("genre")
        out["genreRulesConf"] = out.get("genreConf")
    rules, rules_conf = out.get("genreRules"), out.get("genreRulesConf")
    out["genreV"] = VERSION
    if tag:
        out |= {"genre": tag, "genreConf": 1.0, "genreSource": tag_source}
        return out
    found = None
    if model_enabled():
        try:
            found = classify(path, duration, patches)
        except Exception:
            logger.warning("Genre model failed on %s", path, exc_info=True)
        if found is None:
            out["genreV"] = 0
    else:
        out["genreV"] = 0
    if found:
        out |= refine(found, rules) | {"genreSource": "model"}
    elif rules:
        out |= {"genre": rules, "genreConf": rules_conf, "genreSource": "rules"}
    return out
