"""Musical key with Deezer's S-KEY network (Kong et al., ICASSP 2025, MIT), in numpy.

A port of the inference path of https://github.com/deezer/skey: a constant-Q
transform (nnAudio's VQT: 99 semitones from A0, hop 512 at 22.05 kHz), then
ChromaNet (7 time-downsampling + ConvNeXt blocks, octave pooling, a 24-way
softmax). The weights in ``skey.npz`` are the published checkpoint's ChromaNet
tensors. The transform runs on the 11 kHz signal the analysis already decodes:
the top bin (3.5 kHz) is under its Nyquist, and the kernels are L1-normalised,
so magnitudes match the 22 kHz original.

GiantSteps key (604 EDM excerpts): 64.4 % exact, 80.5 % Camelot-compatible,
the same as the torch original; the network's output matches it to 1e-7.

S-KEY code and weights: Copyright (c) 2019-present, Deezer SA. MIT License
(https://github.com/deezer/skey/blob/main/LICENSE).
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

WEIGHTS = Path(__file__).with_name("skey.npz")
RATE, HOP = 11025, 256  # hop 512 at 22050 Hz
FMIN, BINS, KEEP = 27.5, 99, 84
Q = 1 / (2 ** (1 / 12) - 1)
CHUNK = 512  # frames per FFT batch: ~35 MB


@cache
def _kernels() -> tuple[int, list[tuple[int, np.ndarray]], np.ndarray]:
    """FFT size, per bin (first rfft bin, conj spectrum slice), and librosa's sqrt(length) scale."""
    freqs = FMIN * 2 ** (np.arange(BINS) / 12)
    lengths = np.ceil(Q * RATE / freqs).astype(int)
    n = int(2 ** np.ceil(np.log2(lengths.max())))
    out = []
    for f, ln in zip(freqs, lengths):
        k = np.zeros(n, complex)
        start = int(np.ceil(n / 2 - ln / 2)) - (ln % 2)
        t = np.arange(-(ln // 2), -(ln // 2) + ln)
        sig = np.hanning(ln + 1)[:-1] * np.exp(2j * np.pi * f * t / RATE)
        k[start : start + ln] = sig / np.abs(sig).sum()
        spec = np.fft.fft(k)[: n // 2 + 1]
        on = np.flatnonzero(np.abs(spec) >= 1e-3 * np.abs(spec).max())
        out.append((int(on[0]), np.conj(spec[on[0] : on[-1] + 1]) / n))
    # nnAudio scales by sqrt of the kernel length at 22.05 kHz
    return n, out, np.sqrt(np.ceil(Q * 22050 / freqs))


def vqt(x: np.ndarray) -> np.ndarray:
    """(84, frames) log-magnitude CQT of an 11025 Hz signal, scaled as S-KEY expects (0..1)."""
    n, kernels, scale = _kernels()
    x = x.astype(np.float64) / max(float(np.abs(x).max()), 1e-9)
    padded = np.pad(x, n // 2, mode="reflect")
    frames = sliding_window_view(padded, n)[::HOP]
    mag = np.empty((BINS, len(frames)))
    for i in range(0, len(frames), CHUNK):
        spec = np.fft.rfft(frames[i : i + CHUNK], axis=1)
        for b, (lo, k) in enumerate(kernels):
            mag[b, i : i + CHUNK] = np.abs(spec[:, lo : lo + len(k)] @ k)
    db = 10 * np.log10(np.maximum(mag * scale[:, None], 1e-10))
    db = np.maximum(db, db.max() - 80)
    return (db / 80 + 1)[:KEEP]


def _erf(x: np.ndarray) -> np.ndarray:
    """Abramowitz-Stegun 7.1.26 (error < 1.5e-7): numpy has no erf."""
    s, a = np.sign(x), np.abs(x)
    t = 1 / (1 + 0.3275911 * a)
    p = t * (
        0.254829592
        + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))
    )
    return s * (1 - p * np.exp(-a * a))


def _gelu(x: np.ndarray) -> np.ndarray:
    return 0.5 * x * (1 + _erf(x / np.sqrt(2)))


def _norm(x: np.ndarray) -> np.ndarray:
    """layer_norm over the whole (C, H, W) tensor, no affine."""
    return (x - x.mean()) / np.sqrt(x.var() + 1e-5)


@cache
def _weights() -> dict[str, np.ndarray]:
    with np.load(WEIGHTS) as w:
        return {k: w[k].astype(np.float64) for k in w.files}


def chromanet(spec: np.ndarray) -> np.ndarray:
    """24 probabilities, S-KEY order: A..G# major, then B..Bb minor."""
    w = _weights()
    x = spec[None]  # (C, H, W)
    for i in range(7):
        d, c = f"time_downsampling_blocks.{i}.conv.", f"convnext_blocks.{i}."
        x = _norm(x)
        x = x[:, :, : x.shape[2] // 2 * 2]
        x = np.einsum(
            "chwk,ock->ohw", x.reshape(*x.shape[:2], -1, 2), w[d + "weight"][:, :, 0]
        )
        x = _gelu(x + w[d + "bias"][:, None, None])
        k = w[c + "dwconv.weight"].shape[-1]
        y = np.pad(x, ((0, 0), (k // 2, k // 2), (k // 2, k // 2)), mode="edge")
        y = np.einsum(
            "chwij,cij->chw",
            sliding_window_view(y, (k, k), (1, 2)),
            w[c + "dwconv.weight"][:, 0],
        )
        y = _norm(y + w[c + "dwconv.bias"][:, None, None]).transpose(1, 2, 0)
        y = _gelu(y @ w[c + "pwconv1.weight"].T + w[c + "pwconv1.bias"])
        y = (y @ w[c + "pwconv2.weight"].T + w[c + "pwconv2.bias"]) * w[c + "gamma"]
        x = x + y.transpose(2, 0, 1)
    x = (
        x.reshape(x.shape[0], -1, 12, x.shape[2]).mean(1).mean(-1)
    )  # octave pool, then time
    x = w["classifier.weight"][:, :, 0, 0] @ x + w["classifier.bias"][:, None]
    x = (x - w["batch_norm.running_mean"][:, None]) / np.sqrt(
        w["batch_norm.running_var"][:, None] + 1e-5
    )
    e = np.exp(x.ravel() - x.max())
    return e / e.sum()


def probs(x: np.ndarray) -> np.ndarray | None:
    """S-KEY's 24 probabilities for an 11025 Hz signal; None when too short."""
    if len(x) < HOP * 128:  # seven halvings of the time axis need 128 frames
        return None
    return chromanet(vqt(x))


def key(x: np.ndarray) -> tuple[int, bool, float] | None:
    """(pitch class with C = 0, minor, probability) of an 11025 Hz signal; None when too short."""
    p = probs(x)
    return None if p is None else top(p)


def top(p: np.ndarray) -> tuple[int, bool, float]:
    """(pitch class with C = 0, minor, probability) of S-KEY's 24 probabilities."""
    i = int(p.argmax())
    return (
        ((9 + i) % 12, False, float(p[i]))
        if i < 12
        else ((11 + i - 12) % 12, True, float(p[i]))
    )
