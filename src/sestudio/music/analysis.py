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

import subprocess  # noqa: E402
from collections.abc import Callable  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402
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
    raw = subprocess.run([*cmd, "-f", "s16le", "-"], capture_output=True).stdout
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
    path: str, on_bands: Callable[[np.ndarray], None] | None = None
) -> np.ndarray:
    """8 band RMS envelopes at 10 Hz from one decode: each 0.1 s frame's power spectrum weighted by the filters' |H|².

    Was 8 ffmpeg decodes, one per filter (about 5x slower); same filters, so the values match within a few percent.
    Read from ffmpeg as it decodes, ``BAND_STEP`` seconds at a time, and *on_bands* gets the envelopes so far after each.
    """
    win = 1600
    # shortcut: the filters ran at the source rate (usually 44.1 kHz) before the resample; this assumes 44.1 kHz.
    gain2 = _biquad_gain2(np.fft.rfftfreq(win, 1 / 16000), 44100)
    cmd = [ffmpeg_binary(), "-v", "error", "-i", path, "-ac", "1", "-ar", "16000"]
    step = win * 10 * BAND_STEP * 2  # whole frames of s16le
    parts: list[np.ndarray] = []
    with subprocess.Popen(
        [*cmd, "-f", "s16le", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    ) as proc:
        assert proc.stdout is not None
        while chunk := proc.stdout.read(step):
            x = np.frombuffer(chunk[: len(chunk) // 2 * 2], np.int16)
            parts.append(_band_frames(x.astype(np.float32) / 32768, gain2, win))
            if on_bands:
                on_bands(np.concatenate(parts, axis=1))
    return np.concatenate(parts, axis=1) if parts else np.zeros((8, 0))


def tempo(x: np.ndarray) -> tuple[float, float, float, float]:
    """(bpm, beat0, bar0, confidence) of a mono signal at ``TEMPO_SR``; see SPEC-music-player §6.12."""
    n = int((len(x) - FFT_N) / HOP)
    idx = (np.arange(n) * HOP).astype(int)[:, None] + np.arange(FFT_N)[None, :]
    spec = np.abs(np.fft.rfft(x[idx] * np.hanning(FFT_N), axis=1))
    flux = np.maximum(0, np.diff(np.log1p(1000 * spec), axis=0))
    freqs = np.fft.rfftfreq(FFT_N, 1 / TEMPO_SR)
    kick = flux[:, (freqs > 30) & (freqs < 150)].sum(1)
    onset = flux.sum(1)
    onset = np.maximum(onset - np.convolve(onset, np.ones(50) / 50, "same"), 0)
    fps = TEMPO_SR / HOP

    score = []
    for bpm in np.arange(70, 200.01, 0.1):
        p = 60 * fps / bpm
        lags = np.arange(1, 9) * p
        s = sum(
            np.dot(onset[: -int(lag) - 1], onset[int(lag) : -1]) for lag in lags
        ) / len(lags)
        score.append((s * np.exp(-0.5 * (np.log2(bpm / 140) / 0.6) ** 2), bpm))
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
        return max(np.interp(o + k * p, t, onset).sum() for o in ph)

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
) -> RawAnalysis:
    """Decode *path* a few times and measure it. Slow (seconds): run off the request path.

    The band envelopes come first, so *on_bands* (envelopes so far, duration) can show them
    while the tempo and the profile are still being measured; *on_tempo* (bpm, bar0, both
    None without a steady beat) gets the tempo before the key is measured.
    """
    low = decode(path, 4000)
    duration = len(low) / 4000
    i = np.arange(1, len(low), 7)
    zcr = float(np.sum((low[i - 1] < 0) != (low[i] < 0)) / max(len(low) / 7, 1))
    if duration <= 0:
        raise ValueError("no audio decoded")
    bands = _bands(path, on_bands and (lambda b: on_bands(b, duration)))
    loud = _rms(low, 4, 400)
    bpm = beat0 = bar0 = conf = None
    x = decode(path, TEMPO_SR)
    if duration >= MIN_TEMPO_SECONDS:
        bpm, beat0, bar0, conf = tempo(x)
    if on_tempo:
        on_tempo(bpm, bar0)
    extra = _profile(x, bands, loud, bpm, bar0)
    return RawAnalysis(duration, bands, loud, zcr, bpm, beat0, bar0, conf, extra)


def _profile(
    x: np.ndarray,
    bands: np.ndarray,
    loud: np.ndarray,
    bpm: float | None,
    bar0: float | None,
) -> dict[str, Any]:
    """Key, energy, structure and genre, then tonic and mode, sharing S-KEY's pass."""
    p = keynet.probs(x)
    key = None if p is None else keynet.top(p)
    return profile.profile(key, bands, loud, bpm, bar0) | modes.fields(x, p)


def upgrade(path: str, a: RawAnalysis) -> dict[str, Any]:
    """v2 profile of an already analysed file from its stored v1 row: one decode, for the key."""
    return _profile(decode(path, TEMPO_SR), a.bands, a.loudness, a.bpm, a.bar0)


def harmony(path: str) -> dict[str, Any]:
    """Tonic and mode of an already profiled file (:func:`sestudio.music.modes.fields`)."""
    return modes.fields(decode(path, keynet.RATE))
