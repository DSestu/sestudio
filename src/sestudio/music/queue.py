"""The music queue: one per station, kept on the server so that the phone, the
desktop and the TV see the same one.

It holds references to tracks (library + track id), never paths. The whole
queue is one JSON document in ``music_queue``; every change bumps ``rev``,
saves, and is pushed to subscribers as an event naming the op, so a client can
animate it instead of reloading. A client that sends the revision it last saw
gets ``StaleRev`` when someone else changed the queue first.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
import time
from collections.abc import Callable
from typing import Any

from sestudio import library

STATION = "main"
MIX_MODES = ("fade", "sync")
MIX_BARS = (4, 8, 16, 32)
MAX_NUDGE_MS = 500

DEFAULT_MIX_SETTINGS: dict[str, Any] = {
    "mode": "sync",
    "bars": 8,
    "tempo": True,
    "swap": True,
    "nudge": 0,
}

Sub = tuple[asyncio.AbstractEventLoop, "asyncio.Queue[dict[str, Any]]"]


class StaleRev(Exception):
    """The client's revision is not the current one."""


class Invalid(ValueError):
    """The request names something that is not in the queue."""


def _empty() -> dict[str, Any]:
    return {
        "items": [],
        "current_item": None,
        "position": 0.0,
        "updated_at": time.time(),
        "playing": False,
        "repeat": False,
        "default_mix": "sync",
        "mix": {},
        "next_item": 1,
    }


def _load(conn: Any) -> tuple[int, dict[str, Any]]:
    row = conn.execute(
        "SELECT rev, data FROM music_queue WHERE station = ?", (STATION,)
    ).fetchone()
    if row is None:
        return 0, _empty()
    return int(row["rev"]), json.loads(row["data"])


def _index(doc: dict[str, Any]) -> int:
    for i, item in enumerate(doc["items"]):
        if item["item_id"] == doc["current_item"]:
            return i
    return -1


def _view(rev: int, doc: dict[str, Any]) -> dict[str, Any]:
    digest = hashlib.sha1(json.dumps(doc, sort_keys=True).encode()).hexdigest()[:8]
    return {
        "rev": rev,
        "hash": digest,
        "items": doc["items"],
        "current": _index(doc),
        "position": doc["position"],
        "updated_at": doc["updated_at"],
        "server_time": time.time(),
        "playing": doc["playing"],
        "repeat": doc["repeat"],
        "default_mix": doc["default_mix"],
        "mix": doc["mix"],
    }


def get_state() -> dict[str, Any]:
    with library._lock:
        return _view(*_load(library._connect()))


def _position_now(doc: dict[str, Any]) -> float:
    if not doc["playing"]:
        return doc["position"]
    return doc["position"] + max(0.0, time.time() - doc["updated_at"])


def _set_position(doc: dict[str, Any], position: float) -> None:
    doc["position"] = max(0.0, position)
    doc["updated_at"] = time.time()


# --- push -------------------------------------------------------------------

_subs: set[Sub] = set()
_subs_lock = threading.Lock()


def subscribe() -> Sub:
    sub: Sub = (asyncio.get_running_loop(), asyncio.Queue())
    with _subs_lock:
        _subs.add(sub)
    return sub


def unsubscribe(sub: Sub) -> None:
    with _subs_lock:
        _subs.discard(sub)


def _publish(event: dict[str, Any]) -> None:
    with _subs_lock:
        subs = list(_subs)
    for sub in subs:
        loop, q = sub
        try:
            loop.call_soon_threadsafe(q.put_nowait, event)
        except RuntimeError:  # that loop is closed: its client is gone
            unsubscribe(sub)


# --- mutations --------------------------------------------------------------


def _mutate(
    op: str, if_rev: int | None, change: Callable[[dict[str, Any]], dict[str, Any]]
) -> dict[str, Any]:
    """Run *change* on the queue, save it as the next revision and push the op.

    Returns the new state. *change* returns the op's own fields for the event;
    it raises ``Invalid`` before touching anything it cannot finish.
    """
    with library._lock:
        conn = library._connect()
        rev, doc = _load(conn)
        if if_rev is not None and if_rev != rev:
            raise StaleRev(rev)
        detail = change(doc)
        rev += 1
        for item in doc["items"] if doc["playing"] else ():
            if item["item_id"] == doc["current_item"]:
                conn.execute(
                    "INSERT OR IGNORE INTO music_plays (track_id, played_at) "
                    "VALUES (?, ?)",
                    (item["track_id"], int(time.time())),
                )
        conn.execute(
            "INSERT INTO music_queue (station, rev, data) VALUES (?, ?, ?) "
            "ON CONFLICT(station) DO UPDATE SET rev = excluded.rev, data = excluded.data",
            (STATION, rev, json.dumps(doc)),
        )
        conn.commit()
        state = _view(rev, doc)
    _publish({"rev": rev, "op": op, "hash": state["hash"], **detail})
    return state


def _find(doc: dict[str, Any], item_id: str) -> int:
    for i, item in enumerate(doc["items"]):
        if item["item_id"] == item_id:
            return i
    raise Invalid(f"unknown item {item_id}")


def _go(doc: dict[str, Any], item_id: str | None, position: float = 0.0) -> None:
    doc["current_item"] = item_id
    _set_position(doc, position)


def add(
    tracks: list[dict[str, Any]],
    index: int | None = None,
    play_now: bool = False,
    replace: bool = False,
    if_rev: int | None = None,
) -> dict[str, Any]:
    """Insert *tracks* (``{library, track_id}``) at *index* (default: the end).

    ``replace`` swaps the whole queue for them (play all of a folder) and
    starts at the first; ``play_now`` jumps to the first inserted one.
    """
    if not tracks:
        raise Invalid("no tracks")

    def change(doc: dict[str, Any]) -> dict[str, Any]:
        new = []
        for t in tracks:
            new.append({**t, "item_id": f"q{doc['next_item']}"})
            doc["next_item"] += 1
        if replace:
            doc["items"] = new
            _go(doc, new[0]["item_id"])
            doc["playing"] = True
            return {"items": new}
        at = (
            len(doc["items"])
            if index is None
            else max(0, min(index, len(doc["items"])))
        )
        doc["items"][at:at] = new
        detail: dict[str, Any] = {"index": at, "items": new}
        if play_now:
            _go(doc, new[0]["item_id"])
            doc["playing"] = True
            detail["play"] = True
        elif doc["current_item"] is None:
            doc["current_item"] = new[0]["item_id"]
        return detail

    return _mutate("set" if replace else "ins", if_rev, change)


def remove(item_id: str, if_rev: int | None = None) -> dict[str, Any]:
    def change(doc: dict[str, Any]) -> dict[str, Any]:
        i = _find(doc, item_id)
        del doc["items"][i]
        if doc["current_item"] == item_id:
            # The next row slides into the removed one's place.
            items = doc["items"]
            nxt = items[min(i, len(items) - 1)]["item_id"] if items else None
            _go(doc, nxt)
            if nxt is None:
                doc["playing"] = False
        return {"item_id": item_id, "index": i}

    return _mutate("rm", if_rev, change)


def move(item_id: str, to: int, if_rev: int | None = None) -> dict[str, Any]:
    def change(doc: dict[str, Any]) -> dict[str, Any]:
        i = _find(doc, item_id)
        dest = max(0, min(to, len(doc["items"]) - 1))
        doc["items"].insert(dest, doc["items"].pop(i))
        return {"item_id": item_id, "from": i, "to": dest}

    return _mutate("mv", if_rev, change)


def play(
    item_id: str, position: float | None = None, if_rev: int | None = None
) -> dict[str, Any]:
    """Go to *item_id* and play it. With a *position* (a scrub or a jump on the
    timeline) it lands there and stays playing or paused as it was."""

    def change(doc: dict[str, Any]) -> dict[str, Any]:
        i = _find(doc, item_id)
        _go(doc, item_id, position or 0.0)
        detail: dict[str, Any] = {"item_id": item_id, "index": i}
        if position is None:
            doc["playing"] = True
        else:
            detail.update(position=doc["position"], keep=True)
        return detail

    return _mutate("go", if_rev, change)


def transport(
    action: str,
    position: float | None = None,
    repeat: bool | None = None,
    if_rev: int | None = None,
) -> dict[str, Any]:
    """play / pause / seek / next / prev / repeat.

    *position* is the client's own position, so a pause or a seek lands where
    the listener is. next and prev change the current item, so they are pushed
    as ``go``; the rest as ``transport``.
    """
    if action not in ("play", "pause", "seek", "next", "prev", "repeat"):
        raise Invalid(f"unknown action {action}")
    if action == "seek" and position is None:
        raise Invalid("seek needs a position")
    if action == "repeat" and repeat is None:
        raise Invalid("repeat needs a value")

    def step(doc: dict[str, Any]) -> dict[str, Any]:
        items = doc["items"]
        if not items:
            raise Invalid("the queue is empty")
        j = _index(doc) + 1 if action == "next" else max(_index(doc) - 1, 0)
        doc["playing"] = True
        if j >= len(items):
            if doc["repeat"]:
                j = 0
            else:  # end of the queue: stay on the last track, stopped
                j, doc["playing"] = len(items) - 1, False
        _go(doc, items[j]["item_id"])
        return {"item_id": items[j]["item_id"], "index": j, "playing": doc["playing"]}

    def change(doc: dict[str, Any]) -> dict[str, Any]:
        if action in ("next", "prev"):
            return step(doc)
        if action == "repeat":
            doc["repeat"] = bool(repeat)
        else:
            _set_position(doc, _position_now(doc) if position is None else position)
            if action != "seek":
                if action == "play" and doc["current_item"] is None and doc["items"]:
                    doc["current_item"] = doc["items"][0]["item_id"]
                doc["playing"] = action == "play"
        return {
            "action": action,
            "playing": doc["playing"],
            "position": doc["position"],
            "repeat": doc["repeat"],
            "updated_at": doc["updated_at"],
        }

    return _mutate("go" if action in ("next", "prev") else "transport", if_rev, change)


def clean_mix(raw: dict[str, Any]) -> dict[str, Any]:
    """A pair's settings, with every field present and in range."""
    s = {**DEFAULT_MIX_SETTINGS, **raw}
    if s["mode"] not in MIX_MODES:
        raise Invalid("mode must be fade or sync")
    if s["bars"] not in MIX_BARS:
        raise Invalid("bars must be 4, 8, 16 or 32")
    return {
        "mode": s["mode"],
        "bars": s["bars"],
        "tempo": bool(s["tempo"]),
        "swap": bool(s["swap"]),
        "nudge": max(-MAX_NUDGE_MS, min(MAX_NUDGE_MS, int(s["nudge"]))),
    }


def set_mix(
    from_id: str, to_id: str, settings: dict[str, Any], if_rev: int | None = None
) -> dict[str, Any]:
    """Store a pair's mix settings, keyed ``"<from track id>><to track id>"``."""
    clean = clean_mix(settings)

    def change(doc: dict[str, Any]) -> dict[str, Any]:
        doc["mix"][f"{from_id}>{to_id}"] = clean
        return {"from": from_id, "to": to_id, "settings": clean}

    return _mutate("mix", if_rev, change)


def set_default_mix(mode: str, if_rev: int | None = None) -> dict[str, Any]:
    if mode not in MIX_MODES:
        raise Invalid("mode must be fade or sync")

    def change(doc: dict[str, Any]) -> dict[str, Any]:
        doc["default_mix"] = mode
        return {"mode": mode}

    return _mutate("mixd", if_rev, change)
