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

import math
from collections.abc import Callable, Collection
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
        if ea is not None and eb is not None:
            # The Blend part, plus the distance itself so that of two far steps the nearer still wins.
            best = blend.LEAN[lean]["energy"]
            cost += (
                2 * (1 - blend.energy_part(eb - ea, lean)) + abs(eb - ea - best) / 50
            )
        else:
            cost += 1
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


# --- Best blend of a given set (SPEC-music-library §2.7, §2.8) ---------------

#: Energy shapes over a set: position 0..1 -> share of the set's energy range.
SHAPES: Final[dict[str, Callable[[float], float]]] = {
    "Hold": lambda x: 0.5,
    "Lift": lambda x: 0.25 + 0.65 * x,
    "Ease": lambda x: 0.85 - 0.6 * x,
    "Arc": lambda x: 0.3 + 0.6 * math.sin(math.pi * x),
}
#: How hard the shape pulls against the join's Blend.
SHAPE_PULL: Final = 0.8
#: Above this many tracks only the greedy pass runs (the swaps are quadratic).
ORDER_CAP: Final = 200
#: Swap passes, and the extra a clash weighs in them.
SWAP_PASSES: Final = 6
SWAP_CLASH: Final = 3.0
#: How sharply the clash penalty follows harmony's share of Blend by.
CLASH_EXP: Final = 2
#: Openers Best blend tries; the cheapest whole order wins.
OPENERS: Final = 4
#: Fix all gives up after this many changes.
FIX_STEPS: Final = 30

Weights = dict[str, float] | None


def _energy(t: dict[str, Any]) -> float | None:
    return (t.get("energyScale") or {}).get("track")


def _dist(
    a: dict[str, Any], b: dict[str, Any], weights: Weights, welcome: Weights
) -> float:
    """How far *b* is from blending after *a*, 0..1 (1 - Blend)."""
    return 1 - proximity.join(a, b, "hold", weights, welcome)["blend"]


def clash_penalty(weights: Weights) -> float:
    """The clash penalty grows with harmony's share of Blend by above the default (squared):
    Keys first avoids clashes harder; the defaults and below keep :data:`SWAP_CLASH`."""
    imp = {**blend.DEFAULT_IMPORTANCE, **(weights or {})}
    share = imp["harmony"] / (sum(imp.values()) or 1)
    base = blend.DEFAULT_IMPORTANCE["harmony"] / sum(blend.DEFAULT_IMPORTANCE.values())
    return SWAP_CLASH * max(1.0, share / base) ** CLASH_EXP


def _pair_cost(
    weights: Weights, welcome: Weights
) -> Callable[[dict[str, Any], dict[str, Any]], float]:
    """The cost of the join a -> b in one ordering (1 - Blend, plus a clash penalty), each
    pair worked out once: the swaps ask the same few thousand pairs tens of thousands of times."""
    clash = clash_penalty(weights)
    memo: dict[tuple[str, str], float] = {}

    def cost(a: dict[str, Any], b: dict[str, Any]) -> float:
        key = (a["id"], b["id"])
        if key not in memo:
            j = proximity.join(a, b, "hold", weights, welcome)
            memo[key] = 1 - j["blend"] + (clash if j["move"] == "clash" else 0.0)
        return memo[key]

    return cost


def _swaps(
    out: list[dict[str, Any]],
    pinned: set[str],
    wants: list[float],
    c: Callable[[dict[str, Any], dict[str, Any]], float],
) -> None:
    """2-opt in place: reverse a run of free tracks when its two outer joins plus its
    distance from the shape (*wants*: the energy wanted at each index) get cheaper; then
    move a free track off a clash when that makes the whole order cheaper."""
    n = len(out)
    if n < 4:
        return
    prefix = [0]
    for t in out:
        prefix.append(prefix[-1] + (t["id"] in pinned))

    def pull(t: dict[str, Any], k: int) -> float:
        e = _energy(t)
        return 0.0 if e is None else SHAPE_PULL * abs(e - wants[k]) / 60

    def total(arr: list[dict[str, Any]]) -> float:
        return sum(c(x, y) for x, y in zip(arr, arr[1:])) + sum(
            pull(t, k) for k, t in enumerate(arr)
        )

    for _ in range(SWAP_PASSES):
        better = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                if prefix[j + 1] - prefix[i]:  # a pinned track inside the run
                    break
                before = c(out[i - 1], out[i]) + (
                    c(out[j], out[j + 1]) if j < n - 1 else 0
                )
                after = c(out[i - 1], out[j]) + (
                    c(out[i], out[j + 1]) if j < n - 1 else 0
                )
                for k in range(i, j + 1):
                    before += pull(out[k], k)
                    after += pull(out[i + j - k], k)
                if after < before - 0.01:
                    out[i : j + 1] = out[i : j + 1][::-1]
                    better = True
        # A track on a clash may move elsewhere, if the whole order gets cheaper (no pin crossed).
        for i in range(n):
            t = out[i]
            if t["id"] in pinned or not (
                (i > 0 and c(out[i - 1], t) > 1) or (i < n - 1 and c(t, out[i + 1]) > 1)
            ):
                continue
            base = total(out)
            best: tuple[float, list[dict[str, Any]]] | None = None
            for p in range(n):
                lo, hi = min(i, p), max(i, p)
                if p == i or prefix[hi + 1] - prefix[lo]:
                    continue
                arr = out[:i] + out[i + 1 :]
                arr.insert(p, t)
                v = total(arr)
                if v < base - 0.01 and (best is None or v < best[0]):
                    best = (v, arr)
            if best:
                out[:] = best[1]
                better = True
        if not better:
            return


def order_set(
    tracks: list[dict[str, Any]],
    pins: dict[int | str, str] | None = None,
    shape: str = "Arc",
    weights: Weights = None,
    welcome: Weights = None,
) -> list[dict[str, Any]]:
    """*tracks* in their best succession: each free slot takes the free track that
    blends best after the one before, pulled towards the *shape*'s energy there;
    pinned tracks (``{index: id}``) keep their index. Then runs of free tracks are
    reversed while that cuts the join distances. Ids without an analysis are
    ordered as unknowns.
    """
    n = len(tracks)
    if n < 3:
        return list(tracks)
    by_id = {t["id"]: t for t in tracks}
    out: list[dict[str, Any] | None] = [None] * n
    pinned: set[str] = set()
    for key, tid in (pins or {}).items():
        i = int(key)
        if 0 <= i < n and tid in by_id and tid not in pinned and out[i] is None:
            out[i] = by_id[tid]
            pinned.add(tid)
    free = [t for t in tracks if t["id"] not in pinned]
    energies = [e for t in tracks if (e := _energy(t)) is not None]
    lo, hi = (min(energies), max(energies)) if energies else (0.0, 100.0)
    span = (hi - lo) or 1.0
    f = SHAPES.get(shape, SHAPES["Arc"])
    cost = _pair_cost(weights, welcome)
    wants = [lo + f(k / (n - 1)) * span for k in range(n)]

    def pull(t: dict[str, Any], k: int) -> float:
        e = _energy(t)
        return 0.0 if e is None else SHAPE_PULL * abs(e - wants[k]) / 60

    def build(opener: dict[str, Any] | None) -> list[dict[str, Any]]:
        slots, left = list(out), list(free)
        prev: dict[str, Any] | None = None
        for i in range(n):
            if slots[i] is not None:
                prev = slots[i]
                continue
            if not left:
                break
            if prev is None:  # the opener
                best = (
                    opener
                    if opener in left
                    else min(left, key=lambda t: (pull(t, i), t["id"]))
                )
            else:
                p = prev
                best = min(left, key=lambda t: (cost(p, t) + pull(t, i), t["id"]))
            slots[i] = best
            left.remove(best)
            prev = best
        done = [t for t in slots if t is not None] + left
        if len(done) <= ORDER_CAP:
            _swaps(done, pinned, wants, cost)
        return done

    def total(arr: list[dict[str, Any]]) -> float:
        return sum(cost(x, y) for x, y in zip(arr, arr[1:])) + sum(
            pull(t, k) for k, t in enumerate(arr)
        )

    # A greedy order can corner a track that fits few others; a few openers near the
    # shape's start give it other paths, and the cheapest whole order wins.
    openers: list[dict[str, Any] | None] = (
        [None]
        if out[0] is not None or n > ORDER_CAP
        else sorted(free, key=lambda t: (pull(t, 0), t["id"]))[:OPENERS]
    )
    return min((build(o) for o in openers), key=total)


def _count(tracks: list[dict[str, Any]], kept: Collection[str]) -> int:
    return sum(
        bool(proximity.problems(proximity.join(a, b)))
        for a, b in zip(tracks, tracks[1:])
        if f"{a['id']}>{b['id']}" not in kept
    )


def move_to_best(
    tracks: list[dict[str, Any]],
    b: dict[str, Any],
    kept: Collection[str] = (),
    weights: Weights = None,
    welcome: Weights = None,
) -> list[dict[str, Any]]:
    """*tracks* with *b* moved to the spot with the fewest problem joins, then the smoothest."""
    rest = [t for t in tracks if t is not b]

    def ranked(p: int) -> tuple[int, float]:
        arr = rest[:p] + [b] + rest[p:]
        return _count(arr, kept), sum(
            _dist(x, y, weights, welcome) for x, y in zip(arr, arr[1:])
        )

    p = min(range(len(rest) + 1), key=ranked)
    return rest[:p] + [b] + rest[p:]


def fix_set(
    tracks: list[dict[str, Any]],
    pool: list[dict[str, Any]],
    kept: Collection[str] = (),
    weights: Weights = None,
    welcome: Weights = None,
) -> dict[str, Any]:
    """Fix all: for each problem join in order, insert the *pool* track that leaves no
    problem on either side and blends best, else move the second track to the spot
    with the fewest problems when that lowers the count; stop when nothing improves.
    Returns ``{"order", "inserted", "moved", "left"}``.
    """
    out = list(tracks)
    in_set = {t["id"] for t in out}
    songs = {_song(t) for t in out}
    pool = [t for t in pool if t["id"] not in in_set and _song(t) not in songs]
    kept = set(kept)
    inserted: list[str] = []
    moved: list[str] = []
    skipped: set[str] = set()

    for _ in range(FIX_STEPS):
        changed = False
        for i in range(len(out) - 1):
            a, b = out[i], out[i + 1]
            key = f"{a['id']}>{b['id']}"
            if (
                key in kept
                or key in skipped
                or not proximity.problems(proximity.join(a, b))
            ):
                continue
            # Only a track near both tempi can bridge without a tempo jump of its own.
            pa, pb = a.get("bpm"), b.get("bpm")
            near = [
                t
                for t in pool
                if not (pa and pb and t.get("bpm"))
                or (
                    abs(t["bpm"] - pa) <= pa * proximity.TEMPO_TOL * 2
                    and abs(pb - t["bpm"]) <= t["bpm"] * proximity.TEMPO_TOL * 2
                )
            ]
            ranked = sorted(
                (
                    (
                        len(proximity.problems(j1)) + len(proximity.problems(j2)),
                        2 - j1["blend"] - j2["blend"],
                        t["id"],
                        t,
                    )
                    for t in near
                    for j1, j2 in (
                        (
                            proximity.join(a, t, "hold", weights, welcome),
                            proximity.join(t, b, "hold", weights, welcome),
                        ),
                    )
                ),
                key=lambda r: r[:3],
            )
            if ranked and ranked[0][0] == 0:
                t = ranked[0][3]
                out.insert(i + 1, t)
                pool.remove(t)
                inserted.append(t["id"])
                changed = True
                break
            base = _count(out, kept)
            new = move_to_best(out, b, kept, weights, welcome)
            if _count(new, kept) < base:
                out = new
                moved.append(b["id"])
                changed = True
                break
            skipped.add(key)
        if not changed:
            break
    return {
        "order": out,
        "inserted": inserted,
        "moved": moved,
        "left": _count(out, kept),
    }
