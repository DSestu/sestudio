"""Flow → mix generator (SPEC-music-flows §4–§6), pure functions.

A flow is ``chunks``, each with a ``share`` of the length, ``next`` chunk ids (two
or more = a fork) and ``layers``: ``tempo`` and ``energy`` as ``[[fraction,
value], ...]`` curves (energy 0..1 on the library's scale), ``harmony`` as a list
of events ``{"at": fraction, "kind": up|down|mode+|mode-|relative|break}`` (every
other join wants a match; no ``harmony`` key = free), ``genre`` as blocks
``{"from", "to", "genres", "strict": must|prefer}``.

Tracks are the dicts of :func:`sestudio.music.store.get` (``id``, ``duration``,
``bpm``, ``genre``, ``harmony.track``, ``energyScale.track``). The same rules
live in ``docs/proto/flows/flowgen.js`` for the lab: keep them in step.
"""

from __future__ import annotations

import random
from typing import Any, Final

from sestudio.music.modes import NAMES, SCALES

BLEND_S: Final = 20.0  # shortcut: fixed overlap, the real plan() varies per pair
TEMPO_BAND: Final = 3.0
ENERGY_BAND: Final = 0.2  # one step of five
SAFE_NOTES: Final = 6
#: Relaxation order (§6.4): one layer alone, then cumulative; ``any`` makes the
#: curves preferences so a mix never stops short. Harmony is never relaxed.
LADDER: Final = ("tempo", "energy", "genre", "any")
#: How much the harmony fit weighs against tempo and energy closeness (1 each).
PULL: Final = {"light": 1.0, "strong": 2.0, "only": 6.0}
KINDS: Final = {
    "match": "Match",
    "relative": "Relative",
    "up": "Up a fifth",
    "down": "Down a fifth",
    "mode+": "Brighter mode",
    "mode-": "Darker mode",
    "shift": "Shift",
    "break": "Break",
}
MODULATIONS: Final = ("up", "down", "mode+", "mode-", "relative", "break")
#: Scores within this of the best are a tie the seed decides.
TIE: Final = 0.15

Track = dict[str, Any]


# --- scales and joins ----------------------------------------------------------


def scale(t: Track) -> tuple[int, str] | None:
    """(tonic pitch class, mode) of the track's whole reading, or None."""
    h = (t.get("harmony") or {}).get("track") or {}
    if h.get("tonic") in NAMES and h.get("mode") in SCALES:
        return NAMES.index(h["tonic"]), h["mode"]
    return None


def notes(s: tuple[int, str]) -> set[int]:
    return {(s[0] + d) % 12 for d in SCALES[s[1]]}


def join(a: Track, b: Track) -> str | None:
    """What the join a -> b is (§4.2), None when a key is unread.

    A modulation is a one-note swap between the two 7-note sets: sharpward is
    brighter (up a fifth, or a brighter mode on the same tonic).
    """
    sa, sb = scale(a), scale(b)
    if not (sa and sb):
        return None
    na, nb = notes(sa), notes(sb)
    shared = len(na & nb)
    if shared == 7:
        return "match" if sa[0] == sb[0] else "relative"
    if shared < SAFE_NOTES:
        return "break"
    dropped, added = next(iter(na - nb)), next(iter(nb - na))
    if (added - dropped) % 12 == 1:
        direction = "+"
    elif (dropped - added) % 12 == 1:
        direction = "-"
    else:
        return "shift"  # the harmonic-minor scales: safe, not a circle-of-fifths step
    if sa[0] == sb[0]:
        return "mode" + direction
    return "up" if direction == "+" else "down"


def fit(kind: str | None, want: str = "match") -> float:
    """How well join *kind* serves what the flow wants at this join, 0..1."""
    if kind is None:
        return 0.4  # unread key: neither a reason nor an objection
    if kind == want:
        return 1.0
    if kind == "break":
        return 0.0
    if want == "match":
        return 0.8 if kind == "relative" else 0.6
    if want == "break":
        return 0.2
    return 0.5 if kind == "match" else 0.6  # an event is pending


# --- layers ----------------------------------------------------------------------


def curve(points: list[list[float]], f: float) -> float:
    if f <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if f <= x1:
            return y0 + (y1 - y0) * (f - x0) / ((x1 - x0) or 1)
    return points[-1][1]


def block(blocks: list[dict[str, Any]] | None, f: float) -> dict[str, Any] | None:
    return next((b for b in blocks or [] if b["from"] <= f < b["to"]), None)


def energy(t: Track) -> float | None:
    e = (t.get("energyScale") or {}).get("track")
    return None if e is None else e / 100


def score(
    t: Track,
    prev: Track | None,
    layers: dict[str, Any],
    f: float,
    relax: set[str],
    event: str | None,
    pull: float,
) -> float | None:
    """The slot score of *t*, or None when it fails a must."""
    s = 0.0
    anything = "any" in relax
    if layers.get("tempo"):
        band = TEMPO_BAND * (8 / 3 if "tempo" in relax else 1)
        d = abs((t.get("bpm") or 0) - curve(layers["tempo"], f))
        if d > band and not anything:
            return None
        s += 1 - d / band
    if layers.get("energy"):
        band = ENERGY_BAND * (2 if "energy" in relax else 1)
        e = energy(t)
        d = abs((e if e is not None else 0.5) - curve(layers["energy"], f))
        if d > band and not anything:
            return None
        s += 1 - d / band
    if prev is not None and "harmony" in layers:
        s += pull * fit(join(prev, t), event or "match")
    g = block(layers.get("genre"), f)
    if g and g.get("genres") and "genre" not in relax:
        if t.get("genre") in g["genres"]:
            s += 1
        elif g.get("strict", "must") == "must":
            return None
    return s


# --- paths -------------------------------------------------------------------------


def spans(chunks: list[dict[str, Any]]) -> list[tuple[float, float, dict[str, Any]]]:
    total = sum(c["share"] for c in chunks) or 1
    out, acc = [], 0.0
    for c in chunks:
        out.append((acc / total, (acc + c["share"]) / total, c))
        acc += c["share"]
    return out


def _first_path(
    by: dict[str, dict[str, Any]], c: dict[str, Any]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while c.get("next") and by.get(c["next"][0]) not in out:
        c = by[c["next"][0]]
        out.append(c)
    return out


def resolve(
    flow: dict[str, Any], choices: dict[str, str], lib: list[Track], **opts: Any
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The chunks along the path; at an unchosen fork the generator takes the future it fills best."""
    by = {c["id"]: c for c in flow["chunks"]}
    out: list[dict[str, Any]] = []
    auto: dict[str, str] = {}
    c: dict[str, Any] | None = flow["chunks"][0] if flow["chunks"] else None
    while c and c not in out:
        out.append(c)
        nxt = [n for n in c.get("next") or [] if n in by]
        if not nxt:
            break
        if choices.get(c["id"]) in nxt:
            c = by[choices[c["id"]]]
        elif len(nxt) == 1:
            c = by[nxt[0]]
        else:

            def cost(cid: str) -> tuple[int, float]:
                trial = out + [by[cid]] + _first_path(by, by[cid])
                mix = render(trial, lib, **{**opts, "pins": {}})
                return (
                    sum(len(m["relaxed"]) for m in mix),
                    -sum(m["score"] for m in mix),
                )

            best = min(nxt, key=cost)
            auto[c["id"]] = best
            c = by[best]
    return out, auto


def render(
    chunks: list[dict[str, Any]],
    lib: list[Track],
    minutes: float = 60,
    seed: int = 1,
    pins: dict[int, str] | None = None,
    pull: float = PULL["strong"],
) -> list[dict[str, Any]]:
    """The mix: one entry per slot with the track, the join, the event served and what was relaxed."""
    pins = {int(k): v for k, v in (pins or {}).items()}
    sp = spans(chunks)
    rng = random.Random(seed)
    by_id = {t["id"]: t for t in lib}
    used = set(pins.values())
    done: set[str] = set()  # realised events, chunk id + index
    mix: list[dict[str, Any]] = []
    t, prev, i = 0.0, None, 0
    total = minutes * 60
    while t < total and sp:
        f = t / total
        a, b, c = next((s for s in sp if s[0] <= f < s[1]), sp[-1])
        layers = c.get("layers") or {}
        local = (f - a) / ((b - a) or 1)
        events = layers.get("harmony") or []
        ev_i = next(
            (
                k
                for k, e in enumerate(events)
                if e["at"] <= local and f"{c['id']}:{k}" not in done
            ),
            -1,
        )
        ev = events[ev_i] if ev_i >= 0 else None
        kind = ev["kind"] if ev else None
        if i in pins and pins[i] in by_id:
            pick = by_id[pins[i]]
            relaxed = ["pin"]
            got = score(pick, prev, layers, local, set(LADDER), kind, pull) or 0.0
        else:
            have = {k for k, v in layers.items() if v} | {"any"}
            steps = [x for x in LADDER if x in have]
            singles = [[x] for x in steps if x != "any"]
            prefixes = [steps[: k + 1] for k in range(len(steps))]
            pool: list[tuple[Track, float]] = []
            relaxed = []
            for rset in [[]] + singles + prefixes:
                relaxed = rset
                r = set(rset)
                pool = [
                    (x, sc)
                    for x in lib
                    if x["id"] not in used
                    and (sc := score(x, prev, layers, local, r, kind, pull)) is not None
                ]
                if pool:
                    break
            if not pool:
                break  # library exhausted
            pool.sort(key=lambda p: -p[1])
            top = [p for p in pool if p[1] >= pool[0][1] - TIE]
            pick, got = top[rng.randrange(len(top))]
            used.add(pick["id"])
        k = join(prev, pick) if prev else None
        realised = bool(ev) and k == kind
        if realised:
            done.add(f"{c['id']}:{ev_i}")
        mix.append(
            {
                "at": round(t, 2),
                "chunk": c["id"],
                "track_id": pick["id"],
                "score": round(got, 3),
                "join": k,
                "fit": round(fit(k, kind or "match"), 2)
                if prev and "harmony" in layers
                else None,
                "event": {**ev, "index": ev_i, "realised": realised} if ev else None,
                "relaxed": relaxed,
                "tempoT": round(curve(layers["tempo"], local), 1)
                if layers.get("tempo")
                else None,
                "energyT": round(curve(layers["energy"], local), 2)
                if layers.get("energy")
                else None,
            }
        )
        t += max(60.0, (pick.get("duration") or 240) - BLEND_S)
        prev = pick
        i += 1
    return mix


def read(tracks: list[Track]) -> dict[str, Any]:
    """A flow inferred from a hand list (§7): curves through its values, the modulations it makes."""
    n = max(1, len(tracks) - 1)
    tempo = [[k / n, float(t["bpm"])] for k, t in enumerate(tracks) if t.get("bpm")]
    en = [
        [k / n, round(energy(t), 2)]
        for k, t in enumerate(tracks)
        if energy(t) is not None
    ]
    events = [
        {"at": round(k / n, 3), "kind": kind}
        for k, (a, b) in enumerate(zip(tracks, tracks[1:]), start=1)
        if (kind := join(a, b)) in MODULATIONS
    ]
    layers: dict[str, Any] = {"harmony": events}
    if len(tempo) >= 2:
        layers["tempo"] = tempo
    if len(en) >= 2:
        layers["energy"] = en
    return {"chunks": [{"id": "all", "share": 1, "next": [], "layers": layers}]}
