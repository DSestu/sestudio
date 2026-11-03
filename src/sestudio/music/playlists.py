"""Music playlists as a tree (SPEC-music §13.2).

Nodes are folders, playlists and smart lists, one row each in
``music_playlists`` (``parent`` + ``position`` give the tree, ``data`` is a JSON
document). A playlist holds cross-source items (the queue's item shape, with
stored metadata for online ones); a playlist with ``parts`` is a set and keeps
its items inside the parts. A smart list holds rules, evaluated against the
library and its analysis when asked.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sestudio import library

KINDS = ("folder", "playlist", "smart")
DAY = 86400


class Invalid(ValueError):
    """The request names something that does not exist or cannot be done."""


def _new_id() -> str:
    return uuid.uuid4().hex[:10]


def _empty(kind: str, rules: dict[str, Any] | None) -> dict[str, Any]:
    if kind == "playlist":
        return {"items": [], "parts": [], "next": 1}
    if kind == "smart":
        return {"rules": clean_rules(rules or {})}
    return {}


def clean_rules(raw: dict[str, Any]) -> dict[str, Any]:
    """Rules with only the known fields, typed."""

    def num(key: str) -> float | None:
        v = raw.get(key)
        return None if v in (None, "") else float(v)

    return {
        "genres": [str(g).strip() for g in raw.get("genres") or [] if str(g).strip()],
        "bpm_min": num("bpm_min"),
        "bpm_max": num("bpm_max"),
        "added_days": num("added_days"),
        "never_played": bool(raw.get("never_played")),
    }


def _node(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "parent": row["parent"],
        "kind": row["kind"],
        "name": row["name"],
        "position": row["position"],
        **json.loads(row["data"]),
    }


def _row(conn: Any, node_id: str) -> Any:
    row = conn.execute(
        "SELECT * FROM music_playlists WHERE id = ?", (node_id,)
    ).fetchone()
    if row is None:
        raise Invalid(f"unknown node {node_id}")
    return row


def _save(conn: Any, node: dict[str, Any]) -> None:
    data = {
        k: v
        for k, v in node.items()
        if k not in ("id", "parent", "kind", "name", "position")
    }
    conn.execute(
        "UPDATE music_playlists SET name = ?, data = ? WHERE id = ?",
        (node["name"], json.dumps(data), node["id"]),
    )


def _siblings(conn: Any, parent: str | None) -> list[str]:
    rows = conn.execute(
        "SELECT id FROM music_playlists WHERE parent IS ? ORDER BY position, rowid",
        (parent,),
    ).fetchall()
    return [r["id"] for r in rows]


def _place(conn: Any, node_id: str, parent: str | None, index: int | None) -> None:
    """Put the node at *index* among *parent*'s children and renumber them."""
    ids = [i for i in _siblings(conn, parent) if i != node_id]
    at = len(ids) if index is None else max(0, min(index, len(ids)))
    ids.insert(at, node_id)
    conn.execute(
        "UPDATE music_playlists SET parent = ? WHERE id = ?", (parent, node_id)
    )
    for pos, i in enumerate(ids):
        conn.execute("UPDATE music_playlists SET position = ? WHERE id = ?", (pos, i))


def _check_parent(conn: Any, kind: str, parent: str | None) -> None:
    if parent is None:
        return
    if _row(conn, parent)["kind"] != "folder":
        raise Invalid("only a folder can hold other nodes")


def _name(name: str) -> str:
    name = name.strip()
    if not name:
        raise Invalid("a name is required")
    return name


def tree() -> list[dict[str, Any]]:
    """Every node, parents before their children's order, ready to nest."""
    with library._lock:
        rows = library._connect().execute(
            "SELECT * FROM music_playlists ORDER BY position, rowid"
        )
        return [_node(r) for r in rows]


def get(node_id: str) -> dict[str, Any]:
    with library._lock:
        return _node(_row(library._connect(), node_id))


def create(
    kind: str,
    name: str,
    parent: str | None = None,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if kind not in KINDS:
        raise Invalid("kind must be folder, playlist or smart")
    name = _name(name)
    with library._lock:
        conn = library._connect()
        _check_parent(conn, kind, parent)
        node_id = _new_id()
        conn.execute(
            "INSERT INTO music_playlists (id, parent, kind, name, position, data) "
            "VALUES (?, ?, ?, ?, 0, ?)",
            (node_id, parent, kind, name, json.dumps(_empty(kind, rules))),
        )
        _place(conn, node_id, parent, None)
        conn.commit()
        return _node(_row(conn, node_id))


def update(
    node_id: str,
    name: str | None = None,
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with library._lock:
        conn = library._connect()
        node = _node(_row(conn, node_id))
        if name is not None:
            node["name"] = _name(name)
        if rules is not None:
            if node["kind"] != "smart":
                raise Invalid("only a smart list has rules")
            node["rules"] = clean_rules(rules)
        _save(conn, node)
        conn.commit()
        return node


def move(node_id: str, parent: str | None, index: int | None = None) -> None:
    """Move a node under *parent* (None: the top) at *index*."""
    with library._lock:
        conn = library._connect()
        node = _row(conn, node_id)
        _check_parent(conn, node["kind"], parent)
        up = parent
        while up is not None:  # a folder cannot go into itself or its own subtree
            if up == node_id:
                raise Invalid("a folder cannot move into itself")
            up = _row(conn, up)["parent"]
        _place(conn, node_id, parent, index)
        conn.commit()


def delete(node_id: str) -> None:
    """Delete a node and everything under it."""
    with library._lock:
        conn = library._connect()
        _row(conn, node_id)
        doomed, todo = [], [node_id]
        while todo:
            cur = todo.pop()
            doomed.append(cur)
            todo += [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM music_playlists WHERE parent = ?", (cur,)
                )
            ]
        conn.executemany(
            "DELETE FROM music_playlists WHERE id = ?", [(d,) for d in doomed]
        )
        conn.commit()


# --- items and parts --------------------------------------------------------


def _playlist(conn: Any, node_id: str) -> dict[str, Any]:
    node = _node(_row(conn, node_id))
    if node["kind"] != "playlist":
        raise Invalid("not a playlist")
    return node


def _bucket(node: dict[str, Any], part: str | None) -> list[dict[str, Any]]:
    """The item list of a part, or of the playlist itself."""
    if part is None:
        if node["parts"]:
            return node["parts"][-1]["items"]  # a set: the end of the last part
        return node["items"]
    for p in node["parts"]:
        if p["id"] == part:
            return p["items"]
    raise Invalid(f"unknown part {part}")


def _locate(node: dict[str, Any], item_id: str) -> list[dict[str, Any]]:
    for items in [node["items"], *(p["items"] for p in node["parts"])]:
        if any(i["item_id"] == item_id for i in items):
            return items
    raise Invalid(f"unknown item {item_id}")


def _mutate(node_id: str, change: Any) -> dict[str, Any]:
    with library._lock:
        conn = library._connect()
        node = _playlist(conn, node_id)
        change(node)
        _save(conn, node)
        conn.commit()
        return node


def add_items(
    node_id: str,
    tracks: list[dict[str, Any]],
    part: str | None = None,
    index: int | None = None,
) -> dict[str, Any]:
    if not tracks:
        raise Invalid("no tracks")

    def change(node: dict[str, Any]) -> None:
        items = _bucket(node, part)
        new = []
        for t in tracks:
            new.append({**t, "item_id": f"p{node['next']}"})
            node["next"] += 1
        at = len(items) if index is None else max(0, min(index, len(items)))
        items[at:at] = new

    return _mutate(node_id, change)


def remove_item(node_id: str, item_id: str) -> dict[str, Any]:
    def change(node: dict[str, Any]) -> None:
        items = _locate(node, item_id)
        items[:] = [i for i in items if i["item_id"] != item_id]

    return _mutate(node_id, change)


def move_item(
    node_id: str, item_id: str, index: int, part: str | None = None
) -> dict[str, Any]:
    """Move an item to *index* of *part* (default: the part it is in)."""

    def change(node: dict[str, Any]) -> None:
        src = _locate(node, item_id)
        dest = src if part is None else _bucket(node, part)
        item = next(i for i in src if i["item_id"] == item_id)
        src.remove(item)
        at = max(0, min(index, len(dest)))
        dest.insert(at, item)

    return _mutate(node_id, change)


def reorder(
    node_id: str, order: list[str], part: str | None = None, whole: bool = False
) -> dict[str, Any]:
    """Put the items of *part* (default: the loose list) in the order of *order*, a permutation of their ids.

    With *whole*, *order* covers every item of the playlist and is dealt back
    into the loose list and the parts, each keeping its size.
    """

    def change(node: dict[str, Any]) -> None:
        buckets = (
            [node["items"], *(p["items"] for p in node["parts"])]
            if whole
            else [node["items"] if part is None else _bucket(node, part)]
        )
        by_id = {i["item_id"]: i for b in buckets for i in b}
        if len(order) != len(by_id) or set(order) != set(by_id):
            raise Invalid("order must list exactly the items it covers")
        at = 0
        for b in buckets:
            b[:] = [by_id[i] for i in order[at : at + len(b)]]
            at += len(b)

    return _mutate(node_id, change)


def add_part(node_id: str, name: str) -> dict[str, Any]:
    name = _name(name)

    def change(node: dict[str, Any]) -> None:
        if not node["parts"]:  # the first part adopts the loose items
            node["parts"] = [
                {"id": f"s{node['next']}", "name": "Part 1", "items": node["items"]}
            ]
            node["next"] += 1
            node["items"] = []
        node["parts"].append({"id": f"s{node['next']}", "name": name, "items": []})
        node["next"] += 1

    return _mutate(node_id, change)


def _part_index(node: dict[str, Any], part: str) -> int:
    for i, p in enumerate(node["parts"]):
        if p["id"] == part:
            return i
    raise Invalid(f"unknown part {part}")


def update_part(
    node_id: str, part: str, name: str | None = None, index: int | None = None
) -> dict[str, Any]:
    def change(node: dict[str, Any]) -> None:
        i = _part_index(node, part)
        if name is not None:
            node["parts"][i]["name"] = _name(name)
        if index is not None:
            node["parts"].insert(
                max(0, min(index, len(node["parts"]) - 1)), node["parts"].pop(i)
            )

    return _mutate(node_id, change)


def delete_part(node_id: str, part: str) -> dict[str, Any]:
    """Remove a part; its tracks join the previous part (or the next, or the
    plain playlist when it was the only one)."""

    def change(node: dict[str, Any]) -> None:
        parts = node["parts"]
        i = _part_index(node, part)
        gone = parts.pop(i)
        if i > 0:
            parts[i - 1]["items"] += gone["items"]
        elif parts:  # the first part: its tracks lead the next one
            parts[0]["items"] = gone["items"] + parts[0]["items"]
        else:
            node["items"] = gone["items"]

    return _mutate(node_id, change)


def flat_items(node: dict[str, Any], part: str | None = None) -> list[dict[str, Any]]:
    """The track refs of a playlist (or one part) in play order."""
    if part is not None:
        return [*_bucket(node, part)]
    return [*node["items"], *(i for p in node["parts"] for i in p["items"])]


# --- smart lists ------------------------------------------------------------


def matches(
    rules: dict[str, Any],
    track: dict[str, Any],
    now: float,
) -> bool:
    """Whether a track (``mtime``, ``bpm``, ``genre``, ``played``) fits the rules."""
    genres = {g.lower() for g in rules.get("genres") or []}
    if genres and (track.get("genre") or "").lower() not in genres:
        return False
    bpm = track.get("bpm")
    if rules.get("bpm_min") is not None or rules.get("bpm_max") is not None:
        if bpm is None:
            return False
        if rules.get("bpm_min") is not None and bpm < rules["bpm_min"]:
            return False
        if rules.get("bpm_max") is not None and bpm > rules["bpm_max"]:
            return False
    days = rules.get("added_days")
    if days is not None and track["mtime"] < now - days * DAY:
        return False
    return not (rules.get("never_played") and track.get("played"))


def evaluate(
    rules: dict[str, Any], candidates: list[dict[str, Any]], now: float | None = None
) -> list[dict[str, str]]:
    """The library tracks (``{track_id, mtime}``) fitting *rules*, as refs.

    Genre and tempo come from the analysis, played-ness from ``music_plays``.
    """
    now = time.time() if now is None else now
    ids = [c["track_id"] for c in candidates]
    info: dict[str, dict[str, Any]] = {}
    played: set[str] = set()
    with library._lock:
        conn = library._connect()
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            marks = ",".join("?" * len(chunk))
            for r in conn.execute(
                f"SELECT track_id, bpm, extra FROM music_analysis WHERE track_id IN ({marks})",
                chunk,
            ):
                extra = json.loads(r["extra"])
                genre = extra.get("genre_override") or extra.get("genre")
                if isinstance(genre, dict):
                    genre = genre.get("name")
                info[r["track_id"]] = {"bpm": r["bpm"], "genre": genre}
            played.update(
                r["track_id"]
                for r in conn.execute(
                    f"SELECT track_id FROM music_plays WHERE track_id IN ({marks})",
                    chunk,
                )
            )
    return [
        {"library": c.get("library", "local"), "track_id": c["track_id"]}
        for c in candidates
        if matches(
            rules,
            {**c, **info.get(c["track_id"], {}), "played": c["track_id"] in played},
            now,
        )
    ]
