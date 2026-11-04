"""Mix-builder flows: draft mixes and branches kept between sessions and devices.

One row each in ``music_flows``. A flow is only a list of track refs (plus the
fork point and base set of a branch); it never owns tracks or sets, so deleting
one touches nothing else. ``to_set`` copies it into a new playlist.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sestudio import library
from sestudio.music import playlists
from sestudio.music.playlists import Invalid

MODES = ("mix", "branch")


def _node(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "mode": row["mode"],
        "position": row["position"],
        **json.loads(row["data"]),
    }


def _row(conn: Any, flow_id: str) -> Any:
    row = conn.execute("SELECT * FROM music_flows WHERE id = ?", (flow_id,)).fetchone()
    if row is None:
        raise Invalid(f"unknown flow {flow_id}")
    return row


def _save(conn: Any, flow: dict[str, Any]) -> None:
    data = {k: flow[k] for k in ("fork", "base", "items")}
    conn.execute(
        "UPDATE music_flows SET name = ?, data = ? WHERE id = ?",
        (flow["name"], json.dumps(data), flow["id"]),
    )


def list_all() -> list[dict[str, Any]]:
    with library._lock:
        rows = library._connect().execute(
            "SELECT * FROM music_flows ORDER BY position, rowid"
        )
        return [_node(r) for r in rows]


def get(flow_id: str) -> dict[str, Any]:
    with library._lock:
        return _node(_row(library._connect(), flow_id))


def _name(name: str) -> str:
    name = name.strip()
    if not name:
        raise Invalid("a name is required")
    return name


def _check_base(conn: Any, base: str | None) -> None:
    if base is not None and playlists._row(conn, base)["kind"] != "playlist":
        raise Invalid("base must be a set")


def create(
    name: str,
    mode: str = "mix",
    fork: dict[str, Any] | None = None,
    base: str | None = None,
    items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if mode not in MODES:
        raise Invalid("mode must be mix or branch")
    name = _name(name)
    flow_id = uuid.uuid4().hex[:10]
    with library._lock:
        conn = library._connect()
        _check_base(conn, base)
        (position,) = conn.execute(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM music_flows"
        ).fetchone()
        conn.execute(
            "INSERT INTO music_flows (id, name, mode, position, data) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                flow_id,
                name,
                mode,
                position,
                json.dumps({"fork": fork, "base": base, "items": items or []}),
            ),
        )
        conn.commit()
        return _node(_row(conn, flow_id))


def update(flow_id: str, **fields: Any) -> dict[str, Any]:
    """Change the name, fork, base or whole item list (only the keys given)."""
    with library._lock:
        conn = library._connect()
        flow = _node(_row(conn, flow_id))
        if "name" in fields:
            flow["name"] = _name(fields["name"])
        if "base" in fields:
            _check_base(conn, fields["base"])
        for key in ("fork", "base", "items"):
            if key in fields:
                flow[key] = fields[key]
        _save(conn, flow)
        conn.commit()
        return flow


def delete(flow_id: str) -> None:
    with library._lock:
        conn = library._connect()
        _row(conn, flow_id)
        conn.execute("DELETE FROM music_flows WHERE id = ?", (flow_id,))
        conn.commit()


def to_set(
    flow_id: str, name: str | None = None, parent: str | None = None
) -> dict[str, Any]:
    """A new set holding the flow's tracks; the flow is left as it is."""
    flow = get(flow_id)
    node = playlists.create("playlist", name or flow["name"], parent)
    if flow["items"]:
        node = playlists.add_items(node["id"], flow["items"])
    return node
