from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
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

# _SCHEMA is the pre-versioning script and is now FROZEN: databases already in
# the wild have exactly these four tables at user_version = 0. Every later change
# is an entry appended to _MIGRATIONS — never an edit to _SCHEMA, and never an
# edit to a migration that has shipped.
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
CREATE TABLE IF NOT EXISTS downloaded_files (
    path TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
"""

# Watchers: persisted criteria the server polls, the per-item baseline it diffs
# against, and the event timeline the diff produces.
#
# watcher_seen is one row per (watcher, item) rather than one JSON blob per
# watcher so the diff is a single atomic statement. With a blob, the read-modify-
# write would race between the FastAPI threadpool and the poller's threads and
# would silently re-fire or drop events.
_MIGRATION_1_WATCHERS = """
CREATE TABLE IF NOT EXISTS watchers (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                 TEXT    NOT NULL,
    label                TEXT    NOT NULL DEFAULT '',
    config               TEXT    NOT NULL,
    enabled              INTEGER NOT NULL DEFAULT 1,
    auto_download        INTEGER NOT NULL DEFAULT 0,
    interval_seconds     INTEGER NOT NULL DEFAULT 3600,
    created_at           INTEGER NOT NULL,
    next_poll_at         INTEGER NOT NULL DEFAULT 0,
    last_polled_at       INTEGER,
    last_ok_at           INTEGER,
    last_error           TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    baselined_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_watchers_due
    ON watchers(next_poll_at) WHERE enabled = 1;

CREATE TABLE IF NOT EXISTS watcher_seen (
    watcher_id    INTEGER NOT NULL REFERENCES watchers(id) ON DELETE CASCADE,
    item_key      TEXT    NOT NULL,
    state         TEXT    NOT NULL DEFAULT 'seen',
    first_seen_at INTEGER NOT NULL,
    checked_at    INTEGER NOT NULL,
    PRIMARY KEY (watcher_id, item_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_watcher_seen_pending
    ON watcher_seen(watcher_id, checked_at) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS watcher_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id     INTEGER REFERENCES watchers(id) ON DELETE SET NULL,
    watcher_kind   TEXT    NOT NULL,
    event_type     TEXT    NOT NULL,
    item_key       TEXT    NOT NULL DEFAULT '',
    title          TEXT    NOT NULL DEFAULT '',
    subtitle       TEXT    NOT NULL DEFAULT '',
    poster_url     TEXT    NOT NULL DEFAULT '',
    data           TEXT    NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    read_at        INTEGER,
    job_id         TEXT,
    download_state TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_watcher_events_timeline
    ON watcher_events(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_watcher_events_unread
    ON watcher_events(id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_watcher_events_dedupe
    ON watcher_events(watcher_id, item_key) WHERE item_key <> '';
"""

_MIGRATIONS: tuple[str, ...] = (_MIGRATION_1_WATCHERS,)

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()


def _db_path() -> Path:
    env = os.environ.get("SESTUDIO_DB")
    return Path(env) if env else _DB_PATH


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply pending migrations, once, in order.

    ``PRAGMA user_version`` holds the count of migrations already applied, so a
    database created before this mechanism existed reads 0 and picks up every
    migration. Each one must be idempotent (``IF NOT EXISTS``): executescript()
    commits before it runs, so a crash mid-script can leave the work done with
    the version unbumped, and the next start re-runs it.
    """
    applied = int(conn.execute("PRAGMA user_version").fetchone()[0])
    for index in range(applied, len(_MIGRATIONS)):
        conn.executescript(_MIGRATIONS[index])
        # PRAGMA takes no placeholders; the value is a loop counter, not input.
        conn.execute(f"PRAGMA user_version = {index + 1}")
        conn.commit()
        logger.info("Applied library migration %d", index + 1)


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
        # Per-connection and off by default, so it must be set here for
        # watcher_seen's ON DELETE CASCADE to actually fire.
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(_SCHEMA)
        conn.commit()
        _migrate(conn)
        _conn = conn
    return _conn


def schema_version() -> int:
    """How many migrations the open database has applied."""
    with _lock:
        return int(_connect().execute("PRAGMA user_version").fetchone()[0])


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


# --- local files ------------------------------------------------------------ #
#
# What a downloaded file's path cannot say: the series name as the site spells
# it (the folder is sanitised), the poster, and the page it came from. Written
# when a download is queued and read back when the library is listed; the
# filesystem, not this table, decides what actually exists.


def set_downloaded_file(path: str, data: dict[str, Any]) -> None:
    """Record the metadata for the file a download will write to *path*."""
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO downloaded_files (path, data) VALUES (?, ?) "
            "ON CONFLICT(path) DO UPDATE SET data=excluded.data",
            (path, json.dumps(data)),
        )
        conn.commit()


def downloaded_files() -> dict[str, dict[str, Any]]:
    """Every recorded file, by path relative to the download root."""
    with _lock:
        conn = _connect()
        return {
            row["path"]: json.loads(row["data"])
            for row in conn.execute("SELECT path, data FROM downloaded_files")
        }


def delete_downloaded_file(path: str) -> None:
    """Forget one file. Safe to call for a path that was never recorded."""
    with _lock:
        conn = _connect()
        conn.execute("DELETE FROM downloaded_files WHERE path = ?", (path,))
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


# --- watchers --------------------------------------------------------------- #
#
# A watcher is a saved criterion the poller re-evaluates on a schedule. Two
# invariants live in this section and nowhere else:
#
#   * The first successful poll of a watcher stores its keys and fires nothing
#     (``baselined_at``). Without it, creating a watcher would notify about the
#     entire back catalogue.
#   * watcher_seen only ever grows. A key is never deleted and a language is
#     never retracted, because either would re-fire an old item as if it were new.
#     Events are prunable; seen-state is not.

_WATCHER_FIELDS = (
    "id, kind, label, config, enabled, auto_download, interval_seconds, "
    "created_at, next_poll_at, last_polled_at, last_ok_at, last_error, "
    "consecutive_failures, baselined_at"
)

# Fields a PATCH may touch. Poll bookkeeping is written by the poller only.
_WATCHER_PATCHABLE = (
    "label",
    "config",
    "enabled",
    "auto_download",
    "interval_seconds",
    "next_poll_at",
)


def _watcher_dict(row: sqlite3.Row) -> dict[str, Any]:
    entry = dict(row)
    entry["config"] = json.loads(entry["config"])
    entry["enabled"] = bool(entry["enabled"])
    entry["auto_download"] = bool(entry["auto_download"])
    return entry


def watcher_list() -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        return [
            _watcher_dict(row)
            for row in conn.execute(
                f"SELECT {_WATCHER_FIELDS} FROM watchers ORDER BY created_at DESC, id DESC"
            )
        ]


def watcher_get(watcher_id: int) -> dict[str, Any] | None:
    with _lock:
        conn = _connect()
        row = conn.execute(
            f"SELECT {_WATCHER_FIELDS} FROM watchers WHERE id = ?", (watcher_id,)
        ).fetchone()
    return _watcher_dict(row) if row is not None else None


def watcher_create(
    kind: str,
    config: dict[str, Any],
    *,
    label: str = "",
    auto_download: bool = False,
    interval_seconds: int = 3600,
    next_poll_at: int = 0,
) -> dict[str, Any]:
    """Create a watcher. Callers must validate *kind* and *config* first."""
    now = int(time.time())
    with _lock:
        conn = _connect()
        cur = conn.execute(
            "INSERT INTO watchers "
            "  (kind, label, config, enabled, auto_download, interval_seconds, "
            "   created_at, next_poll_at) "
            "VALUES (?, ?, ?, 1, ?, ?, ?, ?)",
            (
                kind,
                label,
                json.dumps(config),
                int(auto_download),
                int(interval_seconds),
                now,
                int(next_poll_at),
            ),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_WATCHER_FIELDS} FROM watchers WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _watcher_dict(row)


def watcher_update(watcher_id: int, **fields: Any) -> dict[str, Any] | None:
    """Patch whitelisted watcher fields. Unknown keys are ignored."""
    updates = {k: v for k, v in fields.items() if k in _WATCHER_PATCHABLE}
    if not updates:
        return watcher_get(watcher_id)
    if "config" in updates:
        updates["config"] = json.dumps(updates["config"])
    for flag in ("enabled", "auto_download"):
        if flag in updates:
            updates[flag] = int(bool(updates[flag]))
    assignments = ", ".join(f"{name} = ?" for name in updates)
    with _lock:
        conn = _connect()
        conn.execute(
            f"UPDATE watchers SET {assignments} WHERE id = ?",
            (*updates.values(), watcher_id),
        )
        conn.commit()
        row = conn.execute(
            f"SELECT {_WATCHER_FIELDS} FROM watchers WHERE id = ?", (watcher_id,)
        ).fetchone()
    return _watcher_dict(row) if row is not None else None


def watcher_delete(watcher_id: int) -> bool:
    """Delete a watcher and its seen-state. Its events survive, orphaned."""
    with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM watchers WHERE id = ?", (watcher_id,))
        conn.commit()
    return cur.rowcount > 0


def watcher_list_due(now: int) -> list[dict[str, Any]]:
    """Enabled watchers whose next_poll_at has passed, oldest due first."""
    with _lock:
        conn = _connect()
        return [
            _watcher_dict(row)
            for row in conn.execute(
                f"SELECT {_WATCHER_FIELDS} FROM watchers "
                "WHERE enabled = 1 AND next_poll_at <= ? "
                "ORDER BY next_poll_at ASC",
                (now,),
            )
        ]


def watcher_record_success(watcher_id: int, next_poll_at: int) -> None:
    """Clear the failure state after a poll that completed."""
    now = int(time.time())
    with _lock:
        conn = _connect()
        conn.execute(
            "UPDATE watchers SET last_polled_at = ?, last_ok_at = ?, last_error = NULL, "
            "  consecutive_failures = 0, next_poll_at = ? WHERE id = ?",
            (now, now, int(next_poll_at), watcher_id),
        )
        conn.commit()


def watcher_record_failure(watcher_id: int, error: str, next_poll_at: int) -> int:
    """Note a failed poll and return the new consecutive failure count.

    Deliberately touches no seen-state: a site being unreachable must not be able
    to lose a baseline, which is what would let the whole catalogue re-fire.
    """
    now = int(time.time())
    with _lock:
        conn = _connect()
        conn.execute(
            "UPDATE watchers SET last_polled_at = ?, last_error = ?, "
            "  consecutive_failures = consecutive_failures + 1, next_poll_at = ? "
            "WHERE id = ?",
            (now, error[:500], int(next_poll_at), watcher_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT consecutive_failures FROM watchers WHERE id = ?", (watcher_id,)
        ).fetchone()
    return int(row["consecutive_failures"]) if row is not None else 0


def watcher_seen_count(watcher_id: int) -> int:
    with _lock:
        conn = _connect()
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM watcher_seen WHERE watcher_id = ?",
            (watcher_id,),
        ).fetchone()
    return int(row["n"])


def watcher_record_seen(
    watcher_id: int, item_keys: list[str], *, state: str = "seen"
) -> list[str]:
    """Store *item_keys* as seen and return only those that were new.

    When the watcher has no baseline yet this stores the keys, stamps
    baselined_at and returns [] — the first poll of a watcher fires nothing. The
    insert and the baseline stamp share one transaction: split apart, a crash
    between them would re-fire the whole catalogue on the next poll.

    A key already recorded as 'seen' never regresses to 'pending', so a candidate
    that has fired once cannot fire again.
    """
    now = int(time.time())
    with _lock:
        conn = _connect()
        with conn:  # transaction
            row = conn.execute(
                "SELECT baselined_at FROM watchers WHERE id = ?", (watcher_id,)
            ).fetchone()
            if row is None:
                return []
            first_poll = row["baselined_at"] is None
            # Read the known set up front: executemany reports only an aggregate
            # rowcount, so it cannot say which individual rows were new.
            known = {
                r["item_key"]
                for r in conn.execute(
                    "SELECT item_key FROM watcher_seen "
                    "WHERE watcher_id = ? AND state = 'seen'",
                    (watcher_id,),
                )
            }
            conn.executemany(
                "INSERT INTO watcher_seen "
                "  (watcher_id, item_key, state, first_seen_at, checked_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(watcher_id, item_key) DO UPDATE SET "
                "  checked_at = excluded.checked_at, "
                "  state = CASE WHEN watcher_seen.state = 'seen' THEN 'seen' "
                "               ELSE excluded.state END",
                [(watcher_id, key, state, now, now) for key in item_keys],
            )
            if first_poll:
                conn.execute(
                    "UPDATE watchers SET baselined_at = ? WHERE id = ?",
                    (now, watcher_id),
                )
                return []
    return [key for key in item_keys if key not in known]


def watcher_seen_keys(watcher_id: int, state: str = "seen") -> set[str]:
    """Item keys already recorded for a watcher, in one state.

    Read by the criteria collector: it can only bound its per-poll work if it
    knows which candidates it has already dealt with.
    """
    with _lock:
        conn = _connect()
        return {
            row["item_key"]
            for row in conn.execute(
                "SELECT item_key FROM watcher_seen WHERE watcher_id = ? AND state = ?",
                (watcher_id, state),
            )
        }


def watcher_drop_stale_pending(watcher_id: int, first_seen_before: int) -> int:
    """Forget stage-1 candidates no site ever picked up.

    The only rows ever deleted from watcher_seen, and safe to delete precisely
    because they never fired: a 'seen' row must never be removed, but a stale
    'pending' one is a candidate that has aged out of interest.
    """
    with _lock:
        conn = _connect()
        cur = conn.execute(
            "DELETE FROM watcher_seen "
            "WHERE watcher_id = ? AND state = 'pending' AND first_seen_at < ?",
            (watcher_id, first_seen_before),
        )
        conn.commit()
    return cur.rowcount


def watcher_pending_keys(watcher_id: int, checked_before: int) -> list[str]:
    """Stage-1 candidates not yet confirmed, stale enough to re-check."""
    with _lock:
        conn = _connect()
        return [
            row["item_key"]
            for row in conn.execute(
                "SELECT item_key FROM watcher_seen "
                "WHERE watcher_id = ? AND state = 'pending' AND checked_at < ? "
                "ORDER BY checked_at ASC",
                (watcher_id, checked_before),
            )
        ]


# --- watcher events (the notification timeline) ----------------------------- #


def _event_dict(row: sqlite3.Row) -> dict[str, Any]:
    entry = dict(row)
    entry["data"] = json.loads(entry["data"])
    return entry


def watcher_add_event(
    *,
    watcher_id: int | None,
    watcher_kind: str,
    event_type: str,
    item_key: str = "",
    title: str = "",
    subtitle: str = "",
    poster_url: str = "",
    data: dict[str, Any] | None = None,
    job_id: str | None = None,
    download_state: str = "",
) -> int | None:
    """Append one timeline event. Returns its id, or None if it was a duplicate.

    A unique index on (watcher_id, item_key) makes re-notifying about the same
    item a no-op, which keeps a retried poll from doubling up the timeline.
    """
    now = int(time.time())
    with _lock:
        conn = _connect()
        cur = conn.execute(
            "INSERT OR IGNORE INTO watcher_events "
            "  (watcher_id, watcher_kind, event_type, item_key, title, subtitle, "
            "   poster_url, data, created_at, job_id, download_state) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                watcher_id,
                watcher_kind,
                event_type,
                item_key,
                title,
                subtitle,
                poster_url,
                json.dumps(data or {}),
                now,
                job_id,
                download_state,
            ),
        )
        conn.commit()
    return cur.lastrowid if cur.rowcount > 0 else None


def watcher_set_event_download(
    event_id: int, *, job_id: str | None, download_state: str
) -> None:
    """Record what auto-download did with an event, so the row can show the job."""
    with _lock:
        conn = _connect()
        conn.execute(
            "UPDATE watcher_events SET job_id = ?, download_state = ? WHERE id = ?",
            (job_id, download_state, event_id),
        )
        conn.commit()


def watcher_event_list(
    *, limit: int = 50, offset: int = 0, unread_only: bool = False
) -> list[dict[str, Any]]:
    """One page of the timeline, newest first.

    The id tiebreaker is load-bearing: several items found in one poll share a
    created_at second, and without it paging could repeat or skip rows.
    """
    clause = "WHERE read_at IS NULL " if unread_only else ""
    with _lock:
        conn = _connect()
        return [
            _event_dict(row)
            for row in conn.execute(
                f"SELECT * FROM watcher_events {clause}"
                "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (max(1, limit), max(0, offset)),
            )
        ]


def watcher_unread_count() -> int:
    with _lock:
        conn = _connect()
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM watcher_events WHERE read_at IS NULL"
        ).fetchone()
    return int(row["n"])


def watcher_mark_read(event_ids: list[int] | None = None) -> int:
    """Mark the given events read, or every unread event when *event_ids* is None."""
    now = int(time.time())
    with _lock:
        conn = _connect()
        if event_ids is None:
            cur = conn.execute(
                "UPDATE watcher_events SET read_at = ? WHERE read_at IS NULL", (now,)
            )
        else:
            if not event_ids:
                return 0
            placeholders = ",".join("?" for _ in event_ids)
            cur = conn.execute(
                f"UPDATE watcher_events SET read_at = ? "
                f"WHERE read_at IS NULL AND id IN ({placeholders})",
                (now, *event_ids),
            )
        conn.commit()
    return cur.rowcount


def watcher_prune_events(
    now: int, *, max_age_days: int = 90, max_rows: int = 5000
) -> int:
    """Drop old read events and cap the table.

    Only events are prunable — never watcher_seen, where deleting a row would
    make an old item look new again.
    """
    cutoff = now - max_age_days * 86400
    with _lock:
        conn = _connect()
        with conn:  # transaction
            aged = conn.execute(
                "DELETE FROM watcher_events "
                "WHERE read_at IS NOT NULL AND created_at < ?",
                (cutoff,),
            ).rowcount
            capped = conn.execute(
                "DELETE FROM watcher_events WHERE id <= "
                "  (SELECT MAX(id) - ? FROM watcher_events)",
                (max_rows,),
            ).rowcount
    return aged + capped
