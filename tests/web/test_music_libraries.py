"""Music libraries: the registry, per-library ids, a remote sestudio server, share tokens."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.music import libraries
from sestudio.sites import creators
from sestudio.web.app import create_app


@pytest.fixture()
def env(tmp_path, monkeypatch):
    out = tmp_path / "out"
    out.mkdir()
    (out / "a.m4a").write_bytes(b"local-audio")
    nas = tmp_path / "nas"
    (nas / "Album").mkdir(parents=True)
    (nas / "a.m4a").write_bytes(b"x")
    (nas / "Album" / "b.m4a").write_bytes(b"nas-audio")
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(downloaded, "audio_info", lambda f: ("", "", "", None))
    monkeypatch.setattr(libraries, "transport", None)
    library.reset_connection()
    downloaded.invalidate()
    libraries._remote.clear()
    libraries._ytmusic.clear()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(out)})
    yield c, nas
    library.reset_connection()


def add_folder(c, nas) -> dict:
    r = c.post("/api/music/libraries", json={"kind": "local_folder", "path": str(nas)})
    assert r.status_code == 200, r.text
    return r.json()


def add_remote(c, url="https://other.test", token="sst_x") -> dict:
    r = c.post(
        "/api/music/libraries",
        json={"kind": "remote_sestudio", "url": url + "/", "token": token},
    )
    assert r.status_code == 200, r.text
    return r.json()


def by_id(c) -> dict[str, dict]:
    return {x["id"]: x for x in c.get("/api/music/libraries").json()}


# --- registry -----------------------------------------------------------------


def test_registry_crud(env):
    c, nas = env
    assert list(by_id(c)) == ["local"]
    folder = add_folder(c, nas)
    assert folder["label"] == "nas" and folder["kind"] == "local_folder"
    remote = add_remote(c)
    assert remote["url"] == "https://other.test"
    assert "token" not in remote and remote["has_token"]
    assert list(by_id(c)) == ["local", folder["id"], remote["id"]]

    r = c.patch(f"/api/music/libraries/{folder['id']}", json={"label": "NAS"})
    assert r.json()["label"] == "NAS"
    assert c.delete(f"/api/music/libraries/{folder['id']}").status_code == 200
    assert c.delete(f"/api/music/libraries/{folder['id']}").status_code == 400
    assert folder["id"] not in by_id(c)


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "local_folder", "path": "/no/such/folder"},
        {"kind": "remote_sestudio", "url": "ftp://x", "token": "t"},
        {"kind": "remote_sestudio", "url": "https://x"},
        {"kind": "nope"},
    ],
)
def test_registry_rejects_bad_libraries(env, body):
    c, _ = env
    assert c.post("/api/music/libraries", json=body).status_code == 400


def test_tokens_stay_out_of_the_settings(env):
    c, _ = env
    add_remote(c, token="sst_secret")
    c.post("/api/music/share-tokens", json={"label": "x"})
    shown = c.get("/api/settings").text
    assert "sst_secret" not in shown
    assert "music_libraries" not in shown and "music_share_tokens" not in shown


# --- ids ----------------------------------------------------------------------


def test_local_ids_do_not_change(env):
    c, nas = env
    out = c.get("/api/settings").json()["output_root"]
    assert [f.track_id for f in downloaded.audio_files(out)] == [
        downloaded.track_id("a.m4a")
    ]
    folder = add_folder(c, nas)
    mine = {f.path: f.track_id for f in downloaded.audio_files(nas, folder["id"])}
    assert mine["a.m4a"] == downloaded.track_id("a.m4a", folder["id"])
    assert mine["a.m4a"] != downloaded.track_id("a.m4a")
    assert by_id(c)["local"]["count"] == 1
    assert by_id(c)[folder["id"]]["count"] == 2


def test_folder_library_lists_plays_and_queues(env):
    c, nas = env
    folder = add_folder(c, nas)
    tracks = c.get("/api/music/libraries/tracks").json()
    assert {t["library"] for t in tracks} == {folder["id"]}
    b = next(t for t in tracks if t["name"] == "Album")
    r = c.get(f"/api/music/libraries/{folder['id']}/tracks/{b['id']}/audio")
    assert r.content == b"nas-audio"
    ref = {"library": folder["id"], "track_id": b["id"]}
    assert c.post("/api/music/queue", json={"tracks": [ref]}).status_code == 200
    bad = {"library": folder["id"], "track_id": "nope"}
    assert c.post("/api/music/queue", json={"tracks": [bad]}).status_code == 404


def test_missing_folder_reads_as_offline(env, tmp_path):
    c, _ = env
    gone = tmp_path / "gone"
    gone.mkdir()
    folder = add_folder(c, gone)
    gone.rmdir()
    state = by_id(c)[folder["id"]]
    assert state["state"] == "offline" and state["count"] == 0


# --- remote server ------------------------------------------------------------

LISTING = {
    "tracks": [
        {
            "id": "abc",
            "title": "Far",
            "artist": "Them",
            "duration": 90,
            "folder": "l:x",
            "name": "X",
        }
    ]
}


def remote_handler(state):
    def handle(request: httpx.Request) -> httpx.Response:
        if state.get("down"):
            raise httpx.ConnectError("refused")
        if request.headers.get("authorization") != "Bearer sst_x":
            return httpx.Response(401)
        path = request.url.path
        if path == "/api/music/share/tracks":
            return httpx.Response(200, json=LISTING)
        if path.endswith("/analysis"):
            return httpx.Response(200, json={"id": "abc", "bpm": 120})
        if path.endswith("/audio"):
            return httpx.Response(
                200, content=b"remote-audio", headers={"content-type": "audio/mp4"}
            )
        return httpx.Response(404)

    return handle


def test_remote_library_lists_streams_and_analyses(env, monkeypatch):
    c, _ = env
    state: dict = {}
    monkeypatch.setattr(
        libraries, "transport", httpx.MockTransport(remote_handler(state))
    )
    remote = add_remote(c)
    row = by_id(c)[remote["id"]]
    assert row["state"] == "online" and row["count"] == 1

    track = c.get("/api/music/libraries/tracks").json()[0]
    assert track["id"] == f"{remote['id']}-abc" and track["library"] == remote["id"]
    audio = c.get(f"/api/music/libraries/{remote['id']}/tracks/{track['id']}/audio")
    assert audio.content == b"remote-audio"
    assert audio.headers["content-type"] == "audio/mp4"
    got = c.get(f"/api/music/tracks/{track['id']}/analysis").json()
    assert got == {"id": track["id"], "bpm": 120}
    ref = {"library": remote["id"], "track_id": track["id"]}
    assert c.post("/api/music/queue", json={"tracks": [ref]}).status_code == 200


def test_remote_library_goes_offline_and_keeps_its_listing(env, monkeypatch):
    c, _ = env
    state: dict = {}
    monkeypatch.setattr(
        libraries, "transport", httpx.MockTransport(remote_handler(state))
    )
    remote = add_remote(c)
    assert by_id(c)[remote["id"]]["state"] == "online"

    state["down"] = True
    lib = libraries.get(remote["id"])
    libraries.refresh_remote(lib, force=True)
    row = by_id(c)[remote["id"]]
    assert row["state"] == "offline" and row["since"] and row["count"] == 1
    since = row["since"]
    libraries.refresh_remote(lib, force=True)
    assert by_id(c)[remote["id"]]["since"] == since
    assert c.get("/api/music/libraries/tracks").json()[0]["title"] == "Far"

    state["down"] = False
    libraries.refresh_remote(lib, force=True)
    assert by_id(c)[remote["id"]]["state"] == "online"


def test_remote_listing_survives_a_restart(env, monkeypatch):
    c, _ = env
    state: dict = {}
    monkeypatch.setattr(
        libraries, "transport", httpx.MockTransport(remote_handler(state))
    )
    remote = add_remote(c)
    assert by_id(c)[remote["id"]]["count"] == 1
    libraries._remote.clear()
    state["down"] = True
    row = by_id(c)[remote["id"]]
    assert row["state"] == "offline" and row["count"] == 1


def test_remote_with_a_refused_token_is_offline(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(libraries, "transport", httpx.MockTransport(remote_handler({})))
    remote = add_remote(c, token="wrong")
    row = by_id(c)[remote["id"]]
    assert row["state"] == "offline" and "token" in row["error"]


# --- this server's share API --------------------------------------------------


def test_share_api_needs_a_live_token(env):
    c, nas = env
    add_folder(c, nas)
    track = libraries.share_tracks()[0]
    urls = [
        "/api/music/share/tracks",
        f"/api/music/share/tracks/{track['id']}/audio",
        f"/api/music/share/tracks/{track['id']}/analysis",
    ]
    for url in urls:
        assert c.get(url).status_code == 401
        assert c.get(url, headers={"Authorization": "Bearer nope"}).status_code == 401

    made = c.post("/api/music/share-tokens", json={"label": "Laptop"}).json()
    assert made["token"].startswith("sst_") and "hash" not in made
    auth = {"Authorization": f"Bearer {made['token']}"}
    listed = c.get(urls[0], headers=auth).json()["tracks"]
    assert len(listed) == 3  # local + both of the folder's files
    assert c.get(urls[1], headers=auth).status_code == 200
    assert c.get(urls[2], headers=auth).status_code == 404  # not analysed yet
    assert "hash" not in c.get("/api/music/share-tokens").text

    assert c.delete(f"/api/music/share-tokens/{made['id']}").status_code == 200
    assert c.get(urls[0], headers=auth).status_code == 401
    assert c.delete(f"/api/music/share-tokens/{made['id']}").status_code == 400


def test_two_servers_talk_through_the_share_api(env, monkeypatch):
    """The client library reading this very server's share API, end to end."""
    c, nas = env
    add_folder(c, nas)
    secret = c.post("/api/music/share-tokens", json={"label": "me"}).json()["token"]

    def handle(request: httpx.Request) -> httpx.Response:
        r = c.get(
            request.url.path,
            headers={"Authorization": request.headers["authorization"]},
        )
        return httpx.Response(
            r.status_code,
            content=r.content,
            headers={"content-type": r.headers["content-type"]},
        )

    monkeypatch.setattr(libraries, "transport", httpx.MockTransport(handle))
    remote = add_remote(c, token=secret)
    assert by_id(c)[remote["id"]]["count"] == 3


# --- YouTube Music account ----------------------------------------------------


def test_ytmusic_needs_sign_in_without_cookies(env):
    c, _ = env
    yt = c.post("/api/music/libraries", json={"kind": "ytmusic_account"}).json()
    row = by_id(c)[yt["id"]]
    assert row["state"] == "needs_signin" and row["count"] == 0
    dup = c.post("/api/music/libraries", json={"kind": "ytmusic_account"})
    assert dup.status_code == 400


def test_ytmusic_lists_likes_as_online_items(env, tmp_path, monkeypatch):
    c, _ = env
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n")
    c.put("/api/settings", json={"ytmusic_cookies": str(cookies)})
    seen = []

    def fake(*args):
        seen.append(args)
        return {
            "entries": [
                {
                    "id": "dQw4w9WgXcQ",
                    "title": "Song",
                    "uploader": "Me",
                    "duration": 200,
                }
            ]
        }

    monkeypatch.setattr(creators, "ytdlp_json", fake)
    yt = c.post("/api/music/libraries", json={"kind": "ytmusic_account"}).json()
    assert by_id(c)[yt["id"]]["state"] == "online"
    track = c.get("/api/music/libraries/tracks").json()[0]
    assert track["library"] == "online" and track["crate"] == yt["id"]
    assert track["source"] == "ytmusic" and track["id"] == "yt:dQw4w9WgXcQ"
    assert "--cookies" in seen[0] and str(cookies) in seen[0]
