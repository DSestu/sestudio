"""Raw analysis of one audio file: band and loudness envelopes, brightness, tempo.

A port of the prototype scripts in ``docs/proto/music`` (``prep_lib.py``,
``prep_bands8.py``, ``prep_bpm.py``). Everything returned is *raw*: the
library-wide normalisation (98th percentile per band, hue percentile) lives in
:mod:`sestudio.music.store`, so it can be redone without decoding again.
"""

from __future__ import annotations

import os

# numpy's FFT and dot products must not each fan out to every core while several
# files are analysed at once (the prototype stalled that way). Only effective
# when this runs before numpy's first import, hence above it.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import re  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
from collections.abc import Callable  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Any  # noqa: E402

import numpy as np  # noqa: E402

from sestudio.media import ffmpeg_binary  # noqa: E402
from sestudio.music import keynet, modes, profile  # noqa: E402

CENTERS = (60, 120, 250, 500, 1000, 2000, 4000)

# Tempo needs a few bars to mean anything; under this it is left unset.
MIN_TEMPO_SECONDS = 8

TEMPO_SR, HOP, FFT_N = 11025, 110.25, 1024  # 100 onset frames per second


@dataclass
class RawAnalysis:
    duration: float
    #: 8 rows, one value per 0.1 s, RMS on a 0..1 full-scale.
    bands: np.ndarray
    loudness: np.ndarray
    #: Zero-crossing rate: the brightness the hue is a percentile of.
    zcr: float
    bpm: float | None
    beat0: float | None
    bar0: float | None
    bpm_conf: float | None
    #: Key, genre, energy, structure (:mod:`sestudio.music.profile`).
    extra: dict[str, Any] = field(default_factory=dict)


def decode(path: str, rate: int, af: str | None = None) -> np.ndarray:
    """Mono signal of *path* at *rate* Hz as float32 in -1..1, optionally filtered."""
    cmd = [ffmpeg_binary(), "-v", "error", "-i", path, "-ac", "1", "-ar", str(rate)]
    if af:
        cmd += ["-af", af]
    return _s16(subprocess.run([*cmd, "-f", "s16le", "-"], capture_output=True).stdout)


def _s16(raw: bytes) -> np.ndarray:
    """Mono s16le bytes as float32 in -1..1."""
    return (
        np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32)
        / 32768
    )


def _rms(x: np.ndarray, stride: int, window: int) -> np.ndarray:
    """RMS per *window* samples, reading every *stride*-th (the prototype's cheap RMS)."""
    s = x[::stride].astype(np.float64) ** 2
    per = window // stride
    sums = np.add.reduceat(s, np.arange(0, len(s), per)) if len(s) else s
    counts = np.minimum(per, len(s) - np.arange(0, len(s), per))
    return np.sqrt(sums / np.maximum(counts, 1))


def _biquad_gain2(freqs: np.ndarray, rate: int) -> np.ndarray:
    """|H|² of the FILTERS biquads (ffmpeg's formulas: 1-octave bandpass at 0 dB peak, Q .707 highpass) at *freqs*."""
    rows = []
    for c in (*CENTERS, 7000):
        w0 = 2 * np.pi * c / rate
        if c == 7000:
            alpha = np.sin(w0) / (2 * 0.707)
            b = np.array(
                [(1 + np.cos(w0)) / 2, -(1 + np.cos(w0)), (1 + np.cos(w0)) / 2]
            )
        else:
            alpha = np.sin(w0) * np.sinh(np.log(2) / 2 * w0 / np.sin(w0))
            b = np.array([alpha, 0.0, -alpha])
        a = np.array([1 + alpha, -2 * np.cos(w0), 1 - alpha])
        z = np.exp(-1j * 2 * np.pi * freqs / rate)[:, None] ** np.arange(3)
        rows.append(np.abs((z @ b) / (z @ a)) ** 2)
    return np.stack(rows)


#: Seconds of audio per step of the band decode: how often the bands so far are reported.
BAND_STEP = 5


def _band_frames(x: np.ndarray, gain2: np.ndarray, win: int) -> np.ndarray:
    n = -(-len(x) // win)
    frames = np.zeros((n, win), np.float32)
    frames.reshape(-1)[: len(x)] = x
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    power[:, 1:-1] *= 2  # one-sided spectrum
    counts = np.minimum(win, len(x) - np.arange(n) * win)
    return np.sqrt((power @ gain2.T).T / win / np.maximum(counts, 1))


def _bands(
    path: str,
    on_bands: Callable[[np.ndarray, float], None] | None = None,
    also: dict[int, Path] | None = None,
) -> np.ndarray:
    """8 band RMS envelopes at 10 Hz from one decode: each 0.1 s frame's power spectrum weighted by the filters' |H|².

    Was 8 ffmpeg decodes, one per filter (about 5x slower); same filters, so the values match within a few percent.
    Read from ffmpeg as it decodes, ``BAND_STEP`` seconds at a time, and *on_bands* gets the envelopes so far after
    each, with the duration in the file's header (0 without one). The same decode writes the mono signal at each
    rate of *also* (rate -> file, s16le): one decode instead of one per rate.
    """
    win = 1600
    # shortcut: the filters ran at the source rate (usually 44.1 kHz) before the resample; this assumes 44.1 kHz.
    gain2 = _biquad_gain2(np.fft.rfftfreq(win, 1 / 16000), 44100)
    # Info level, so the header's duration is in the log before the first samples.
    cmd = [ffmpeg_binary(), "-hide_banner", "-nostats", "-i", path]
    for rate, out in (also or {}).items():
        cmd += ["-ac", "1", "-ar", str(rate), "-f", "s16le", str(out)]
    cmd += ["-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
    step = win * 10 * BAND_STEP * 2  # whole frames of s16le
    parts: list[np.ndarray] = []
    duration: float | None = None
    with (
        tempfile.TemporaryDirectory() as tmp,
        open(Path(tmp, "log"), "wb") as log,
        subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log) as proc,
    ):
        assert proc.stdout is not None
        while chunk := proc.stdout.read(step):
            parts.append(_band_frames(_s16(chunk), gain2, win))
            if on_bands:
                if duration is None:
                    duration = _header_duration(
                        Path(tmp, "log").read_text("utf-8", "replace")
                    )
                on_bands(np.concatenate(parts, axis=1), duration)
    return np.concatenate(parts, axis=1) if parts else np.zeros((8, 0))


def _header_duration(log: str) -> float:
    """Seconds in ffmpeg's ``Duration: 00:05:35.36`` line, 0 when the file has none."""
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", log)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0.0


def tempo(x: np.ndarray) -> tuple[float, float, float, float]:
    """(bpm, beat0, bar0, confidence) of a mono signal at ``TEMPO_SR``; see SPEC-music-player §6.12."""
    n = int((len(x) - FFT_N) / HOP)
    starts = (np.arange(n) * HOP).astype(int)[:, None]
    win = np.hanning(FFT_N)
    # In chunks: all frames at once took 550 MB (indices and samples) for a 5 min track.
    spec = np.concatenate(
        [
            np.abs(
                np.fft.rfft(x[starts[i : i + 2048] + np.arange(FFT_N)] * win, axis=1)
            )
            for i in range(0, n, 2048)
        ]
    )
    flux = np.maximum(0, np.diff(np.log1p(1000 * spec), axis=0))
    freqs = np.fft.rfftfreq(FFT_N, 1 / TEMPO_SR)
    kick = flux[:, (freqs > 30) & (freqs < 150)].sum(1)
    onset = flux.sum(1)
    onset = np.maximum(onset - np.convolve(onset, np.ones(50) / 50, "same"), 0)
    fps = TEMPO_SR / HOP

    # The comb only reads whole-frame lags: each lag's autocorrelation once, not per tempo.
    bpms = np.arange(70, 200.01, 0.1)
    lags = (np.arange(1, 9)[None, :] * (60 * fps / bpms)[:, None]).astype(int)
    ac = np.array(
        [np.dot(onset[: -lag - 1], onset[lag:-1]) for lag in range(lags.max() + 1)]
    )
    combs = ac[lags].sum(1) / lags.shape[1]
    score = [
        (s * np.exp(-0.5 * (np.log2(bpm / 140) / 0.6) ** 2), bpm)
        for s, bpm in zip(combs, bpms)
    ]
    score.sort(reverse=True)
    bpm = score[0][1]
    conf = score[0][0] / (np.mean([s for s, _ in score]) + 1e-9)

    # The coarse comb snaps to whole frames: sweep +-1.5 BPM with a sub-frame
    # pulse train over the whole track and keep the tempo that lines up best.
    t = np.arange(len(onset))

    def phases(b: float) -> tuple[np.ndarray, np.ndarray]:
        p = 60 * fps / b
        k = np.arange(int((len(onset) - p) / p))
        return np.arange(0, p, 0.5), k

    def fit(b: float) -> float:
        p = 60 * fps / b
        ph, k = phases(b)
        return np.interp(ph[:, None] + k * p, t, onset).sum(1).max()

    cands = np.arange(bpm - 1.5, bpm + 1.501, 0.02)
    bpm = float(cands[int(np.argmax([fit(b) for b in cands]))])
    p = 60 * fps / bpm
    ph, k = phases(bpm)
    beat0 = ph[int(np.argmax([np.interp(o + k * p, t, onset).sum() for o in ph]))] / fps
    # Downbeat: of the 4 beat phases, the one with the most kick, over whole bars.
    k4 = np.arange(len(k) // 4)
    kk = [
        np.interp((beat0 + (b + 4 * k4) * 60 / bpm) * fps, t, kick).sum()
        for b in range(4)
    ]
    bar0 = beat0 + int(np.argmax(kk)) * 60 / bpm
    return (
        round(bpm, 2),
        round(float(beat0), 3),
        round(float(bar0), 3),
        round(float(conf), 2),
    )


def analyse_file(
    path: str,
    on_bands: Callable[[np.ndarray, float], None] | None = None,
    on_tempo: Callable[[float | None, float | None], None] | None = None,
    on_notes: Callable[[list[np.ndarray]], None] | None = None,
) -> RawAnalysis:
    """Decode *path* a few times and measure it. Slow (seconds): run off the request path.

    The band envelopes come first, so *on_bands* (envelopes so far, duration) can show them
    while the tempo and the profile are still being measured; *on_tempo* (bpm, bar0, both
    None without a steady beat) gets the tempo before the key is measured, and
    *on_notes* the notes heard by each tenth of the track (:func:`modes.profile_steps`).
    """
    with tempfile.TemporaryDirectory() as tmp:
        also = {4000: Path(tmp, "low"), TEMPO_SR: Path(tmp, "tempo")}
        bands = _bands(path, on_bands, also)
        low, x = (
            _s16(f.read_bytes()) if f.exists() else _s16(b"") for f in also.values()
        )
    duration = len(low) / 4000
    if duration <= 0:
        raise ValueError("no audio decoded")
    i = np.arange(1, len(low), 7)
    zcr = float(np.sum((low[i - 1] < 0) != (low[i] < 0)) / max(len(low) / 7, 1))
    loud = _rms(low, 4, 400)
    bpm = beat0 = bar0 = conf = None
    if duration >= MIN_TEMPO_SECONDS:
        bpm, beat0, bar0, conf = tempo(x)
    if on_tempo:
        on_tempo(bpm, bar0)
    # The notes pass is the slow part of both; too short a signal has none (and fields skips it).
    notes = modes.notes(x) if len(x) >= modes.MIN_SAMPLES else None
    if on_notes and duration >= MIN_TEMPO_SECONDS:
        on_notes(modes.profile_steps(x, f=notes))
    extra = _profile(x, bands, loud, bpm, bar0, notes)
    return RawAnalysis(duration, bands, loud, zcr, bpm, beat0, bar0, conf, extra)


def _profile(
    x: np.ndarray,
    bands: np.ndarray,
    loud: np.ndarray,
    bpm: float | None,
    bar0: float | None,
    notes: modes.Frames = None,
) -> dict[str, Any]:
    """Key, energy, structure and genre, then tonic and mode, sharing S-KEY's pass (and *notes*)."""
    p = keynet.probs(x)
    key = None if p is None else keynet.top(p)
    return profile.profile(key, bands, loud, bpm, bar0) | modes.fields(x, p, notes)


def upgrade(path: str, a: RawAnalysis) -> dict[str, Any]:
    """v2 profile of an already analysed file from its stored v1 row: one decode, for the key."""
    return _profile(decode(path, TEMPO_SR), a.bands, a.loudness, a.bpm, a.bar0)


def harmony(path: str) -> dict[str, Any]:
    """Tonic and mode of an already profiled file (:func:`sestudio.music.modes.fields`)."""
    return modes.fields(decode(path, keynet.RATE))
