from __future__ import annotations

import sqlite3

import pytest

from sestudio import library


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = tmp_path / "library.db"
    monkeypatch.setenv("SESTUDIO_DB", str(path))
    library.reset_connection()
    yield path
    library.reset_connection()


def _tables(path) -> set[str]:
    conn = sqlite3.connect(str(path))
    try:
        return {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        conn.close()


def test_fresh_database_is_fully_migrated(db):
    assert library.schema_version() == len(library._MIGRATIONS)
    names = _tables(db)
    assert {"watchers", "watcher_seen", "watcher_events"} <= names
    # The legacy tables are still created by the frozen _SCHEMA.
    assert {"watch_state", "collections", "preferences", "downloaded_files"} <= names


def test_legacy_database_is_upgraded_without_losing_data(db):
    """A pre-versioning database has user_version 0 and only the four old tables."""
    conn = sqlite3.connect(str(db))
    conn.executescript(library._SCHEMA)
    conn.execute(
        "INSERT INTO watch_state (key, data, updated_at) VALUES ('k', '{\"a\": 1}', 5)"
    )
    conn.commit()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    conn.close()

    assert library.schema_version() == len(library._MIGRATIONS)
    assert {"watchers", "watcher_seen", "watcher_events"} <= _tables(db)
    # The row that was already there survives the upgrade.
    assert library.get_snapshot()["watch"] == {"k": {"a": 1}}


def test_migrating_twice_is_a_no_op(db):
    first = library.schema_version()
    library.reset_connection()
    assert library.schema_version() == first
    library.reset_connection()
    assert library.schema_version() == first


def test_foreign_keys_are_enabled(db):
    """watcher_seen's ON DELETE CASCADE only fires when the pragma is set, and the
    pragma is per-connection rather than stored in the file."""
    watcher = library.watcher_create("title_lang", {"page_url": "u"})
    library.watcher_record_seen(watcher["id"], ["a", "b"])
    assert library.watcher_seen_count(watcher["id"]) == 2
    library.watcher_delete(watcher["id"])
    assert library.watcher_seen_count(watcher["id"]) == 0
