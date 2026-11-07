"""Analysis v2 (SPEC-music §11, PR 20): key, energy, structure and genre.

numpy only. The key comes from the S-KEY network (:mod:`sestudio.music.keynet`)
on the 11 kHz signal; energy, structure and genre are derived from the v1
envelopes and tempo, so they can be redone from the stored row without decoding.
Known limits: SPEC-music §9.
"""

from __future__ import annotations

from typing import Any

import numpy as np

#: Bump to have every stored track re-profiled.
VERSION = 3

NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MIN_BARS = 8
GRID = 4  # boundaries sit on multiples of this many bars, counted from the phrase phase
MIN_SEGMENT = 8
NOVELTY = 0.15
#: A first whole bar starting this late (share of a bar) means the music began on a downbeat
#: near 0 s that :func:`bars` skips as partial, so its phrases start on bar 3, 7, 11…
LATE_BAR0 = 0.65


def camelot(pc: int, minor: bool) -> str:
    num = ((pc + 3 * minor) * 7 % 12 + 7) % 12 + 1
    return f"{num}{'A' if minor else 'B'}"


def key_fields(pc: int, minor: bool, p: float) -> dict[str, Any]:
    """Key name, Camelot code, and S-KEY's top probability as the confidence.

    On GiantSteps it reads as is: under .32 the key is right 26 % of the time, .48-.73 64 %, over .83 80 %.
    """
    return {
        "key": f"{NAMES[pc]} {'minor' if minor else 'major'}",
        "camelot": camelot(pc, minor),
        "keyConf": round(p, 2),
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


#: A track's energy against the whole library, by quartile (harmony master plan E0.4).
LEVELS = ("Calm", "Steady", "Driving", "Intense")
#: Intro and outro: this share of the track, at most this many 0.1 s frames.
EDGE_SHARE, EDGE_MAX = 0.2, 600


def energy_raw(bands: np.ndarray, loud: np.ndarray) -> dict[str, tuple[float, float]]:
    """(loudness, highs share) of the whole track, its intro and its outro, from the raw 0.1 s envelopes.

    Loudness is the 75th percentile of the RMS, so a quiet break does not pull a
    loud track down; the highs share is the 2 kHz+ bands' part of the power.
    """
    out = {}
    n = min(bands.shape[1], len(loud))
    edge = max(1, min(int(n * EDGE_SHARE), EDGE_MAX))
    for name, cut in (
        ("track", slice(None)),
        ("intro", slice(0, edge)),
        ("outro", slice(n - edge, n)),
    ):
        b, lo = bands[:, :n][:, cut].astype(np.float64), loud[:n][cut]
        if not len(lo):
            continue
        power = (b**2).sum(1)
        out[name] = (
            float(np.percentile(lo, 75)),
            float(power[5:].sum() / max(power.sum(), 1e-12)),
        )
    return out


def _rank(v: float, ordered: list[float]) -> float:
    return float(np.searchsorted(ordered, v) / max(len(ordered) - 1, 1))


def energy_score(
    raw: tuple[float, float], loud: list[float], highs: list[float]
) -> float:
    """0..1: rank of the loudness (70 %) and of the highs share (30 %) among the library's tracks."""
    return min(1.0, 0.7 * _rank(raw[0], loud) + 0.3 * _rank(raw[1], highs))


def energy_scale(
    raw: dict[str, tuple[float, float]], scale: dict[str, list[float]]
) -> dict[str, Any]:
    """``energyLevel`` and ``energyScale`` (track, intro, outro, 0..100) on the library's scale."""
    if "track" not in raw or not scale.get("score"):
        return {}
    score = {k: energy_score(v, scale["loud"], scale["highs"]) for k, v in raw.items()}
    below = np.searchsorted(scale["score"], score["track"]) / len(scale["score"])
    return {
        "energyLevel": LEVELS[min(int(below * len(LEVELS)), len(LEVELS) - 1)],
        "energyScale": {k: round(100 * v) for k, v in score.items()},
    }


def phrase_phase(bpm: float, bar0: float) -> int:
    """The bar of :func:`bars` on which the music's 4-bar phrases start (0 or 3)."""
    length = 240 / bpm
    return GRID - 1 if bar0 % length >= LATE_BAR0 * length else 0


def structure(
    groups: np.ndarray, en: np.ndarray, phase: int = 0
) -> list[dict[str, Any]]:
    """Segments on the 4/8/16-bar grid from bar *phase*, cut where band balance and energy change most, then labelled."""
    nb = len(en)
    feats = np.stack([*(_norm(g) for g in groups), en], axis=1)
    cands = []
    for b in range(phase + MIN_SEGMENT, nb - MIN_SEGMENT + 1, GRID):
        k = b - phase
        w = 8 if k % 16 == 0 else 4
        d = np.linalg.norm(feats[max(b - w, 0) : b].mean(0) - feats[b : b + w].mean(0))
        if d / 2 >= NOVELTY:
            cands.append((d * (1 + 0.3 * (k % 16 == 0) + 0.15 * (k % 8 == 0)), b))
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
        # Nothing breaks down before the first drop: that's still the intro.
        if label == "breakdown" and not any(high[:i]):
            label = "intro"
        # Two parts in a row with one name are one section (a drop's switch-up is not a new drop).
        if out and out[-1]["label"] == label:
            out[-1]["end_bar"] = b
        else:
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
    return {"genre": name, "genreConf": round(conf, 2), "genreSource": "rules"}


def profile(
    key: tuple[int, bool, float] | None,
    bands: np.ndarray,
    loud: np.ndarray,
    bpm: float | None,
    bar0: float | None,
) -> dict[str, Any]:
    """Everything v2 puts in ``extra``; *key* is :func:`sestudio.music.keynet.key`'s answer."""
    out: dict[str, Any] = {"v2": VERSION}
    if key is not None:
        out |= key_fields(*key)
    en: np.ndarray = np.zeros(0)
    groups = np.zeros((3, 0))
    if bpm and bar0 is not None:
        groups, loud_bar = bars(bands, loud, bpm, bar0)
        if len(loud_bar) >= MIN_BARS:
            en = energy(groups, loud_bar)
            out["energy"] = np.rint(en * 100).astype(int).tolist()
            out["structure"] = structure(groups, en, phrase_phase(bpm, bar0))
    if g := genre(bpm, groups, en):
        out |= g
    return out
