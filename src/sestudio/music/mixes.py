"""Flows and mixes on disk (SPEC-music-flows §7, §8, §12 PR 1).

One row per flow in ``music_flows`` and per mix in ``music_mixes``; ``data`` is
the JSON document. A mix is live (flow id, path choices, length, seed, pins) or
frozen (its ``tracks`` list fixed, lineage kept read-only).
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sestudio import library
from sestudio.music import flows


class Invalid(ValueError):
    """The request names something that does not exist or cannot be done."""


#: The starter library (§8); seeded once, when there is no flow at all.
PRESETS: tuple[dict[str, Any], ...] = (
    {
        "name": "Warm-up",
        "chunks": [
            {
                "id": "warm-up",
                "share": 1,
                "next": [],
                "layers": {
                    "tempo": [[0, 170], [1, 172]],
                    "energy": [[0, 0.2], [1, 0.5]],
                    "harmony": [],
                },
            }
        ],
    },
    {
        "name": "Peak",
        "chunks": [
            {
                "id": "peak",
                "share": 1,
                "next": [],
                "layers": {
                    "tempo": [[0, 172], [1, 175]],
                    "energy": [[0, 0.65], [1, 0.95]],
                    "harmony": [{"at": 0.5, "kind": "up"}],
                },
            }
        ],
    },
    {
        "name": "Plateau",
        "chunks": [
            {
                "id": "plateau",
                "share": 1,
                "next": [],
                "layers": {
                    "tempo": [[0, 172], [1, 172]],
                    "energy": [[0, 0.55], [1, 0.55]],
                    "harmony": [],
                },
            }
        ],
    },
    {
        "name": "Deep",
        "chunks": [
            {
                "id": "deep",
                "share": 1,
                "next": [],
                "layers": {
                    "energy": [[0, 0.35], [1, 0.45]],
                    "harmony": [{"at": 0.5, "kind": "mode-"}],
                },
            }
        ],
    },
    {
        "name": "Come-down",
        "chunks": [
            {
                "id": "come-down",
                "share": 1,
                "next": [],
                "layers": {
                    "tempo": [[0, 172], [1, 145]],
                    "energy": [[0, 0.6], [1, 0.15]],
                    "harmony": [
                        {"at": 0, "kind": "break"},
                        {"at": 0.5, "kind": "relative"},
                    ],
                },
            }
        ],
    },
)
LENGTHS = {"30": 30, "60": 60, "120": 120, "endless": None}
#: What a fork may wait for (§5): skips in the last tracks, minutes into the mix, a clock time.
CONDITIONS = ("skips", "session", "time")


def _new_id() -> str:
    return uuid.uuid4().hex[:10]


def _row(table: str, row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "created": row["created"],
        **json.loads(row["data"]),
    }


def _data(doc: dict[str, Any]) -> str:
    return json.dumps(
        {k: v for k, v in doc.items() if k not in ("id", "name", "created")}
    )


# --- flows ----------------------------------------------------------------------


def clean_flow(raw: dict[str, Any]) -> dict[str, Any]:
    """A flow with only the known fields; raises Invalid on a broken shape."""
    chunks = raw.get("chunks") or []
    if not isinstance(chunks, list) or not chunks:
        raise Invalid("a flow needs at least one chunk")
    ids = set()
    out = []
    for c in chunks:
        cid = str(c.get("id") or "").strip()
        if not cid or cid in ids:
            raise Invalid("every chunk needs its own id")
        ids.add(cid)
        layers = c.get("layers") or {}
        if not isinstance(layers, dict):
            raise Invalid(f"chunk {cid}: layers must be an object")
        for k in ("tempo", "energy"):
            pts = layers.get(k)
            if pts is not None and not (
                isinstance(pts, list)
                and len(pts) >= 2
                and all(isinstance(p, list) and len(p) == 2 for p in pts)
            ):
                raise Invalid(
                    f"chunk {cid}: {k} must be two or more [fraction, value] points"
                )
        for e in layers.get("harmony") or []:
            if e.get("kind") not in flows.MODULATIONS:
                raise Invalid(f"chunk {cid}: unknown harmony event {e.get('kind')!r}")
        when = c.get("when") or {}
        for cond in when.values():
            if cond.get("kind") not in CONDITIONS:
                raise Invalid(f"chunk {cid}: unknown condition {cond.get('kind')!r}")
        out.append(
            {
                "id": cid,
                "share": max(0.05, float(c.get("share") or 1)),
                "next": [str(n) for n in c.get("next") or []],
                "layers": layers,
                **({"when": {str(k): v for k, v in when.items()}} if when else {}),
            }
        )
    for c in out:
        if any(n not in ids for n in [*c["next"], *c.get("when", {})]):
            raise Invalid(f"chunk {c['id']}: next names an unknown chunk")
    pull = raw.get("pull") or "strong"
    if pull not in flows.PULL:
        raise Invalid(f"unknown pull {pull!r}")
    return {
        "chunks": out,
        "pull": pull,
        "length": raw.get("length") if raw.get("length") in LENGTHS else "endless",
        "allowOnline": bool(raw.get("allowOnline")),
        "preset": bool(raw.get("preset")),
    }


def flows_list() -> list[dict[str, Any]]:
    with library._lock:
        conn = library._connect()
        if not conn.execute("SELECT 1 FROM music_flows LIMIT 1").fetchone():
            for p in PRESETS:
                _insert(
                    conn, "music_flows", p["name"], {**clean_flow(p), "preset": True}
                )
            conn.commit()
        rows = conn.execute(
            "SELECT * FROM music_flows ORDER BY created DESC, rowid DESC"
        ).fetchall()
    return [_row("music_flows", r) for r in rows]


def _insert(conn: Any, table: str, name: str, doc: dict[str, Any]) -> dict[str, Any]:
    fid = _new_id()
    created = int(time.time())
    conn.execute(
        f"INSERT INTO {table} (id, name, created, data) VALUES (?, ?, ?, ?)",
        (fid, name, created, _data(doc)),
    )
    return {"id": fid, "name": name, "created": created, **doc}


def _get(conn: Any, table: str, fid: str) -> dict[str, Any]:
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (fid,)).fetchone()
    if row is None:
        raise Invalid(f"unknown {table[6:-1]} {fid}")
    return _row(table, row)


def flow_get(fid: str) -> dict[str, Any]:
    with library._lock:
        return _get(library._connect(), "music_flows", fid)


def flow_create(name: str, raw: dict[str, Any]) -> dict[str, Any]:
    doc = clean_flow(raw)
    with library._lock:
        conn = library._connect()
        out = _insert(conn, "music_flows", name.strip() or "Flow", doc)
        conn.commit()
    return out


def flow_update(
    fid: str, name: str | None, raw: dict[str, Any] | None
) -> dict[str, Any]:
    with library._lock:
        conn = library._connect()
        cur = _get(conn, "music_flows", fid)
        doc = {**cur, **(clean_flow({**cur, **raw}) if raw is not None else {})}
        doc["name"] = name.strip() if name and name.strip() else cur["name"]
        conn.execute(
            "UPDATE music_flows SET name = ?, data = ? WHERE id = ?",
            (doc["name"], _data(doc), fid),
        )
        conn.commit()
    return doc


def flow_delete(fid: str) -> None:
    with library._lock:
        conn = library._connect()
        _get(conn, "music_flows", fid)
        conn.execute("DELETE FROM music_flows WHERE id = ?", (fid,))
        conn.commit()


# --- mixes ------------------------------------------------------------------------


def mixes_list() -> list[dict[str, Any]]:
    with library._lock:
        rows = (
            library._connect()
            .execute("SELECT * FROM music_mixes ORDER BY created DESC, rowid DESC")
            .fetchall()
        )
    return [_row("music_mixes", r) for r in rows]


def mix_get(mid: str) -> dict[str, Any]:
    with library._lock:
        return _get(library._connect(), "music_mixes", mid)


def mix_create(
    name: str,
    flow_id: str | None,
    choices: dict[str, str] | None = None,
    minutes: float | None = None,
    seed: int = 1,
    pins: dict[str, str] | None = None,
    tracks: list[str] | None = None,
) -> dict[str, Any]:
    """A live mix on *flow_id*; with *tracks* and no flow, a hand list read as a flow with every track pinned (§7)."""
    with library._lock:
        conn = library._connect()
        if flow_id:
            _get(conn, "music_flows", flow_id)
        doc = {
            "flow": flow_id,
            "choices": choices or {},
            "minutes": minutes,
            "seed": int(seed),
            "pins": {str(k): v for k, v in (pins or {}).items()},
            "frozen": None,
        }
        if tracks is not None and not flow_id:
            doc["pins"] = {str(i): t for i, t in enumerate(tracks)}
            doc["frozen"] = list(tracks)  # frozen until a flow is read from it
        out = _insert(conn, "music_mixes", name.strip() or "Mix", doc)
        conn.commit()
    return out


def mix_update(mid: str, **fields: Any) -> dict[str, Any]:
    allowed = {"name", "choices", "minutes", "seed", "pins", "frozen", "flow"}
    with library._lock:
        conn = library._connect()
        doc = _get(conn, "music_mixes", mid)
        for k, v in fields.items():
            if k in allowed and v is not ...:
                doc[k] = {str(a): b for a, b in v.items()} if k == "pins" and v else v
        conn.execute(
            "UPDATE music_mixes SET name = ?, data = ? WHERE id = ?",
            (doc["name"], _data(doc), mid),
        )
        conn.commit()
    return doc


def mix_delete(mid: str) -> None:
    with library._lock:
        conn = library._connect()
        _get(conn, "music_mixes", mid)
        conn.execute("DELETE FROM music_mixes WHERE id = ?", (mid,))
        conn.commit()


# --- rendering -------------------------------------------------------------------


def render_flow(
    flow: dict[str, Any],
    lib: list[dict[str, Any]],
    choices: dict[str, str] | None = None,
    minutes: float | None = None,
    seed: int = 1,
    pins: dict[str, str] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The path and the mix of *flow* over *lib* (§6). Endless renders two hours.

    *context* (skips, clock) lets a fork's conditions decide; without it they are ignored.
    """
    mins = minutes or LENGTHS.get(str(flow.get("length"))) or 120
    pull = flows.PULL[flow.get("pull") or "strong"]
    path, auto = flows.resolve(
        flow, choices or {}, lib, context, minutes=mins, seed=seed, pull=pull
    )
    mix = flows.render(path, lib, minutes=mins, seed=seed, pins=pins, pull=pull)
    return {"path": [c["id"] for c in path], "auto": auto, "minutes": mins, "mix": mix}


def render_mix(mix: dict[str, Any], lib: list[dict[str, Any]]) -> dict[str, Any]:
    """A frozen mix is its tracks; a live one is rendered from its flow with its pins."""
    if mix.get("frozen") is not None:
        return {
            "path": [],
            "auto": {},
            "minutes": mix.get("minutes"),
            "frozen": True,
            "mix": [{"track_id": t, "relaxed": ["frozen"]} for t in mix["frozen"]],
        }
    flow = flow_get(mix["flow"])
    return render_flow(
        flow,
        lib,
        mix.get("choices"),
        mix.get("minutes"),
        mix.get("seed", 1),
        mix.get("pins"),
    )


def read_as_flow(mid: str, name: str, lib: list[dict[str, Any]]) -> dict[str, Any]:
    """Give a hand list its flow: inferred from its tracks, every track pinned, then live (§7)."""
    mix = mix_get(mid)
    tracks_ids = mix.get("frozen") or [
        mix["pins"][k] for k in sorted(mix.get("pins") or {}, key=int)
    ]
    by = {t["id"]: t for t in lib}
    tracks = [by[t] for t in tracks_ids if t in by]
    if not tracks:
        raise Invalid("no analysed track to read")
    flow = flow_create(name, flows.read(tracks))
    return mix_update(
        mid,
        flow=flow["id"],
        frozen=None,
        pins={str(i): t for i, t in enumerate(tracks_ids)},
    )
