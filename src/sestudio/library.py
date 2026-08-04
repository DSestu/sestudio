from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Server-side "library": watch progress, watchlist/favourites, and preferences —
# the state that used to live in each browser's localStorage. Stored in one
# SQLite file so a single-user setup shares it across devices (issue #24).
#
# The server is a dumb document store: each record is a key plus the exact JSON
# the client sent. All logic (watched threshold, next-up, etc.) stays client-side.

_DB_PATH = Path.home() / ".config" / "sestudio" / "library.db"

_LISTS = ("watchlist", "favourites")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS watch_state (
    key        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
    list       TEXT NOT NULL,
    key        TEXT NOT NULL,
    data       TEXT NOT NULL,
    added_at   INTEGER NOT NULL,
    PRIMARY KEY (list, key)
);
CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()


def _db_path() -> Path:
    env = os.environ.get("SESTUDIO_DB")
    return Path(env) if env else _DB_PATH


def _connect() -> sqlite3.Connection:
    """The shared connection, opened (and schema-initialised) on first use.

    One connection guarded by ``_lock`` is enough for a single-user LAN app; the
    FastAPI threadpool may touch it from different threads, so check_same_thread
    is disabled and every accessor holds the lock. WAL keeps readers unblocked.
    """
    global _conn
    if _conn is None:
        path = _db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.executescript(_SCHEMA)
        conn.commit()
        _conn = conn
    return _conn


def reset_connection() -> None:
    """Close and forget the connection (so tests can point SESTUDIO_DB elsewhere)."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


# --- snapshot (hydration) --------------------------------------------------- #


def get_snapshot() -> dict[str, Any]:
    """The whole library in the shape the frontend stores expect."""
    with _lock:
        conn = _connect()
        watch = {
            row["key"]: json.loads(row["data"])
            for row in conn.execute("SELECT key, data FROM watch_state")
        }
        collections: dict[str, dict[str, Any]] = {name: {} for name in _LISTS}
        for row in conn.execute("SELECT list, key, data FROM collections"):
            collections.setdefault(row["list"], {})[row["key"]] = json.loads(
                row["data"]
            )
        prefs = {
            row["key"]: json.loads(row["value"])
            for row in conn.execute("SELECT key, value FROM preferences")
        }
    return {
        "watch": watch,
        "collections": collections,
        "player": prefs.get("player"),
        "playlist_collapsed": bool(prefs.get("playlist_collapsed", False)),
        "library_layout": prefs.get("library_layout"),
    }


# --- watch state ------------------------------------------------------------ #


def upsert_watch(key: str, entry: dict[str, Any]) -> None:
    """Store one watch entry. Last-write-wins by ``updatedAt`` so a stale write
    from another device can't clobber a newer position."""
    updated_at = int(entry.get("updatedAt", 0))
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO watch_state (key, data, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at "
            "WHERE excluded.updated_at >= watch_state.updated_at",
            (key, json.dumps(entry), updated_at),
        )
        conn.commit()


def delete_watch(key: str) -> None:
    with _lock:
        conn = _connect()
        conn.execute("DELETE FROM watch_state WHERE key = ?", (key,))
        conn.commit()


# --- collections ------------------------------------------------------------ #


def upsert_collection(list_name: str, key: str, entry: dict[str, Any]) -> None:
    added_at = int(entry.get("addedAt", 0))
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO collections (list, key, data, added_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(list, key) DO UPDATE SET data=excluded.data, added_at=excluded.added_at",
            (list_name, key, json.dumps(entry), added_at),
        )
        conn.commit()


def delete_collection(list_name: str, key: str) -> None:
    with _lock:
        conn = _connect()
        conn.execute(
            "DELETE FROM collections WHERE list = ? AND key = ?", (list_name, key)
        )
        conn.commit()


# --- batch ------------------------------------------------------------------ #


def apply_batch(
    watch_delete: list[str],
    collections_delete: list[tuple[str, str]],
    collections_put: list[tuple[str, str, dict[str, Any]]],
    watch_put: list[tuple[str, dict[str, Any]]] | None = None,
) -> None:
    """Apply many mutations in one transaction.

    Batch selection in the library removes tens of entries at once, and "move to
    favourites" is a delete from one list plus a put to another — neither should
    be able to half-apply. Deletes run before puts, so a batch that touches the
    same (list, key) both ways ends with the entry present.

    Callers must validate list names first; unknown lists are written as-is.
    """
    with _lock:
        conn = _connect()
        with conn:  # transaction
            conn.executemany(
                "DELETE FROM watch_state WHERE key = ?",
                [(key,) for key in watch_delete],
            )
            # Same last-write-wins guard as the single-entry upsert, so a stale
            # batch from another device can't roll back a newer position.
            conn.executemany(
                "INSERT INTO watch_state (key, data, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at "
                "WHERE excluded.updated_at >= watch_state.updated_at",
                [
                    (key, json.dumps(entry), int(entry.get("updatedAt", 0)))
                    for key, entry in (watch_put or [])
                ],
            )
            conn.executemany(
                "DELETE FROM collections WHERE list = ? AND key = ?",
                collections_delete,
            )
            conn.executemany(
                "INSERT INTO collections (list, key, data, added_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(list, key) DO UPDATE SET data=excluded.data, added_at=excluded.added_at",
                [
                    (list_name, key, json.dumps(entry), int(entry.get("addedAt", 0)))
                    for list_name, key, entry in collections_put
                ],
            )


# --- preferences ------------------------------------------------------------ #


def set_pref(key: str, value: Any) -> None:
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO preferences (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
        conn.commit()


# --- migration -------------------------------------------------------------- #


def is_empty() -> bool:
    """True when no library data exists yet (gate for the one-time import)."""
    with _lock:
        conn = _connect()
        for table in ("watch_state", "collections", "preferences"):
            if conn.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() is not None:
                return False
    return True


def import_bulk(payload: dict[str, Any]) -> None:
    """Atomically load a full localStorage snapshot on first run. Callers must
    gate on is_empty(); this writes unconditionally."""
    watch = payload.get("watch") or {}
    collections = payload.get("collections") or {}
    player = payload.get("player")
    collapsed = payload.get("playlist_collapsed")
    layout = payload.get("library_layout")
    with _lock:
        conn = _connect()
        with conn:  # transaction
            conn.executemany(
                "INSERT OR REPLACE INTO watch_state (key, data, updated_at) VALUES (?, ?, ?)",
                [
                    (k, json.dumps(v), int(v.get("updatedAt", 0)))
                    for k, v in watch.items()
                ],
            )
            for name in _LISTS:
                conn.executemany(
                    "INSERT OR REPLACE INTO collections (list, key, data, added_at) VALUES (?, ?, ?, ?)",
                    [
                        (name, k, json.dumps(v), int(v.get("addedAt", 0)))
                        for k, v in (collections.get(name) or {}).items()
                    ],
                )
            if player is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO preferences (key, value) VALUES ('player', ?)",
                    (json.dumps(player),),
                )
            if collapsed is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO preferences (key, value) VALUES ('playlist_collapsed', ?)",
                    (json.dumps(bool(collapsed)),),
                )
            if layout is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO preferences (key, value) VALUES ('library_layout', ?)",
                    (json.dumps(layout),),
                )
