"""Blend (SPEC-blend §2): how well one track follows another, as one soft score.

Energy, tempo, harmony, colour and genre each give a part (0..1, None when unknown
or ignored); the score is their weighted mean. A *lean* (``lift``, ``hold``,
``ease``) moves the energy and tempo steps that score best. Each layer is ``must``,
``prefer`` or ``ignore``: Must weighs more, and only blocks a track on a big jump
(energy, tempo) or a mismatch (colour, genre). Nothing else ever blocks.

Tracks are the dicts of :func:`sestudio.music.store.get`. The frontend has the same
rules in ``frontend/src/blend.ts``; ``tests/fixtures/blend.json`` keeps both in step.
"""

from __future__ import annotations

import math
from typing import Any, Final

from sestudio.music import flows

LAYERS: Final = ("energy", "tempo", "harmony", "colour", "genre")
#: How much each layer counts at Prefer.
WEIGHTS: Final = {
    "energy": 1.0,
    "tempo": 1.0,
    "harmony": 1.5,
    "colour": 0.5,
    "genre": 0.5,
}
#: Must multiplies a layer's weight by this.
MUST: Final = 3.0
#: A step over this (energy points, BPM) is a big jump: what Must blocks.
LIMITS: Final = {"energy": 33.0, "tempo": 8.0}
#: How fast a part falls off with the distance from the best step: at this distance it is 0.37.
SPREAD: Final = {"energy": 15.0, "tempo": 5.0}
#: The step each lean scores best on (energy points, BPM).
LEAN: Final = {
    "lift": {"energy": 6.0, "tempo": 1.0},
    "hold": {"energy": 0.0, "tempo": 0.0},
    "ease": {"energy": -6.0, "tempo": -1.0},
}
#: Part of a genre or colour change when nothing asks for one.
CHANGE: Final = 0.4

Track = dict[str, Any]


def edge(t: Track, which: str) -> float | None:
    """The energy (0..100) of *t*'s intro, outro or whole track; the whole track stands in for a missing edge."""
    s = t.get("energyScale") or {}
    return s.get(which, s.get("track"))


def _near(step: float, best: float, spread: float) -> float:
    return math.exp(-(((step - best) / spread) ** 2))


def blend(
    a: Track,
    b: Track,
    lean: str = "hold",
    settings: dict[str, str] | None = None,
    want: str = "match",
    colour: str | None = None,
    genres: list[str] | None = None,
) -> dict[str, Any]:
    """How well *b* follows *a*: ``score`` 0..1, ``parts`` per layer, ``steps`` (energy, tempo), ``join``, ``blocked``.

    *want*: the harmony event this join should serve (``match`` when none). *colour* and
    *genres*: what a flow's colour or genre block asks for here; without them a change
    from *a* scores lower and a match scores full.
    """
    cfg = {k: (settings or {}).get(k, "prefer") for k in LAYERS}
    best = LEAN.get(lean, LEAN["hold"])
    parts: dict[str, float | None] = dict.fromkeys(LAYERS)
    blocked = False

    ea, eb = edge(a, "outro"), edge(b, "intro")
    de = None if ea is None or eb is None else eb - ea
    if de is not None:
        parts["energy"] = _near(de, best["energy"], SPREAD["energy"])
        blocked |= cfg["energy"] == "must" and abs(de) > LIMITS["energy"]

    pa, pb = a.get("bpm"), b.get("bpm")
    dt = round(pb - pa, 1) if pa and pb else None
    if dt is not None:
        parts["tempo"] = _near(dt, best["tempo"], SPREAD["tempo"])
        blocked |= cfg["tempo"] == "must" and abs(dt) > LIMITS["tempo"]

    kind = flows.join(a, b)
    parts["harmony"] = flows.fit(kind, want)

    ca, cb = flows.colour(a), flows.colour(b)
    if colour:
        if cb is not None:
            parts["colour"] = 1.0 if cb == colour else 0.0
            blocked |= cfg["colour"] == "must" and cb != colour
    elif ca is not None and cb is not None:
        parts["colour"] = 1.0 if ca == cb else CHANGE

    ga, gb = flows._norm(a.get("genre")), flows._norm(b.get("genre"))
    if genres:
        ok = gb in {flows._norm(g) for g in genres}
        parts["genre"] = 1.0 if ok else 0.0
        blocked |= cfg["genre"] == "must" and not ok
    elif ga and gb:
        parts["genre"] = 1.0 if ga == gb else CHANGE

    total = weight = 0.0
    for k in LAYERS:
        if cfg[k] == "ignore":
            parts[k] = None
        if parts[k] is None:
            continue
        w = WEIGHTS[k] * (MUST if cfg[k] == "must" else 1.0)
        total += w * parts[k]  # type: ignore[operator]
        weight += w
    return {
        "score": round(total / weight, 3) if weight else 0.5,
        "parts": {k: None if v is None else round(v, 3) for k, v in parts.items()},
        "steps": {"energy": de, "tempo": dt},
        "join": kind,
        "blocked": blocked,
    }
