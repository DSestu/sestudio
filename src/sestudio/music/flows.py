"""Flow → mix generator (SPEC-music-flows §4–§6, SPEC-blend), pure functions.

A flow is ``chunks``, each with a ``share`` of the length, ``next`` chunk ids (two
or more = a fork) and ``layers``: ``energy`` as leans ``{"from", "to", "lean":
lift|hold|ease}``, ``start`` ``{"energy": 0..1, "tempo": bpm}`` (what the first track
is near), ``settings`` (``must|prefer|ignore`` per layer, see :mod:`blend`),
``harmony`` as a list of events ``{"at": fraction, "kind": up|down|mode+|mode-|relative|break}``
(every other join wants a match; no ``harmony`` key = free), ``genre`` as blocks
``{"from", "to", "genres", "strict": must|prefer}``, ``colour`` as blocks
``{"from", "to", "colour"}``: the key's colour a stretch keeps (bright, warm, dark, exotic).
Each track is picked for how well it blends with the one before (:func:`blend.blend`);
older flows with ``tempo`` / ``energy`` curves are read through :func:`upgrade`.

Tracks are the dicts of :func:`sestudio.music.store.get` (``id``, ``duration``,
``bpm``, ``genre``, ``harmony.track``, ``energyScale.track``). The scoring rules
live in :mod:`sestudio.music.blend`, mirrored in ``frontend/src/blend.ts``; the lab
in ``docs/proto/flows`` keeps the rules from before Blend.
"""

from __future__ import annotations

import random
from typing import Any, Final

from sestudio.music import blend as _blend
from sestudio.music.modes import BRIGHTNESS, NAMES, SCALES

BLEND_S: Final = 20.0  # shortcut: fixed overlap, the real plan() varies per pair
SAFE_NOTES: Final = 6
LEANS: Final = ("lift", "hold", "ease")
#: An old energy curve stretch rising more than this (0..1 scale) is a Lift, falling more an Ease.
SLOPE: Final = 0.1
#: A key's colour from its mode's brightness; the harmonic-minor modes have none and are exotic.
COLOURS: Final = ("bright", "warm", "dark", "exotic")
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
    "lift": "Lift",
    "lower": "Drop",
    "break": "Break",
}
MODULATIONS: Final = (
    "up",
    "down",
    "mode+",
    "mode-",
    "relative",
    "lift",
    "lower",
    "break",
)
#: Blend scores within this of the best are a tie the seed decides.
TIE: Final = 0.03
#: What a play may draw from (SPEC-flows-tab §2): ``{"kind", "value", "rule": only|lean}``.
SOURCE_KINDS: Final = ("library", "artist", "album", "genre")
#: What a Lean-on-it source adds to a slot's Blend score: about a genre match's share.
LEAN: Final = 0.12

Track = dict[str, Any]


def _norm(v: Any) -> str:
    return str(v or "").casefold().strip()


def matches(t: Track, src: dict[str, Any]) -> bool:
    return _norm(t.get(src["kind"])) == _norm(src.get("value"))


def scope(
    lib: list[Track], sources: list[dict[str, Any]] | None
) -> tuple[list[Track], dict[str, float], bool]:
    """What a play draws from: Only sources filter *lib* (same kind adds up, kinds narrow
    each other), Lean ones become a score bonus per track id. The flag says whether any
    Only source narrowed it."""
    srcs = [s for s in sources or [] if s.get("kind") in SOURCE_KINDS]
    only: dict[str, list[dict[str, Any]]] = {}
    for s in srcs:
        if s.get("rule", "only") == "only":
            only.setdefault(s["kind"], []).append(s)
    leans = [s for s in srcs if s.get("rule") == "lean"]
    out = [t for t in lib if all(any(matches(t, s) for s in g) for g in only.values())]
    lean = {t["id"]: n * LEAN for t in lib if (n := sum(matches(t, s) for s in leans))}
    return out, lean, bool(only)


def capacity(tracks: list[Track]) -> float:
    """Seconds of mix *tracks* can fill, each blended into the next as :func:`render` does."""
    return sum(max(60.0, (t.get("duration") or 240) - BLEND_S) for t in tracks)


def song(t: Track) -> tuple[str, str]:
    """The same song in two files (two ids) is one song: title + artist, case-folded."""
    title = _norm(t.get("title"))
    return (title, _norm(t.get("artist"))) if title else (t["id"], "")


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
    brighter (up a fifth, or a brighter mode on the same tonic). The same scale moved
    further (same mode, another tonic) is a lift (up to 6 semitones up) or a drop.
    """
    sa, sb = scale(a), scale(b)
    if not (sa and sb):
        return None
    na, nb = notes(sa), notes(sb)
    shared = len(na & nb)
    if shared == 7:
        return "match" if sa[0] == sb[0] else "relative"
    if shared < SAFE_NOTES:
        # The same scale moved up or down (any distance): a lift or a drop, never a break.
        if sa[1] == sb[1] and sa[0] != sb[0]:
            return "lift" if (sb[0] - sa[0]) % 12 <= 6 else "lower"
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
    if kind in ("lift", "lower"):
        return 0.3  # a transposition nobody asked for: a last resort, short of a break
    return 0.5 if kind == "match" else 0.6  # an event is pending


# --- layers ----------------------------------------------------------------------


def block(blocks: list[dict[str, Any]] | None, f: float) -> dict[str, Any] | None:
    return next((b for b in blocks or [] if b["from"] <= f < b["to"]), None)


def colour(t: Track) -> str | None:
    """bright (Lydian, Ionian), warm (Mixolydian, Dorian), dark (Aeolian, Phrygian, Locrian), exotic; None unread."""
    s = scale(t)
    if s is None:
        return None
    b = BRIGHTNESS.get(s[1])
    return (
        "exotic" if b is None else "bright" if b >= 2 else "warm" if b >= 0 else "dark"
    )


def energy(t: Track) -> float | None:
    e = (t.get("energyScale") or {}).get("track")
    return None if e is None else e / 100


def _leans(points: list[list[float]]) -> list[dict[str, Any]]:
    """An old energy curve as leans: each stretch by its slope, neighbours with the same lean merged."""
    out: list[dict[str, Any]] = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x1 <= x0:
            continue
        lean = "lift" if y1 - y0 > SLOPE else "ease" if y0 - y1 > SLOPE else "hold"
        if out and out[-1]["lean"] == lean:
            out[-1]["to"] = x1
        else:
            out.append({"from": x0, "to": x1, "lean": lean})
    return out


def _is_curve(v: Any) -> bool:
    return isinstance(v, list) and bool(v) and isinstance(v[0], list)


def upgrade(layers: dict[str, Any]) -> dict[str, Any]:
    """*layers* in the Blend shape; older curves become leans and a start (SPEC-blend §5). Idempotent."""
    out = dict(layers or {})
    start = dict(out.get("start") or {})
    if _is_curve(out.get("energy")):
        pts = out["energy"]
        start.setdefault("energy", pts[0][1])
        out["energy"] = _leans(pts)
    if _is_curve(out.get("tempo")):
        start.setdefault("tempo", out["tempo"][0][1])
    out.pop("tempo", None)
    if start:
        out["start"] = start
    settings = dict(out.get("settings") or {})
    if "harmony" not in out:
        settings.setdefault("harmony", "ignore")  # no harmony layer: free, as before
    if out.get("colour"):
        settings.setdefault("colour", "must")  # a colour block kept its colour strictly
    g = next((b for b in out.get("genre") or [] if b.get("genres")), None)
    if g:
        settings.setdefault("genre", g.get("strict", "must"))
    if settings:
        out["settings"] = settings
    return out


def upgrade_chunks(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**c, "layers": upgrade(c.get("layers") or {})} for c in chunks]


def score(
    t: Track,
    prev: Track | None,
    layers: dict[str, Any],
    f: float,
    event: str | None,
    pull: float = 0.0,
) -> dict[str, Any]:
    """The Blend of *t* after *prev* at *f* in a chunk (*layers* in the Blend shape).

    The first track has no *prev*: it is scored against the chunk's ``start`` (energy, tempo).
    *pull* at PULL["only"] or more makes harmony a Must.
    """
    settings = dict(layers.get("settings") or {})
    if pull >= PULL["only"]:
        settings.setdefault("harmony", "must")
    lean = (block(layers.get("energy"), f) or {}).get("lean", "hold")
    k = block(layers.get("colour"), f)
    g = block(layers.get("genre"), f)
    if prev is None:
        st = layers.get("start") or {}
        prev = {"id": "", "bpm": st.get("tempo")}
        if st.get("energy") is not None:
            prev["energyScale"] = {"track": 100 * st["energy"]}
        lean = "hold"
    return _blend.blend(
        prev,
        t,
        lean=lean,
        settings=settings,
        want=event or "match",
        colour=(k or {}).get("colour"),
        genres=(g or {}).get("genres") or None,
    )


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


def holds(cond: dict[str, Any], at_min: float, ctx: dict[str, Any]) -> bool:
    """Whether a branch condition (§5) holds when the fork is reached, *at_min* minutes into the mix.

    *ctx*: ``skips`` (recent tracks, True = skipped, oldest first), ``clock`` (minutes after
    midnight when the mix started). Session length is the mix's own time.
    """
    kind = cond.get("kind")
    if kind == "skips":
        recent = list(ctx.get("skips") or [])[-int(cond.get("of", 4)) :]
        return sum(recent) >= int(cond.get("count", 2))
    if kind == "session":
        return at_min >= float(cond.get("minutes", 60))
    if kind == "time":
        h, _, m = str(cond.get("after", "23:00")).partition(":")
        after = int(h) * 60 + int(m or 0)
        start = float(ctx.get("clock", 0))
        # "after 23:00" on a mix started at 22:30 is 30 min in; one started at 23:30 holds at once,
        # unless the hour is far behind (before 06:00 counts as the same night).
        if after < start and start - after > 18 * 60:
            after += 24 * 60
        return start + at_min >= after
    return False


def resolve(
    flow: dict[str, Any],
    choices: dict[str, str],
    lib: list[Track],
    context: dict[str, Any] | None = None,
    **opts: Any,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The chunks along the path.

    At a fork: the listener's choice, else the first future whose condition holds
    (``when`` on the forking chunk, §5), else the future the generator fills best.
    """
    by = {c["id"]: c for c in upgrade_chunks(flow["chunks"])}
    out: list[dict[str, Any]] = []
    auto: dict[str, str] = {}
    c: dict[str, Any] | None = by[flow["chunks"][0]["id"]] if flow["chunks"] else None
    while c and c not in out:
        out.append(c)
        nxt = [n for n in c.get("next") or [] if n in by]
        if not nxt:
            break
        when = c.get("when") or {}
        done = sum(x["share"] for x in out)

        def at_min(cid: str) -> float:
            trial = out + [by[cid]] + _first_path(by, by[cid])
            return (
                done / (sum(x["share"] for x in trial) or 1) * opts.get("minutes", 60)
            )

        met = [
            n
            for n in nxt
            if context is not None and n in when and holds(when[n], at_min(n), context)
        ]
        if choices.get(c["id"]) in nxt:
            c = by[choices[c["id"]]]
        elif len(nxt) == 1:
            c = by[nxt[0]]
        elif met:
            auto[c["id"]] = met[0]
            c = by[met[0]]
        else:

            def cost(cid: str) -> tuple[int, float]:
                trial = out + [by[cid]] + _first_path(by, by[cid])
                mix = render(trial, lib, **{**opts, "pins": {}})
                return (
                    sum(m["blend"]["blocked"] for m in mix),
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
    lean: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """The mix: one entry per slot with the track, its Blend, the join and the event served.

    *lean*: a score bonus per track id (Lean-on-it sources). A song is never played twice,
    even from two files. A track a Must blocks is only played when nothing else is left,
    so a mix never stops short while the library has tracks.
    """
    pins = {int(k): v for k, v in (pins or {}).items()}
    lean = lean or {}
    sp = spans(upgrade_chunks(chunks))
    rng = random.Random(seed)
    by_id = {t["id"]: t for t in lib}
    used = set(pins.values())
    songs = {song(by_id[p]) for p in used if p in by_id}
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
        pinned = i in pins and pins[i] in by_id
        if pinned:
            pick = by_id[pins[i]]
            bl = score(pick, prev, layers, local, kind, pull)
            got = bl["score"]
        else:
            scored = [
                (x, bl, bl["score"] + lean.get(x["id"], 0.0))
                for x in lib
                if x["id"] not in used
                and song(x) not in songs
                and (bl := score(x, prev, layers, local, kind, pull))
            ]
            if not scored:
                break  # library exhausted
            pool = [p for p in scored if not p[1]["blocked"]] or scored
            pool.sort(key=lambda p: -p[2])
            top = [p for p in pool if p[2] >= pool[0][2] - TIE]
            pick, bl, got = top[rng.randrange(len(top))]
            used.add(pick["id"])
            songs.add(song(pick))
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
                # The first track is scored against the chunk's start: no join, but blocked still says.
                "blend": {
                    key: bl[key] for key in ("score", "parts", "steps", "blocked")
                },
                "lean": (block(layers.get("energy"), local) or {}).get("lean", "hold"),
                **({"pinned": True} if pinned else {}),
            }
        )
        t += max(60.0, (pick.get("duration") or 240) - BLEND_S)
        prev = pick
        i += 1
    return mix


def fits(layers: dict[str, Any], a: float, b: float, lib: list[Track]) -> list[Track]:
    """The tracks no Must keeps out somewhere in [a, b) (a colour or genre block): what a stretch can draw on."""
    layers = upgrade(layers)
    probe = [a + (b - a) * x for x in (0.02, 0.5, 0.98)]
    return [
        t
        for t in lib
        if any(not score(t, None, layers, f, None)["blocked"] for f in probe)
    ]


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
    return {
        "chunks": [{"id": "all", "share": 1, "next": [], "layers": upgrade(layers)}]
    }
