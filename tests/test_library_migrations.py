from __future__ import annotations

import json
import sqlite3

import pytest

from sestudio import library
from sestudio.music import playlists


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


def _builder_flows(path) -> bool:
    """The old Mix builder's flows table (migration 5) is there; migration 7's music_flows has no `mode`."""
    conn = sqlite3.connect(str(path))
    try:
        return "mode" in {r[1] for r in conn.execute("PRAGMA table_info(music_flows)")}
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


def _flow(conn, flow_id, name, mode, position, items, base=None):
    conn.execute(
        "INSERT INTO music_flows (id, name, mode, position, data) VALUES (?, ?, ?, ?, ?)",
        (
            flow_id,
            name,
            mode,
            position,
            json.dumps({"fork": None, "base": base, "items": items}),
        ),
    )


def _ref(track_id):
    return {"kind": "local", "track_id": track_id}


def test_flows_become_playlists_once(db):
    """Upgrading from the Mix builder: mixes and branches turn into playlists."""
    conn = sqlite3.connect(str(db))
    for script in library._MIGRATIONS[:5]:
        conn.executescript(script)
    conn.execute("PRAGMA user_version = 5")
    # A set the branch hangs off (loose items and a part), and a name a mix will clash with.
    base = {
        "items": [{**_ref("a"), "item_id": "p1"}],
        "parts": [
            {"id": "s1", "name": "Part 1", "items": [{**_ref("b"), "item_id": "p2"}]}
        ],
        "next": 3,
    }
    conn.execute(
        "INSERT INTO music_playlists (id, parent, kind, name, position, data) "
        "VALUES ('base', NULL, 'playlist', 'Friday', 0, ?)",
        (json.dumps(base),),
    )
    _flow(conn, "f1", "Friday", "mix", 0, [_ref("c"), _ref("d")])
    _flow(conn, "f2", "Empty", "mix", 1, [])
    _flow(conn, "f3", "Branch 1", "branch", 2, [_ref("e")], base="base")
    conn.commit()
    conn.close()

    assert library.schema_version() == len(library._MIGRATIONS)

    nodes = {n["name"]: n for n in playlists.tree()}
    assert set(nodes) == {"Friday", "Friday (mix)", "Branch 1"}
    assert [t["track_id"] for t in nodes["Friday (mix)"]["items"]] == ["c", "d"]
    assert [t["track_id"] for t in nodes["Branch 1"]["items"]] == ["a", "b", "e"]
    assert len({t["item_id"] for t in nodes["Branch 1"]["items"]}) == 3
    assert [t["track_id"] for t in nodes["Friday"]["items"]] == [
        "a"
    ]  # the base is untouched
    assert not _builder_flows(db)

    # The converted playlist works like any other (the next item id is free).
    playlists.add_items(nodes["Branch 1"]["id"], [_ref("f")])
    library.reset_connection()
    assert len(playlists.tree()) == 3  # a second start converts nothing


def test_fresh_database_has_no_builder_flows_table(db):
    library.schema_version()
    assert not _builder_flows(db)
