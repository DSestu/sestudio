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
    "energy": 1.5,
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
SPREAD: Final = {"energy": 12.0, "tempo": 5.0}
#: The step each lean scores best on (energy points, BPM).
LEAN: Final = {
    "lift": {"energy": 10.0, "tempo": 1.0},
    "hold": {"energy": 0.0, "tempo": 0.0},
    "ease": {"energy": -10.0, "tempo": -1.0},
}
#: Part of a genre or colour change when nothing asks for one.
CHANGE: Final = 0.4
#: Blend by (SPEC-music-library §2.7): the user's importance of each axis, 0..1, as the
#: Music page names them; a layer's weight is scaled by importance / default. Tempo is
#: not an axis: it stays at its weight as a guard.
AXES: Final = {
    "harmony": "harmony",
    "mood": "colour",
    "energy": "energy",
    "genre": "genre",
}
DEFAULT_IMPORTANCE: Final = {"harmony": 0.9, "mood": 0.45, "energy": 0.7, "genre": 0.35}

Track = dict[str, Any]


def layer_weights(weights: dict[str, float] | None) -> dict[str, float]:
    """The Prefer weight of each layer under Blend by *weights* (None: the defaults)."""
    if not weights:
        return dict(WEIGHTS)
    out = dict(WEIGHTS)
    for axis, layer in AXES.items():
        if axis in weights:
            out[layer] = (
                WEIGHTS[layer]
                * max(0.0, float(weights[axis]))
                / DEFAULT_IMPORTANCE[axis]
            )
    return out


def edge(t: Track, which: str) -> float | None:
    """The energy (0..100) of *t*'s intro, outro or whole track; the whole track stands in for a missing edge."""
    s = t.get("energyScale") or {}
    return s.get(which, s.get("track"))


def _near(step: float, best: float, spread: float) -> float:
    return math.exp(-(((step - best) / spread) ** 2))


def energy_part(delta: float, lean: str = "hold") -> float:
    """The Blend energy part of a step from one track to the next under *lean*, 0..1."""
    return _near(delta, LEAN.get(lean, LEAN["hold"])["energy"], SPREAD["energy"])


#: An energy step "holds" while the Hold part stays this high (about 8 points either way).
HOLD_PART: Final = 0.64


def energy_lean(delta: float) -> str:
    """What an energy step does, from the Blend energy part: ``hold`` while Hold scores HOLD_PART or more, else ``lift`` or ``ease``."""
    if _near(delta, LEAN["hold"]["energy"], SPREAD["energy"]) >= HOLD_PART:
        return "hold"
    return "lift" if delta > 0 else "ease"


def blend(
    a: Track,
    b: Track,
    lean: str = "hold",
    settings: dict[str, str] | None = None,
    want: str = "match",
    colour: str | None = None,
    genres: list[str] | None = None,
    harmony: float | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """How well *b* follows *a*: ``score`` 0..1, ``parts`` per layer, ``steps`` (energy, tempo), ``join``, ``blocked``.

    *want*: the harmony event this join should serve (``match`` when none). *colour* and
    *genres*: what a flow's colour or genre block asks for here; without them a change
    from *a* scores lower and a match scores full. *harmony*: the harmony part when the
    caller reads joins its own way (proximity, with its Camelot fallback). *weights*:
    Blend by importances (:data:`AXES`), scaling the layers' weights.
    """
    cfg = {k: (settings or {}).get(k, "prefer") for k in LAYERS}
    base = layer_weights(weights)
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
    parts["harmony"] = flows.fit(kind, want) if harmony is None else harmony

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
        w = base[k] * (MUST if cfg[k] == "must" else 1.0)
        total += w * parts[k]  # type: ignore[operator]
        weight += w
    return {
        "score": round(total / weight, 3) if weight else 0.5,
        "parts": {k: None if v is None else round(v, 3) for k, v in parts.items()},
        "steps": {"energy": de, "tempo": dt},
        "join": kind,
        "blocked": blocked,
    }
