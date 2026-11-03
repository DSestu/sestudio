"""Analysis v2 (SPEC-music §11, PR 20): key, energy, structure and genre.

DSP heuristics only, numpy only. Key comes from a chroma of the 11 kHz signal;
energy, structure and genre are derived from the v1 envelopes and tempo, so they
can be redone from the stored row without decoding. Known limits: SPEC-music §9.
"""

from __future__ import annotations

from typing import Any

import numpy as np

#: Bump to have every stored track re-profiled.
VERSION = 1

NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
# Krumhansl-Kessler key profiles (tonic first).
MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)

CHROMA_N = 8192  # 1.35 Hz bins at 11025 Hz: a semitone is ~3.5 Hz at 60 Hz
MIN_BARS = 8
GRID = 4  # boundaries sit on multiples of this many bars
MIN_SEGMENT = 8
NOVELTY = 0.15


def chroma(x: np.ndarray, rate: int) -> np.ndarray:
    """Mean 12-bin pitch-class profile: spectral peaks 60 Hz-5 kHz, log-weighted."""
    freqs = np.fft.rfftfreq(CHROMA_N, 1 / rate)
    keep = np.flatnonzero((freqs >= 60) & (freqs <= 5000))
    pc = (np.rint(12 * np.log2(freqs[keep] / 440)).astype(int) + 9) % 12
    win = np.hanning(CHROMA_N)
    total = np.zeros(12)
    for s in range(0, len(x) - CHROMA_N, CHROMA_N // 2):
        mag = np.abs(np.fft.rfft(x[s : s + CHROMA_N] * win))[keep]
        peak = (mag[1:-1] > mag[:-2]) & (mag[1:-1] >= mag[2:])
        w = np.zeros_like(mag)
        w[1:-1] = np.log1p(100 * mag[1:-1]) * peak
        c = np.bincount(pc, w, 12)
        total += c / (c.sum() or 1)
    return total / max(total.sum(), 1e-9)


def camelot(pc: int, minor: bool) -> str:
    num = ((pc + 3 * minor) * 7 % 12 + 7) % 12 + 1
    return f"{num}{'A' if minor else 'B'}"


def key_of(prof: np.ndarray) -> dict[str, Any] | None:
    """Best of the 24 rotations of the K-K profiles; confidence = margin to the runner-up."""
    if prof.sum() <= 0:
        return None
    scores = sorted(
        (float(np.corrcoef(prof, np.roll(ref, pc))[0, 1]), pc, minor)
        for minor, ref in ((False, MAJOR), (True, MINOR))
        for pc in range(12)
    )[::-1]
    (best, pc, minor), second = scores[0], scores[1][0]
    return {
        "key": f"{NAMES[pc]} {'minor' if minor else 'major'}",
        "camelot": camelot(pc, minor),
        "keyConf": round(float(np.clip((best - second) / 0.15, 0, 1)), 2),
    }


def bars(
    bands: np.ndarray, loud: np.ndarray, bpm: float, bar0: float
) -> tuple[np.ndarray, np.ndarray]:
    """Per-bar (bass, mids, highs rows; loudness) from the 0.1 s envelopes, from the first whole bar."""
    length = 240 / bpm
    n = len(loud)
    first = bar0 % length
    count = max(int((n / 10 - first) // length), 0)
    edges = np.minimum(np.rint((first + np.arange(count + 1) * length) * 10), n)
    edges = edges.astype(int)

    def per_bar(row: np.ndarray) -> np.ndarray:
        cs = np.concatenate([[0.0], np.cumsum(row[:n].astype(np.float64))])
        return (cs[edges[1:]] - cs[edges[:-1]]) / np.maximum(edges[1:] - edges[:-1], 1)

    b = bands.astype(np.float64)
    groups = (b[0:2].mean(0), b[2:5].mean(0), b[5:8].mean(0))
    return np.stack([per_bar(g) for g in groups]), per_bar(loud)


def _norm(v: np.ndarray) -> np.ndarray:
    return np.clip(v / (np.percentile(v, 95) or 1), 0, 1)


def energy(groups: np.ndarray, loud: np.ndarray) -> np.ndarray:
    """0..1 per bar: loudness (70 %) and share of the highs (30 %), against the track's own 95th percentile."""
    share = groups[2] / np.maximum(groups.sum(0), 1e-9)
    return np.clip(0.7 * _norm(loud) + 0.3 * _norm(share), 0, 1)


def structure(groups: np.ndarray, en: np.ndarray) -> list[dict[str, Any]]:
    """Segments on the 4/8/16-bar grid, cut where band balance and energy change most, then labelled."""
    nb = len(en)
    feats = np.stack([*(_norm(g) for g in groups), en], axis=1)
    cands = []
    for b in range(MIN_SEGMENT, nb - MIN_SEGMENT + 1, GRID):
        w = 8 if b % 16 == 0 else 4
        d = np.linalg.norm(feats[max(b - w, 0) : b].mean(0) - feats[b : b + w].mean(0))
        if d / 2 >= NOVELTY:
            cands.append((d * (1 + 0.3 * (b % 16 == 0) + 0.15 * (b % 8 == 0)), b))
    cuts: list[int] = []
    for _, b in sorted(cands, reverse=True):
        if all(abs(b - c) >= MIN_SEGMENT for c in cuts):
            cuts.append(b)
    edges = [0, *sorted(cuts), nb]
    segs = list(zip(edges, edges[1:]))
    mid = (np.percentile(en, 10) + np.percentile(en, 90)) / 2
    high = [float(en[a:b].mean()) > mid for a, b in segs]
    out = []
    for i, (a, b) in enumerate(segs):
        part = en[a:b]
        q = max(len(part) // 4, 1)
        rising = part[-q:].mean() - part[:q].mean() > 0.1
        if high[i]:
            label = "drop"
        elif i == 0:
            label = "intro"
        elif not any(high[i + 1 :]):
            label = "outro" if i == len(segs) - 1 else "breakdown"
        elif rising and high[i + 1]:
            label = "buildup"
        else:
            label = "breakdown"
        out.append({"label": label, "start_bar": a, "end_bar": b})
    return out


def _fit(x: float, lo: float, hi: float, soft: float) -> float:
    return float(np.clip(1 - max(lo - x, x - hi, 0) / soft, 0, 1))


def genre(
    bpm: float | None, groups: np.ndarray, en: np.ndarray
) -> dict[str, Any] | None:
    """Rule-based genre from tempo, band balance and energy dynamics; under .7 is doubtful."""
    if not bpm or not len(en):
        return None
    mean = groups.mean(1)
    bass, mids, highs = mean / max(mean.sum(), 1e-9)
    var, level = float(en.std()), float(en.mean())
    # Bar to bar jumps of the mids: growling neuro bass against smooth pads.
    rough = float(np.abs(np.diff(groups[1])).mean() / max(groups[1].mean(), 1e-9))
    scores = {
        "Drum & Bass": _fit(bpm, 168, 180, 8) * _fit(bass, 0.3, 1, 0.15),
        "Dubstep": _fit(bpm, 138, 150, 6)
        * _fit(bass, 0.4, 1, 0.2)
        * _fit(var, 0.12, 1, 0.1),
        "Trance": _fit(bpm, 134, 142, 5)
        * _fit(highs, 0.2, 1, 0.1)
        * _fit(bass, 0, 0.5, 0.1),
        "Techno": _fit(bpm, 125, 140, 6) * _fit(bass, 0, 0.55, 0.1),
        "House": _fit(bpm, 118, 130, 6) * _fit(bass, 0, 0.55, 0.1),
        "Hip-hop": _fit(bpm, 70, 100, 8) * _fit(bass, 0.3, 1, 0.15),
        "Ambient": _fit(level, 0, 0.35, 0.15) * _fit(var, 0, 0.1, 0.1),
        "Electronic": 0.25,
    }
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (name, top), (_, second) = ranked[0], ranked[1]
    if name == "Drum & Bass":
        if mids >= 0.35 and rough >= 0.25 and var >= 0.15:
            name = "Neurofunk"
        elif rough < 0.2 and var < 0.2:
            name = "Liquid Drum & Bass"
    conf = top * (0.5 + 0.5 * float(np.clip((top - second) / 0.5, 0, 1)))
    return {"genre": name, "genreConf": round(conf, 2)}


def profile(
    prof: np.ndarray | None,
    bands: np.ndarray,
    loud: np.ndarray,
    bpm: float | None,
    bar0: float | None,
) -> dict[str, Any]:
    """Everything v2 puts in ``extra``; the chroma is kept so the key can be redone without decoding."""
    out: dict[str, Any] = {"v2": VERSION}
    if prof is not None and (k := key_of(prof)):
        out |= k | {"chroma": [round(float(v), 4) for v in prof]}
    en: np.ndarray = np.zeros(0)
    groups = np.zeros((3, 0))
    if bpm and bar0 is not None:
        groups, loud_bar = bars(bands, loud, bpm, bar0)
        if len(loud_bar) >= MIN_BARS:
            en = energy(groups, loud_bar)
            out["energy"] = np.rint(en * 100).astype(int).tolist()
            out["structure"] = structure(groups, en)
    if g := genre(bpm, groups, en):
        out |= g
    return out
