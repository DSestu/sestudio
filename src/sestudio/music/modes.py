"""Tonic and mode of a track (harmony master plan E0.1/E0.2), numpy only.

1. **Profile.** A 12-note profile from a fine spectrum (1.35 Hz bins): a median
   over time keeps held notes and drops drum hits, and only the peaks near each
   frame's loudest count, on their nearest semitone. S-KEY's own constant-Q
   spectrum is too coarse for this: on drum and bass every semitone got 5-12 %.
2. **Tonic.** S-KEY's probability mass per pitch class
   (:mod:`sestudio.music.keynet`, major and minor keys together), the bass
   profile (30-200 Hz) and the overall profile, weighted.
3. **Mode.** Of the 9 scales on that tonic (the 7 church modes, harmonic minor,
   Phrygian dominant), the one holding the largest share of the profile. The
   runner-up differs from it by a note or two; how much more the winner's own
   notes are played than the runner-up's is the confidence.

Picking the set first and the tonic inside it was tried and dropped: on the 46
neuro test tracks it read rare scales (Lydian #2, Altered bb7) on minor tracks.
The thresholds are uncalibrated until the lab gate (E0.1) has judged tracks by ear.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Final

import numpy as np

from sestudio.music import keynet

#: Bump to have every stored track's harmony read again.
VERSION: Final = 1
NAMES: Final = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
#: Steps from the tonic, brightest to darkest, then the two harmonic-minor modes.
SCALES: Final[dict[str, tuple[int, ...]]] = {
    "Lydian": (0, 2, 4, 6, 7, 9, 11),
    "Ionian": (0, 2, 4, 5, 7, 9, 11),
    "Mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "Dorian": (0, 2, 3, 5, 7, 9, 10),
    "Aeolian": (0, 2, 3, 5, 7, 8, 10),
    "Phrygian": (0, 1, 3, 5, 7, 8, 10),
    "Locrian": (0, 1, 3, 5, 6, 8, 10),
    "Harmonic minor": (0, 2, 3, 5, 7, 8, 11),
    "Phrygian dominant": (0, 1, 4, 5, 7, 8, 10),
}
#: Lydian +3 .. Locrian -3; the harmonic-minor modes are "exotic" and have none.
BRIGHTNESS: Final = {m: 3 - i for i, m in enumerate(list(SCALES)[:7])}
TONIC_WEIGHTS: Final = (0.5, 0.3, 0.2)  # S-KEY, bass, overall
FFT_N, FFT_HOP = 8192, 1024  # 1.35 Hz bins, ~10 frames/s at 11025 Hz
SUSTAIN_FRAMES: Final = 17  # ~1.6 s
PEAK_FLOOR: Final = 0.3  # about -10 dB under the frame's loudest peak
SILENT: Final = 0.01
BASS_HZ: Final = (30.0, 200.0)
#: Unsure under these (to calibrate with the lab tally): the winner's own notes'
#: share of the deciding notes, those notes' share of the profile, the tonic's
#: share of the top two.
UNSURE_CONTRAST: Final = 0.62
BARELY_PLAYED: Final = 0.04
UNSURE_TONIC_SHARE: Final = 0.55
#: Intro and outro: this share of the track, at most this many seconds.
EDGE_SHARE, EDGE_MAX_S = 0.2, 60.0
MIN_SAMPLES: Final = max(keynet.HOP * 128, FFT_N * 4)  # S-KEY's 128 frames, a few FFTs


@dataclass(frozen=True)
class Mode:
    """One reading of a passage."""

    tonic: str
    mode: str
    notes: list[str]
    brightness: int | None
    #: The winner's own notes' share of the notes it and the runner-up disagree on.
    contrast: float
    tonic_share: float
    unsure: bool
    #: The runner-up reading, worth offering when unsure.
    alt: str
    #: Why it is unsure, in words; empty when sure.
    reason: str

    @property
    def label(self) -> str:
        return f"{self.tonic} {self.mode}"


def _stft(x: np.ndarray, lo: float, hi: float) -> tuple[np.ndarray, np.ndarray]:
    """(bins, frames) magnitude between *lo* and *hi* Hz, and the bins' frequencies."""
    starts = np.arange(0, max(len(x) - FFT_N, 0) + 1, FFT_HOP)
    freqs = np.fft.rfftfreq(FFT_N, 1 / keynet.RATE)
    band = (freqs >= lo) & (freqs <= hi)
    win = np.hanning(FFT_N).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, FFT_N)[starts]
    mag = [
        np.abs(np.fft.rfft(frames[i : i + 256] * win, axis=1))[:, band]
        for i in range(0, len(frames), 256)
    ]
    return np.concatenate(mag).T.astype(np.float32), freqs[band]


def _sustained(mag: np.ndarray) -> np.ndarray:
    """Median over ``SUSTAIN_FRAMES`` in time: held notes stay, drum hits go."""
    k = SUSTAIN_FRAMES
    padded = np.pad(mag, ((0, 0), (k // 2, k // 2)), mode="edge")
    out = np.empty_like(mag)
    for i in range(0, mag.shape[1], 200):
        view = np.lib.stride_tricks.sliding_window_view(
            padded[:, i : i + 200 + k - 1], k, axis=1
        )
        out[:, i : i + 200] = np.median(view, axis=-1)
    return out


def profile(x: np.ndarray, lo: float = 50.0, hi: float = 2500.0) -> np.ndarray:
    """12-bin pitch-class profile (C = 0, sums to 1) of an 11025 Hz signal.

    Spectral peaks of the sustained part within ``PEAK_FLOOR`` of each frame's
    loudest, on their nearest semitone (cos² of the detuning); every frame
    louder than ``SILENT`` of the loud ones counts the same.
    """
    mag, freqs = _stft(x, lo, hi)
    if not mag.size:
        return np.full(12, 1 / 12)
    s = _sustained(mag)
    peak = np.zeros_like(s, bool)
    peak[1:-1] = (s[1:-1] > s[:-2]) & (s[1:-1] >= s[2:])
    s = np.where(peak & (s >= PEAK_FLOOR * s.max(0, keepdims=True)), s, 0)
    total = s.sum(0)
    s = s[:, total >= SILENT * np.percentile(total, 95)]
    s = s / np.maximum(s.sum(0, keepdims=True), 1e-12)
    midi = 69 + 12 * np.log2(freqs / 440)
    near = np.round(midi)
    weight = np.cos(np.pi * (midi - near)) ** 2
    out = np.bincount(near.astype(int) % 12, weights=s.sum(1) * weight, minlength=12)
    return out / max(float(out.sum()), 1e-12)


def skey_mass(p: np.ndarray) -> np.ndarray:
    """12-bin probability per tonic pitch class (C = 0) from S-KEY's 24 outputs."""
    out = np.zeros(12)
    for i, v in enumerate(p):
        out[(9 + i) % 12 if i < 12 else (11 + i) % 12] += v
    return out


def skey_label(p: np.ndarray) -> str:
    i = int(p.argmax())
    return f"{NAMES[(9 + i) % 12]} major" if i < 12 else f"{NAMES[(11 + i) % 12]} minor"


def pcs(tonic: int, mode: str) -> np.ndarray:
    return np.array([(tonic + s) % 12 for s in SCALES[mode]])


def _modes(tonic: int, prof: np.ndarray) -> list[str]:
    """The 9 scales on *tonic*, best fit first."""
    return sorted(SCALES, key=lambda m: -prof[pcs(tonic, m)].sum())


def _decide(
    tonic: int, best: str, other: str, prof: np.ndarray
) -> tuple[float, float, str]:
    """(contrast, deciding notes' share, their names) between two scales on *tonic*."""
    a, b = pcs(tonic, best), pcs(tonic, other)
    own, theirs = np.setdiff1d(a, b), np.setdiff1d(b, a)
    pa, pb = float(prof[own].sum()), float(prof[theirs].sum())
    names = ", ".join(NAMES[p] for p in (*own, *theirs))
    return pa / max(pa + pb, 1e-12), pa + pb, names


def read(x: np.ndarray, skey: np.ndarray) -> Mode:
    """Tonic and mode of an 11025 Hz passage, given S-KEY's 24 outputs for it."""
    prof, bass = profile(x), profile(x, *BASS_HZ)
    ws, wb, wo = TONIC_WEIGHTS
    t = ws * skey_mass(skey) + wb * bass + wo * prof
    first, second = (int(i) for i in np.argsort(-t)[:2])
    share = float(t[first] / (t[first] + t[second]))
    ranked = _modes(first, prof)
    best = ranked[0]
    contrast, played, deciding = _decide(first, best, ranked[1], prof)
    alt, reason = f"{NAMES[first]} {ranked[1]}", ""
    if share < UNSURE_TONIC_SHARE:
        alt = f"{NAMES[second]} {_modes(second, prof)[0]}"
        reason = f"{NAMES[first]} and {NAMES[second]} both sound like home"
    elif played < BARELY_PLAYED:
        reason = f"the notes that would decide ({deciding}) are barely played"
    elif contrast < UNSURE_CONTRAST:
        reason = f"the notes that would decide ({deciding}) are both played"
    return Mode(
        tonic=NAMES[first],
        mode=best,
        notes=[NAMES[p] for p in pcs(first, best)],
        brightness=BRIGHTNESS.get(best),
        contrast=round(contrast, 3),
        tonic_share=round(share, 3),
        unsure=bool(reason),
        alt=alt,
        reason=reason,
    )


def edges(samples: int) -> dict[str, slice]:
    """Sample slices of the whole track, its intro and its outro."""
    n = min(int(samples * EDGE_SHARE), int(EDGE_MAX_S * keynet.RATE))
    return {
        "track": slice(None),
        "intro": slice(0, n),
        "outro": slice(samples - n, None),
    }


def analyse(x: np.ndarray, skey: np.ndarray | None = None) -> dict[str, Any] | None:
    """Readings of an 11025 Hz signal for the whole track, intro and outro; None when too short.

    *skey* is S-KEY's answer for the whole of *x* when the caller already has it.
    """
    out: dict[str, Any] = {}
    for name, cut in edges(len(x)).items():
        part = x[cut]
        if len(part) < MIN_SAMPLES:
            continue
        p = skey if name == "track" and skey is not None else keynet.probs(part)
        if p is not None:
            m = read(part, p)
            out[name] = {**asdict(m), "label": m.label, "skey": skey_label(p)}
    return out or None


def valid(tonic: str, mode: str) -> bool:
    return tonic in NAMES and mode in SCALES


def served(
    harmony: dict[str, Any] | None, choice: dict[str, str] | None
) -> dict[str, Any] | None:
    """The stored readings with the user's settled tonic and mode on the whole track.

    The track's reading gets ``source`` (``detected`` or ``user``); a settled one
    is sure and keeps what was detected in ``detected``.
    """
    out = dict(harmony or {})
    track = {**out.get("track", {}), "source": "detected"} if "track" in out else None
    if choice and valid(choice["tonic"], choice["mode"]):
        tonic, mode = choice["tonic"], choice["mode"]
        was = f"{track['tonic']} {track['mode']}" if track else None
        track = {
            **(track or {}),
            "tonic": tonic,
            "mode": mode,
            "notes": [NAMES[p] for p in pcs(NAMES.index(tonic), mode)],
            "brightness": BRIGHTNESS.get(mode),
            "unsure": False,
            "reason": "",
            "source": "user",
            "detected": was,
        }
    if track is not None:
        out["track"] = track
    return out or None


def fields(x: np.ndarray, skey: np.ndarray | None = None) -> dict[str, Any]:
    """What a track's stored analysis gets: ``harmony`` (track, intro, outro) and ``modesV``.

    Each passage keeps tonic, mode, notes, brightness, contrast, tonic share,
    unsure, alt and reason; S-KEY's label is already the track's ``key``.
    """
    found = analyse(x, skey)
    out: dict[str, Any] = {"modesV": VERSION}
    if found:
        out["harmony"] = {
            k: {f: v for f, v in r.items() if f not in ("label", "skey")}
            for k, r in found.items()
        }
    return out
