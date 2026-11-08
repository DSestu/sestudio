"""How well one track follows another (harmony master plan E0.5), pure functions.

A *join* A -> B is explained by the notes the two scales share (out of 7), the
kind of move that makes, whether the mood brightens, the energy step from A's
outro to B's intro, a genre change and a tempo jump. Tracks are the analysis
dicts of :func:`sestudio.music.store.get` (``id``, ``bpm``, ``genre``,
``camelot``, ``harmony``, ``energyScale``). The frontend mirrors these rules in
``frontend/src/components/music/crates/proximity.ts``: keep both in step.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any, Final

from sestudio.music.modes import NAMES

#: Move kinds by id, with the label screens show.
KINDS: Final = {
    "same-key": "Same key",
    "pivot": "Same notes",
    "modal-shift": "One note changes",
    "next-door": "Next door",
    "transposed": "Transposed",
    "clash": "Clash",
}
#: Shared notes (of 7) from which a join counts as safe.
SAFE_NOTES: Final = 6
#: Largest tempo change inside one genre, as a share of A's tempo.
TEMPO_TOL: Final = 0.06
#: Energy points (0..100) within which an energy step "holds".
ENERGY_HOLD: Final = 8
#: Candidates tried at each step of a path; a search over the whole library
#: would be quadratic. shortcut: raise it if a bridge is missed in a big library.
BEAM: Final = 30

Track = dict[str, Any]
Join = dict[str, Any]


def _notes(t: Track) -> tuple[int, int, str] | None:
    """(tonic, note mask, mode) of the whole track's reading."""
    h = (t.get("harmony") or {}).get("track")
    if not h or h.get("tonic") not in NAMES:
        return None
    return (
        NAMES.index(h["tonic"]),
        sum(1 << NAMES.index(n) for n in h["notes"]),
        h.get("mode") or "",
    )


def semitones(a: int, b: int) -> int:
    """From tonic *a* to tonic *b*, the short way: -5..6 semitones."""
    d = (b - a) % 12
    return d - 12 if d > 6 else d


def _wheel(camelot: str | None) -> tuple[int, str] | None:
    s = camelot or ""
    return (int(s[:-1]), s[-1]) if s[:-1].isdigit() and s[-1] in "AB" else None


def _kind(shared: int, same_tonic: bool) -> str:
    if shared == 7:
        return "same-key" if same_tonic else "pivot"
    if shared == SAFE_NOTES:
        return "modal-shift" if same_tonic else "next-door"
    return "clash"


def transposition(a: Track, b: Track) -> int | None:
    """Semitones from *a*'s key to *b*'s when *b* is the same scale moved (same mode, another tonic, fewer than
    6 notes shared: 5 and 7 semitones share 6 and stay next door); None otherwise. Every one is a good join,
    in any mix. Camelot stands in when a track has no harmony yet: same letter, 2 to 6 steps (each a fifth)."""
    x, y = _notes(a), _notes(b)
    if x and y:
        if (
            x[2]
            and x[2] == y[2]
            and x[0] != y[0]
            and (x[1] & y[1]).bit_count() < SAFE_NOTES
        ):
            return semitones(x[0], y[0])
        return None
    p, q = _wheel(a.get("camelot")), _wheel(b.get("camelot"))
    if not (p and q) or p[1] != q[1]:
        return None
    d = semitones(0, (q[0] - p[0]) * 7 % 12)
    return d if abs(d) not in (0, 5) else None


def harmony(a: Track, b: Track) -> tuple[int | None, str | None]:
    """(shared notes, move kind) from the note sets; Camelot stands in when a track has no harmony yet."""
    x, y = _notes(a), _notes(b)
    if x and y:
        n = (x[1] & y[1]).bit_count()
        return n, "transposed" if transposition(a, b) is not None else _kind(
            n, x[0] == y[0]
        )
    p, q = _wheel(a.get("camelot")), _wheel(b.get("camelot"))
    if not (p and q):
        return None, None
    d = abs(p[0] - q[0])
    d = min(d, 12 - d)
    if d == 0:  # same number: same key, or the relative major/minor (same notes)
        return 7, "same-key" if p[1] == q[1] else "pivot"
    if d == 1 and p[1] == q[1]:
        return SAFE_NOTES, "next-door"
    return None, "transposed" if transposition(a, b) is not None else "clash"


def _edge(t: Track, which: str) -> float | None:
    s = t.get("energyScale") or {}
    return s.get(which, s.get("track"))


def join(a: Track, b: Track) -> Join:
    """Everything worth saying about the move from *a* to *b* (unknown facts are None)."""
    shared, kind = harmony(a, b)
    ba = ((a.get("harmony") or {}).get("track") or {}).get("brightness")
    bb = ((b.get("harmony") or {}).get("track") or {}).get("brightness")
    mood = (
        None
        if ba is None or bb is None
        else "brighter"
        if bb > ba
        else "darker"
        if bb < ba
        else "same"
    )
    ea, eb = _edge(a, "outro"), _edge(b, "intro")
    delta = None if ea is None or eb is None else eb - ea
    step = (
        None
        if delta is None
        else "lifts"
        if delta > ENERGY_HOLD
        else "eases off"
        if delta < -ENERGY_HOLD
        else "holds"
    )
    ga, gb = (a.get("genre") or "").lower(), (b.get("genre") or "").lower()
    pa, pb = a.get("bpm"), b.get("bpm")
    return {
        "shared": shared,
        "kind": kind,
        "kindLabel": KINDS.get(kind or ""),
        "safe": kind == "transposed" or (shared is not None and shared >= SAFE_NOTES),
        "semitones": transposition(a, b) if kind == "transposed" else None,
        "mood": mood,
        "energy": {"step": step, "delta": delta},
        "genreChange": bool(ga and gb and ga != gb),
        "bpmDelta": round(pb - pa, 1) if pa and pb else None,
        "tempoJump": bool(pa and pb and abs(pb - pa) > pa * TEMPO_TOL),
    }


def tempo_ok(j: Join) -> bool:
    """A tempo jump is only fine across a genre change."""
    return not j["tempoJump"] or j["genreChange"]


def cost(j: Join) -> float:
    """Lower is a better follow-up: notes first, then the tempo gap and the energy step."""
    # A transposition is a last resort: after every shared-notes move, just ahead of a clash.
    notes = (
        1.75
        if j["kind"] == "transposed"
        else 7 - j["shared"]
        if j["shared"] is not None
        else 4
    )
    return (
        notes * 3
        + min(abs(j["bpmDelta"] or 0) / 10, 2)
        + abs(j["energy"]["delta"] or 0) / 50
    )


def _passes(j: Join, t: Track, f: dict[str, Any]) -> bool:
    if f.get("harmony", "safe") == "safe" and not j["safe"]:
        return False
    if f.get("tempo", "near") == "near" and not tempo_ok(j):
        return False
    if (m := f.get("mood")) and j["mood"] != {
        "up": "brighter",
        "down": "darker",
        "same": "same",
    }[m]:
        return False
    if (e := f.get("energy")) and j["energy"]["step"] != {
        "lift": "lifts",
        "hold": "holds",
        "ease": "eases off",
    }[e]:
        return False
    g = (f.get("genre") or "any").lower()
    return (
        g == "any"
        or (g == "same" and not j["genreChange"])
        or g == (t.get("genre") or "").lower()
    )


def fits_after(
    track: Track,
    pool: list[Track],
    filters: dict[str, Any] | None = None,
    limit: int = 50,
    exclude: Collection[str] = (),
) -> list[dict[str, Any]]:
    """Tracks of *pool* that follow *track*, best first, each as ``{"id", "join"}``.

    Filters: ``harmony`` (``safe`` default, or ``any``), ``tempo`` (``near`` default,
    or ``any``), ``mood`` (``up``/``down``/``same``), ``energy`` (``lift``/``hold``/
    ``ease``), ``genre`` (``any`` default, ``same``, or a genre name).
    """
    f = filters or {}
    out = []
    for t in pool:
        if t["id"] == track["id"] or t["id"] in exclude:
            continue
        j = join(track, t)
        if _passes(j, t, f):
            out.append((cost(j), t["id"], j))
    out.sort(key=lambda r: r[:2])
    return [{"id": i, "join": j} for _, i, j in out[:limit]]


def bridges(
    a: Track,
    b: Track,
    pool: list[Track],
    limit: int = 10,
    exclude: Collection[str] = (),
) -> list[dict[str, Any]]:
    """Single tracks safe both after *a* and before *b*, the energy nearest between them first."""
    ea, eb = _edge(a, "outro"), _edge(b, "intro")
    mid = (ea + eb) / 2 if ea is not None and eb is not None else None
    skip = {a["id"], b["id"], *exclude}
    out = []
    for t in pool:
        if t["id"] in skip:
            continue
        j1, j2 = join(a, t), join(t, b)
        if all(j["safe"] and tempo_ok(j) for j in (j1, j2)):
            e = _edge(t, "track")
            far = abs(e - mid) if mid is not None and e is not None else 50
            out.append((far, cost(j1) + cost(j2), t["id"], j1, j2))
    out.sort(key=lambda r: r[:3])
    return [{"id": i, "before": j1, "after": j2} for _, _, i, j1, j2 in out[:limit]]


def bridge_path(
    a: Track, b: Track, pool: list[Track], steps: int = 3, exclude: Collection[str] = ()
) -> list[str] | None:
    """The fewest in-between track ids (at most *steps*) leading safely from *a* to *b*.

    ``[]`` when the join is already safe, None when no path exists.
    """
    skip = {a["id"], b["id"], *exclude}
    pool = [t for t in pool if t["id"] not in skip]

    def ok(x: Track, y: Track) -> bool:
        j = join(x, y)
        return j["safe"] and tempo_ok(j)

    def walk(cur: Track, left: int, seen: tuple[str, ...]) -> list[str] | None:
        if left == 0:
            return [] if ok(cur, b) else None
        near = sorted(
            (t for t in pool if t["id"] not in seen and ok(cur, t)),
            key=lambda t: (-(join(t, b)["shared"] or 0), cost(join(cur, t)), t["id"]),
        )
        for t in near[:BEAM]:
            rest = walk(t, left - 1, (*seen, t["id"]))
            if rest is not None:
                return [t["id"], *rest]
        return None

    for k in range(steps + 1):
        if (p := walk(a, k, ())) is not None:
            return p
    return None
