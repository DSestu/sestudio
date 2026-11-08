"""Build a set that follows drawn arcs (harmony master plan E0.6), pure functions.

Each slot takes the unused track closest to the arcs at that point in the set.
Genre is the strongest target, harmony (6 of 7 notes or more, see
:mod:`sestudio.music.proximity`) bends only when nothing else is left, mood is a
target, and energy leans (SPEC-blend): the first track near ``start``, then each
step from the track before scored as a Blend under the lean of that stretch. Inside one genre the tempo stays within
``TEMPO_TOL``; a genre change may jump tempo and is flagged by its join. The
same seed gives the same set; another seed gives another valid one.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any, Final

from sestudio.music import blend, flows, proximity

#: Cost of a track off the target genre, of a clash and of an unknown key.
GENRE_MISS: Final = 6
CLASH: Final = 9
UNKNOWN_KEY: Final = 3
TRANSPOSED: Final = 4
#: Largest random nudge between near-equal tracks; what a seed changes.
JITTER: Final = 0.3
MAX_TRACKS: Final = 60
#: A slot's target is read this far ahead (seconds): the track starts then, plays through its middle.
LOOKAHEAD: Final = 90

#: Arcs as the wizard draws them: ``start`` 0..1 is where the energy opens, ``energy`` is
#: lean segments ``{"lean", "x1"}`` ending at x1 (0..1), ``mood`` -3..3 is evenly spaced
#: points over the set, ``genre`` is segments ``{"g", "x1"}``. Older arcs with energy
#: points are read through :func:`upgrade`.
PRESETS: Final[dict[str, dict[str, Any]]] = {
    "Warm-up, peak, cool-down": {
        "start": 0.35,
        "energy": [{"lean": "lift", "x1": 0.67}, {"lean": "ease", "x1": 1}],
        "mood": [0, -1, -1, -2, -2, -1, 0],
        "genre": [{"g": "Drum & Bass", "x1": 1}],
    },
    "Slow burn": {
        "start": 0.3,
        "energy": [{"lean": "lift", "x1": 1}],
        "mood": [0, 0, -1, -1, -1, -2, -2],
        "genre": [{"g": "Drum & Bass", "x1": 1}],
    },
    "Dubstep interlude": {
        "start": 0.6,
        "energy": [{"lean": "lift", "x1": 0.5}, {"lean": "hold", "x1": 1}],
        "mood": [-1, -1, -2, -2, -2, -1, -1],
        "genre": [
            {"g": "Drum & Bass", "x1": 0.4},
            {"g": "Dubstep", "x1": 0.7},
            {"g": "Drum & Bass", "x1": 1},
        ],
    },
    "Flat out": {
        "start": 0.9,
        "energy": [{"lean": "hold", "x1": 1}],
        "mood": [-2, -2, -2, -2, -2, -2, -2],
        "genre": [{"g": "Dubstep", "x1": 0.5}, {"g": "Drum & Bass", "x1": 1}],
    },
}


def _lerp(points: list[float], x: float) -> float:
    if len(points) == 1:
        return points[0]
    p = x * (len(points) - 1)
    i = min(len(points) - 2, int(p))
    return points[i] * (1 - (p - i)) + points[i + 1] * (p - i)


def _genre_at(segments: list[dict[str, Any]], x: float) -> str:
    return next((s["g"] for s in segments if x <= s["x1"]), segments[-1]["g"])


def _lean_at(segments: list[dict[str, Any]], x: float) -> str:
    return next((s["lean"] for s in segments if x <= s["x1"]), segments[-1]["lean"])


def upgrade(arc: dict[str, Any]) -> dict[str, Any]:
    """*arc* with a start and lean segments; older energy points read by their slopes (flows.SLOPE)."""
    e = arc.get("energy") or [0.5]
    if e and isinstance(e[0], dict):
        return {**arc, "start": arc.get("start", 0.5)}
    n = max(1, len(e) - 1)
    leans = flows._leans([[i / n, v] for i, v in enumerate(e)]) or [
        {"from": 0, "to": 1, "lean": "hold"}
    ]
    return {
        **arc,
        "start": e[0],
        "energy": [{"lean": b["lean"], "x1": b["to"]} for b in leans],
    }


def _song(t: dict[str, Any]) -> tuple[Any, ...]:
    """What copies of one recording share; a track without a length is only itself."""
    return (t["duration"], t.get("bpm")) if t.get("duration") else (t["id"],)


def jitter(track_id: str, seed: int) -> float:
    """0..1, the same for the same track and seed (FNV-1a; Python's hash() changes per run)."""
    h = 2166136261
    for c in f"{track_id}:{seed}".encode():
        h = ((h ^ c) * 16777619) & 0xFFFFFFFF
    return (h % 1000) / 1000


def _score(
    t: dict[str, Any],
    prev: dict[str, Any] | None,
    lean: str,
    start: float,
    mood: float,
    genre: str,
    seed: int,
) -> float | None:
    """Cost of *t* in this slot; None when its tempo is not allowed after *prev*."""
    cost = 0.0 if (t.get("genre") or "").lower() == genre.lower() else GENRE_MISS
    if prev:
        j = proximity.join(prev, t)
        if not proximity.tempo_ok(j):
            return None
        if j["kind"] == "transposed":
            cost += TRANSPOSED  # the same scale moved: a last resort, after shared notes and unread keys
        elif j["shared"] is None:
            cost += UNKNOWN_KEY
        elif not j["safe"]:
            cost += CLASH
        else:
            cost += 7 - j["shared"]
    b = ((t.get("harmony") or {}).get("track") or {}).get("brightness")
    if prev:
        ea, eb = blend.edge(prev, "outro"), blend.edge(t, "intro")
        cost += (
            2 * (1 - blend.energy_part(eb - ea, lean))
            if ea is not None and eb is not None
            else 1
        )
    else:
        e = (t.get("energyScale") or {}).get("track")
        cost += 2 * abs(e / 100 - start) if e is not None else 1
    cost += abs(b - mood) / 3 if b is not None else 0.5
    return cost + JITTER * jitter(t["id"], seed)


def build_arc(
    pool: list[dict[str, Any]],
    arc: dict[str, Any],
    length: float,
    seed: int = 0,
    start: dict[str, Any] | None = None,
    skip: Collection[str] = (),
) -> dict[str, Any]:
    """A set of about *length* seconds following *arc* (``start``, ``energy`` leans, ``mood``, ``genre``).

    *start* is the track the set opens with (it counts toward the length and is
    not in *pool*'s ranking). Returns ``{"slots", "duration", "genreChanges",
    "clashes", "tempoJumps"}``; each slot is ``{"id", "join"}`` (the join from the
    previous slot, None for the first) so screens can draw and flag the set.
    """
    arc = upgrade(arc)
    used = {*skip, *([start["id"]] if start else [])}
    out = [start] if start else []
    # One file in two libraries or folders has two ids but the same decoded length and tempo.
    songs = {_song(t) for t in out}
    left = [t for t in pool if t["id"] not in used and _song(t) not in songs]
    elapsed = float(start.get("duration") or 0) if start else 0.0
    while elapsed < length and len(out) < MAX_TRACKS:
        x = min(1.0, (elapsed + LOOKAHEAD) / length)
        at = (
            _lean_at(arc["energy"], x),
            arc["start"],
            _lerp(arc["mood"], x),
            _genre_at(arc["genre"], x),
        )
        prev = out[-1] if out else None
        ranked = [
            (s, t["id"], t)
            for t in left
            if (s := _score(t, prev, *at, seed)) is not None
        ]
        if not ranked:
            break
        _, _, best = min(ranked, key=lambda r: r[:2])
        out.append(best)
        left = [t for t in left if t is not best and _song(t) != _song(best)]
        elapsed += float(best.get("duration") or 0)
    joins = [None, *(proximity.join(a, b) for a, b in zip(out, out[1:]))] if out else []
    return {
        "slots": [{"id": t["id"], "join": j} for t, j in zip(out, joins)],
        "duration": round(elapsed, 1),
        "genreChanges": sum(bool(j and j["genreChange"]) for j in joins),
        "clashes": sum(bool(j and not j["safe"]) for j in joins),
        "tempoJumps": sum(bool(j and j["tempoJump"]) for j in joins),
    }
