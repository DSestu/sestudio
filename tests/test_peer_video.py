"""Another sestudio's films (SPEC-storage §9, X3; PRs 13–14), end to end: a real
HTTP server shares its video, and the same app reads it back as a storage."""

from __future__ import annotations

import socket
import threading
import time

import pytest
import uvicorn
from fastapi.testclient import TestClient

from sestudio import downloaded, library, storage
from sestudio.web.app import create_app

REL = "My Show/Season 01/VF/S01E01 - Pilot.mp4"


@pytest.fixture()
def peer(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    library.reset_connection()
    downloaded.invalidate()
    storage._lists.clear()
    storage._state.clear()
    out = tmp_path / "out"
    (out / REL).parent.mkdir(parents=True)
    (out / REL).write_bytes(b"0123456789")
    app = create_app()
    c = TestClient(app)
    c.put("/api/settings", json={"output_root": str(out)})
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    token = c.post("/api/music/share-tokens", json={"label": "me"}).json()["token"]
    yield c, f"http://127.0.0.1:{port}", token
    server.should_exit = True
    library.reset_connection()


def _wait_listed(c, rid):
    for _ in range(100):
        titles = c.get("/api/downloaded").json()
        if any(rid in t["storages"] for t in titles):
            return titles
        time.sleep(0.05)
    raise AssertionError("the other server's films never showed")


def test_the_share_needs_a_token(peer):
    c, _, _ = peer
    assert c.get("/api/share/video").status_code == 401
    assert c.get("/api/share/video/file", params={"path": REL}).status_code == 401


def test_another_sestudios_films_list_and_play(peer):
    c, url, token = peer
    r = c.post("/api/storages", json={"kind": "remote_sestudio", "roles": ["video"],
               "url": url, "token": token, "label": "Living room"})  # fmt: skip
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    titles = _wait_listed(c, rid)
    show = next(t for t in titles if t["series"] == "My Show")
    keys = {f["storage"]: f["path"] for f in show["files"]}
    assert keys == {"local": REL, rid: f"{rid}:{REL}"}
    # played through this server, ranges passed on
    part = c.get("/api/downloaded/file", params={"path": f"{rid}:{REL}"},
                 headers={"Range": "bytes=2-5"})  # fmt: skip
    assert part.status_code == 206 and part.content == b"2345"
    relayed = c.get(f"/api/storages/{rid}/raw/{REL}")
    assert relayed.content == b"0123456789"
    # read only from here
    c.put("/api/settings", json={"allow_file_deletion": True})
    gone = c.delete("/api/downloaded/file", params={"path": f"{rid}:{REL}"})
    assert gone.status_code == 403


def test_the_share_lists_only_this_servers_own_storages(peer):
    c, url, token = peer
    rid = c.post("/api/storages", json={"kind": "remote_sestudio", "roles": ["video"],
                 "url": url, "token": token}).json()["id"]  # fmt: skip
    _wait_listed(c, rid)
    shared = c.get(
        "/api/share/video", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert all(f["storage"] == "local" for t in shared for f in t["files"])
    chained = c.get("/api/share/video/file", params={"path": f"{rid}:{REL}"},
                    headers={"Authorization": f"Bearer {token}"})  # fmt: skip
    assert chained.status_code == 404
