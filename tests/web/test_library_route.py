from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio import library
from sestudio.web.app import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library.reset_connection()  # drop any connection cached from a prior test
    app = create_app()
    yield TestClient(app)
    library.reset_connection()


def _watch(number: int, updated_at: int, position: float = 10.0) -> dict:
    return {
        "series": "Show",
        "season": 1,
        "number": number,
        "title": f"E{number}",
        "poster_url": "",
        "page_url": "u",
        "lang": "vf",
        "position": position,
        "duration": 100.0,
        "watched": False,
        "updatedAt": updated_at,
    }


def test_get_library_empty(client):
    data = client.get("/api/library").json()
    assert data == {
        "watch": {},
        "collections": {"watchlist": {}, "favourites": {}},
        "player": None,
        "playlist_collapsed": False,
        "library_layout": None,
    }


def test_watch_put_get_delete(client):
    assert (
        client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 100)).status_code
        == 200
    )
    snap = client.get("/api/library").json()
    assert snap["watch"]["Show|S1|E1"]["position"] == 10.0

    assert client.delete("/api/library/watch/Show|S1|E1").status_code == 200
    assert client.get("/api/library").json()["watch"] == {}


def test_watch_last_write_wins(client):
    client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 200, position=42.0))
    # A stale write (older updatedAt) must not clobber the newer position.
    client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 100, position=9.0))
    assert client.get("/api/library").json()["watch"]["Show|S1|E1"]["position"] == 42.0


def test_watch_key_with_slash(client):
    # Series names can contain "/"; the client percent-encodes the key.
    client.put(
        "/api/library/watch/A%2FB|S1|E2",
        json={"series": "A/B", "season": 1, "number": 2, "updatedAt": 1},
    )
    assert "A/B|S1|E2" in client.get("/api/library").json()["watch"]


def test_collections_put_delete(client):
    entry = {
        "series": "Show",
        "season": 1,
        "kind": "title",
        "label": "Show",
        "addedAt": 5,
    }
    client.put("/api/library/collections/watchlist/Show|S1", json=entry)
    client.put("/api/library/collections/favourites/Show|S1", json=entry)
    snap = client.get("/api/library").json()
    assert "Show|S1" in snap["collections"]["watchlist"]
    assert "Show|S1" in snap["collections"]["favourites"]

    client.delete("/api/library/collections/watchlist/Show|S1")
    snap = client.get("/api/library").json()
    assert snap["collections"]["watchlist"] == {}
    assert "Show|S1" in snap["collections"]["favourites"]


def test_collections_invalid_list_400(client):
    assert client.put("/api/library/collections/bogus/x", json={}).status_code == 400
    assert client.delete("/api/library/collections/bogus/x").status_code == 400


def test_preferences_roundtrip(client):
    client.put(
        "/api/library/preferences/player",
        json={"value": {"volume": 0.3, "muted": True, "rate": 1.25}},
    )
    client.put("/api/library/preferences/playlist_collapsed", json={"value": True})
    snap = client.get("/api/library").json()
    assert snap["player"] == {"volume": 0.3, "muted": True, "rate": 1.25}
    assert snap["playlist_collapsed"] is True


def test_library_layout_preference_roundtrip(client):
    layout = {"watching": "detail", "watchlist": "grid", "favourites": "detail"}
    assert (
        client.put(
            "/api/library/preferences/library_layout", json={"value": layout}
        ).status_code
        == 200
    )
    assert client.get("/api/library").json()["library_layout"] == layout


def test_preferences_invalid_key_400(client):
    assert (
        client.put("/api/library/preferences/bogus", json={"value": 1}).status_code
        == 400
    )


def test_batch_applies_every_operation(client):
    client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 100))
    client.put("/api/library/collections/watchlist/Show|S1", json={"addedAt": 5})

    res = client.post(
        "/api/library/batch",
        json={
            "watch_delete": ["Show|S1|E1"],
            "collections_delete": [{"list": "watchlist", "key": "Show|S1"}],
            "collections_put": [
                {
                    "list": "favourites",
                    "key": "Show|S1",
                    "entry": {"series": "Show", "season": 1, "addedAt": 7},
                }
            ],
        },
    )
    assert res.status_code == 200

    snap = client.get("/api/library").json()
    assert snap["watch"] == {}
    assert snap["collections"]["watchlist"] == {}
    assert snap["collections"]["favourites"]["Show|S1"]["addedAt"] == 7


def test_batch_watch_put_upserts(client):
    client.post(
        "/api/library/batch",
        json={"watch_put": [{"key": "Show|S1|E1", "entry": _watch(1, 100)}]},
    )
    assert "Show|S1|E1" in client.get("/api/library").json()["watch"]


def test_batch_watch_put_respects_last_write_wins(client):
    client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 200, position=42.0))
    # A stale batch from another device must not roll back a newer position.
    client.post(
        "/api/library/batch",
        json={
            "watch_put": [{"key": "Show|S1|E1", "entry": _watch(1, 100, position=9.0)}]
        },
    )
    assert client.get("/api/library").json()["watch"]["Show|S1|E1"]["position"] == 42.0


def test_batch_invalid_list_applies_nothing(client):
    client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 100))

    res = client.post(
        "/api/library/batch",
        json={
            "watch_delete": ["Show|S1|E1"],
            "collections_delete": [{"list": "bogus", "key": "Show|S1"}],
        },
    )
    assert res.status_code == 400
    # The valid half of the batch must not have landed.
    assert "Show|S1|E1" in client.get("/api/library").json()["watch"]


def test_batch_empty_is_noop(client):
    client.put("/api/library/watch/Show|S1|E1", json=_watch(1, 100))
    assert client.post("/api/library/batch", json={}).status_code == 200
    assert "Show|S1|E1" in client.get("/api/library").json()["watch"]


def test_batch_delete_then_put_same_key_keeps_entry(client):
    """Deletes run before puts, so re-saving an entry in one batch keeps it."""
    client.put("/api/library/collections/watchlist/Show|S1", json={"addedAt": 5})
    client.post(
        "/api/library/batch",
        json={
            "collections_delete": [{"list": "watchlist", "key": "Show|S1"}],
            "collections_put": [
                {"list": "watchlist", "key": "Show|S1", "entry": {"addedAt": 9}}
            ],
        },
    )
    watchlist = client.get("/api/library").json()["collections"]["watchlist"]
    assert watchlist["Show|S1"]["addedAt"] == 9


def test_batch_key_with_slash(client):
    # Batch keys travel in the JSON body, so they need no percent-encoding.
    client.put("/api/library/collections/watchlist/A%2FB|S1", json={"addedAt": 1})
    client.post(
        "/api/library/batch",
        json={"collections_delete": [{"list": "watchlist", "key": "A/B|S1"}]},
    )
    assert client.get("/api/library").json()["collections"]["watchlist"] == {}


def test_import_only_when_empty(client):
    payload = {
        "watch": {"Show|S1|E1": _watch(1, 100)},
        "collections": {"watchlist": {"Show|S1": {"addedAt": 5}}, "favourites": {}},
        "player": {"volume": 0.5, "muted": False, "rate": 1.0},
        "playlist_collapsed": True,
    }
    first = client.post("/api/library/import", json=payload)
    assert first.json() == {"imported": True}
    snap = client.get("/api/library").json()
    assert "Show|S1|E1" in snap["watch"]
    assert snap["player"]["volume"] == 0.5
    assert snap["playlist_collapsed"] is True

    # Second import is a no-op and must not clobber existing data.
    second = client.post(
        "/api/library/import", json={"watch": {"Other|S1|E1": _watch(1, 999)}}
    )
    assert second.json() == {"imported": False}
    assert "Other|S1|E1" not in client.get("/api/library").json()["watch"]
