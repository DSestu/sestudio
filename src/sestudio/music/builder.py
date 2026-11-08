"""Build a set that follows drawn arcs (harmony master plan E0.6), pure functions.

Each slot takes the unused track closest to the arcs at that point in the set.
Genre is the strongest target, harmony (6 of 7 notes or more, see
:mod:`sestudio.music.proximity`) bends only when nothing else is left, and
energy and mood are targets. Inside one genre the tempo stays within
``TEMPO_TOL``; a genre change may jump tempo and is flagged by its join. The
same seed gives the same set; another seed gives another valid one.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any, Final

from sestudio.music import proximity

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

#: Arcs as the wizard draws them: ``energy`` 0..1 and ``mood`` -3..3 are evenly spaced
#: points over the set, ``genre`` is segments ``{"g", "x1"}`` ending at x1 (0..1).
PRESETS: Final[dict[str, dict[str, Any]]] = {
    "Warm-up, peak, cool-down": {
        "energy": [0.35, 0.5, 0.7, 0.9, 0.95, 0.7, 0.4],
        "mood": [0, -1, -1, -2, -2, -1, 0],
        "genre": [{"g": "Drum & Bass", "x1": 1}],
    },
    "Slow burn": {
        "energy": [0.3, 0.38, 0.48, 0.58, 0.7, 0.82, 0.92],
        "mood": [0, 0, -1, -1, -1, -2, -2],
        "genre": [{"g": "Drum & Bass", "x1": 1}],
    },
    "Dubstep interlude": {
        "energy": [0.6, 0.75, 0.85, 0.9, 0.85, 0.8, 0.7],
        "mood": [-1, -1, -2, -2, -2, -1, -1],
        "genre": [
            {"g": "Drum & Bass", "x1": 0.4},
            {"g": "Dubstep", "x1": 0.7},
            {"g": "Drum & Bass", "x1": 1},
        ],
    },
    "Flat out": {
        "energy": [0.9, 0.9, 0.92, 0.92, 0.92, 0.9, 0.9],
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
    energy: float,
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
    e = (t.get("energyScale") or {}).get("track")
    b = ((t.get("harmony") or {}).get("track") or {}).get("brightness")
    cost += 2 * abs(e / 100 - energy) if e is not None else 1
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
    """A set of about *length* seconds following *arc* (``energy``, ``mood``, ``genre``).

    *start* is the track the set opens with (it counts toward the length and is
    not in *pool*'s ranking). Returns ``{"slots", "duration", "genreChanges",
    "clashes", "tempoJumps"}``; each slot is ``{"id", "join"}`` (the join from the
    previous slot, None for the first) so screens can draw and flag the set.
    """
    used = {*skip, *([start["id"]] if start else [])}
    out = [start] if start else []
    # One file in two libraries or folders has two ids but the same decoded length and tempo.
    songs = {_song(t) for t in out}
    left = [t for t in pool if t["id"] not in used and _song(t) not in songs]
    elapsed = float(start.get("duration") or 0) if start else 0.0
    while elapsed < length and len(out) < MAX_TRACKS:
        x = min(1.0, (elapsed + LOOKAHEAD) / length)
        at = (
            _lerp(arc["energy"], x),
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
