"""How one track hands over to the next: a port of ``mix/plan.ts`` (SPEC-music-player §9.3).

Kept identical to the browser's plan by shared test vectors
(``tests/fixtures/mixplan_vectors.json``, read by pytest and vitest).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

FADE = 4.0
#: How many 4-bar phrases from the end the mix may start: 32 bars, under a minute at club tempos.
TAIL = 8


@dataclass
class Track:
    dur: float
    #: 0 when the tempo is unknown.
    bpm: float = 0.0
    bar0: float = 0.0
    #: Structure segments ``(label, start, end)`` in the track's own seconds.
    segs: list[tuple[str, float, float]] = field(default_factory=list)


@dataclass
class Plan:
    mode: str
    mix_out: float
    len: float
    start_off: float
    rate: float
    bars: int | None = None
    swap: bool = False
    bpm_a: float = 0.0
    bpm_b: float = 0.0
    why: str | None = None


def norm_bar0(bpm: float, bar0: float | None) -> float:
    """The first bar line, folded into the first bar (a hair before the next one counts as 0)."""
    if not bpm:
        return 0.0
    bar = 240 / bpm
    b = math.fmod(bar0 or 0.0, bar)
    if b > bar - 0.06:
        b -= bar
    return max(0.0, b)


def prep_track(dur: float, raw: dict[str, Any] | None = None) -> Track:
    """A track from its analysis (the API's shape); without one, no tempo."""
    raw = raw or {}
    bpm = raw.get("bpm") or 0
    bpm = bpm if bpm > 0 else 0.0
    bar0 = norm_bar0(bpm, raw.get("bar0"))
    bar = 240 / bpm if bpm else 0.0
    segs = (
        [
            (g["label"], bar0 + g["start_bar"] * bar, bar0 + g["end_bar"] * bar)
            for g in raw["structure"]
        ]
        if bpm and raw.get("structure")
        else []
    )
    return Track(dur, bpm, bar0, segs)


def fade_plan(a: Track) -> Plan:
    return Plan("fade", a.dur - FADE, FADE, 0.0, 1.0)


def _over_drop(segs: list[tuple[str, float, float]], a: float, b: float, slack: float):
    return any(lb == "drop" and s < b - slack and e > a + slack for lb, s, e in segs)


def _last(items: list, pred) -> Any:
    return next((x for x in reversed(items) if pred(x)), None)


def plan(a: Track, b: Track, s: dict[str, Any]) -> Plan:
    """*s* is a pair's whole settings: ``mode``, ``bars``, ``tempo``, ``swap``, ``nudge``."""
    fade = fade_plan(a)
    if s["mode"] != "sync" or not a.bpm or not b.bpm:
        return fade
    r = a.bpm / b.bpm
    if s["tempo"] and abs(r - 1) > 0.08:
        fade.why = "tempo"
        return fade
    beat = 60 / a.bpm
    bar = 4 * beat
    rate = r if s["tempo"] else 1.0
    bars = s["bars"]
    # The blend must not run into the incoming track's first drop: fit it in its intro.
    if b.segs and b.segs[0][0] == "intro":
        bars = max(4, min(bars, math.floor((b.segs[0][2] - b.segs[0][1]) / rate / bar)))
    ln = bars * bar
    # Whole 4-bar phrases of the outgoing track that fit before the mix must end.
    n = math.floor((a.dur - 0.3 - ln - a.bar0) / (4 * bar))
    if n < 0:
        fade.why = "short"
        return fade
    k = n
    if a.segs:
        # Only the last TAIL phrases are candidates: dodging a drop or seeking an outro must not cut a track minutes short.
        ks = [
            i
            for i in range(max(0, n - TAIL + 1), n + 1)
            if not _over_drop(
                a.segs, a.bar0 + i * 4 * bar, a.bar0 + i * 4 * bar + ln, beat
            )
        ]
        zone = _last(a.segs, lambda g: g[0] == "outro") or _last(
            a.segs, lambda g: g[0] == "breakdown"
        )
        pick = (
            _last(ks, lambda i: a.bar0 + i * 4 * bar >= zone[1] - beat)
            if zone
            else None
        )
        k = pick if pick is not None else (ks[-1] if ks else n)
    return Plan(
        "sync",
        a.bar0 + k * 4 * bar,
        ln,
        max(0.0, b.bar0 + s["nudge"] / 1000),
        rate,
        bars,
        bool(s["swap"]),
        a.bpm,
        b.bpm,
    )
