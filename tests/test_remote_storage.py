"""FTP, SFTP and SMB storages (SPEC-storage §9, PR 7): fields, the vault, reachability."""

from __future__ import annotations

import json
import os

import fsspec
import pytest
from fastapi.testclient import TestClient

from sestudio import library, remotefs, storage, vault
from sestudio.web.app import create_app


@pytest.fixture()
def mem(tmp_path, monkeypatch):
    """Every server is one in-memory filesystem holding /films/Show/a.mkv."""
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    fs = fsspec.filesystem("memory", skip_instance_cache=True)
    fs.store.clear()
    fs.pseudo_dirs.clear()
    fs.pipe("/films/Show/a.mkv", b"x")
    fs.pipe("/films/Other/b.mkv", b"y")
    opened: list[tuple] = []

    def fake_open(s, secret=None):
        opened.append(
            (s["kind"], s["host"], secret or vault.get(s["id"]).get("password"))
        )
        if s["host"] == "off":
            raise ConnectionRefusedError("refused")
        return fs

    monkeypatch.setattr(remotefs, "_open", fake_open)
    remotefs._cache.clear()
    storage._state.clear()
    return fs, opened


def test_a_server_storage_keeps_its_password_in_the_vault(mem, tmp_path):
    fs, opened = mem
    s = storage.add(
        "sftp", ["video"], path="films",
        network={"host": "nas.local", "port": "2222", "username": "me", "password": "pw"},
    )  # fmt: skip
    assert s["id"].startswith("n") and s["label"] == "nas.local"
    assert (s["host"], s["port"], s["path"]) == ("nas.local", 2222, "/films")
    config = (tmp_path / "config.json").read_text()
    assert "pw" not in config and vault.get(s["id"]) == {"password": "pw"}
    if os.name == "posix":
        assert (tmp_path / "secrets.json").stat().st_mode & 0o077 == 0
    assert storage.state(s)["state"] == "online"
    assert opened[-1] == ("sftp", "nas.local", "pw")
    storage.remove(s["id"])
    assert vault.get(s["id"]) == {}


def test_smb_needs_a_share_and_names_itself_after_it(mem):
    with pytest.raises(storage.Invalid, match="share"):
        storage.add("smb", ["video"], network={"host": "nas"})
    s = storage.add("smb", ["video"], network={"host": "nas", "share": "\\\\films\\\\"})
    assert s["share"] == "films" and s["label"] == "nas/films"
    assert remotefs.root(s | {"path": "/tv"}) == "/films/tv"


@pytest.mark.parametrize(
    "net",
    [{}, {"host": "a b"}, {"host": "nas", "port": "x"}, {"host": "nas", "port": 0}],
)
def test_bad_fields_are_refused(mem, net):
    with pytest.raises(storage.Invalid):
        storage.add("ftp", ["video"], network=net)


def test_a_server_that_refuses_is_offline(mem):
    s = storage.add("ftp", ["video"], network={"host": "off"})
    st = storage.state(s)
    assert st["state"] == "offline" and st["since"]


def test_servers_stay_out_of_the_music_mirror(mem):
    from sestudio.config import load_config

    storage.add("ftp", ["video", "music"], network={"host": "nas"})
    assert load_config().music_libraries == []


def test_the_add_form_tests_a_server(mem):
    library.reset_connection()
    c = TestClient(create_app())
    ok = c.post("/api/storages/test", json={"kind": "ftp", "roles": ["video"],
                "host": "nas", "path": "/films", "password": "pw"})  # fmt: skip
    assert ok.status_code == 200 and ok.json() == {"folders": 2}
    bad = c.post(
        "/api/storages/test", json={"kind": "ftp", "roles": ["video"], "host": "off"}
    )
    assert bad.status_code == 400 and "refused" in bad.text
    added = c.post("/api/storages", json={"kind": "smb", "roles": ["video"], "host": "nas",
                   "share": "films", "username": "me", "password": "secret"})  # fmt: skip
    assert added.status_code == 200 and "secret" not in added.text
    assert "secret" not in c.get("/api/storages").text
    assert json.loads(c.get("/api/settings").text).get("storages") is None
    library.reset_connection()


# --- listing, relay, playback (PRs 8–10) ----------------------------------------


@pytest.fixture()
def served(mem, tmp_path):
    fs, _ = mem
    fs.pipe("/films/Show/Season 01/VF/S01E01 - Pilot.mkv", b"0123456789")
    library.reset_connection()
    from sestudio import downloaded

    downloaded.invalidate()
    storage._lists.clear()
    c = TestClient(create_app())
    (tmp_path / "out").mkdir()
    c.put("/api/settings", json={"output_root": str(tmp_path / "out")})
    s = storage.add("ftp", ["video"], "Seedbox", path="/films", network={"host": "nas"})
    yield c, s
    library.reset_connection()


def test_a_server_is_listed_like_a_folder(served):
    c, s = served
    titles = {t["series"]: t for t in c.get("/api/downloaded").json()}
    show = titles["Show"]
    assert show["storages"] == [s["id"]]
    [f] = show["files"]
    assert (f["rel"], f["path"], f["size"]) == (
        "Show/Season 01/VF/S01E01 - Pilot.mkv",
        f"{s['id']}:Show/Season 01/VF/S01E01 - Pilot.mkv",
        10,
    )


def test_the_relay_serves_ranges(served):
    c, s = served
    url = f"/api/storages/{s['id']}/raw/Show/Season 01/VF/S01E01 - Pilot.mkv"
    full = c.get(url)
    assert full.status_code == 200 and full.content == b"0123456789"
    part = c.get(url, headers={"Range": "bytes=2-5"})
    assert part.status_code == 206 and part.content == b"2345"
    assert part.headers["content-range"] == "bytes 2-5/10"
    tail = c.get(url, headers={"Range": "bytes=-3"})
    assert tail.content == b"789"
    assert c.get(url, headers={"Range": "bytes=20-"}).status_code == 416
    assert c.get(f"/api/storages/{s['id']}/raw/%2E%2E/etc/passwd").status_code == 403


def test_a_listed_key_plays_from_the_server(served):
    c, s = served
    key = f"{s['id']}:Show/Season 01/VF/S01E01 - Pilot.mkv"
    resp = c.get(
        "/api/downloaded/file", params={"path": key}, headers={"Range": "bytes=0-3"}
    )
    assert resp.status_code == 206 and resp.content == b"0123"


def test_ffmpeg_is_handed_the_relay_url(served, monkeypatch):
    _, s = served
    monkeypatch.setattr(remotefs, "RELAY", "http://127.0.0.1:9999")
    f = remotefs.top(s) / "Show" / "Season 01" / "VF" / "S01E01 - Pilot.mkv"
    assert remotefs.media_input(f) == (
        f"http://127.0.0.1:9999/api/storages/{s['id']}/raw/Show/Season%2001/VF/S01E01%20-%20Pilot.mkv"
    )
    assert f.stat().st_size == 10 and f.suffix == ".mkv" and f.stem == "S01E01 - Pilot"


def test_sidecar_subtitles_beside_a_file_on_a_server(served):
    c, s = served
    fs = remotefs._open(s)
    fs.pipe("/films/Show/Season 01/VF/S01E01 - Pilot.fr.vtt", b"WEBVTT\n")
    key = f"{s['id']}:Show/Season 01/VF/S01E01 - Pilot.mkv"
    resp = c.get("/api/downloaded/subtitle", params={"path": key, "sidecar": "fr"})
    assert resp.status_code == 200 and resp.text == "WEBVTT\n"


def test_ffmpeg_reads_a_server_file_through_the_relay(served, monkeypatch, tmp_path):
    """End to end: a real ffprobe, a real HTTP server, the relay, the file on the server."""
    import socket
    import subprocess
    import threading
    import time

    import uvicorn

    from sestudio import downloaded
    from sestudio.media import ffmpeg_binary

    c, s = served
    clip = tmp_path / "clip.mp4"
    subprocess.run(
        [ffmpeg_binary(), "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=64x48:rate=10",
         "-pix_fmt", "yuv420p", str(clip)],
        check=True,
    )  # fmt: skip
    remotefs._open(s).pipe("/films/Clip.mp4", clip.read_bytes())
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(c.app, host="127.0.0.1", port=port, log_level="error")
    )
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    monkeypatch.setattr(remotefs, "RELAY", f"http://127.0.0.1:{port}")
    try:
        target = remotefs.top(s) / "Clip.mp4"
        assert abs((downloaded.duration_of(target) or 0) - 2.0) < 0.3
    finally:
        server.should_exit = True


# --- music on a server (PR 12) --------------------------------------------------


def test_a_server_holding_music_is_a_music_library(served, monkeypatch):
    from sestudio import downloaded
    from sestudio.music import libraries

    c, _ = served
    monkeypatch.setattr(
        downloaded, "audio_info", lambda f: ("Artist", "Song", "Album", 3.0)
    )
    fs = remotefs._open({"id": "x", "kind": "ftp", "host": "nas"})
    fs.pipe("/music/Album/01 Song.mp3", b"ID3-bytes")
    s = storage.add("ftp", ["music"], "Tunes", path="/music", network={"host": "nas"})
    storage.files_of(s)  # the background listing a page load starts
    for _ in range(50):
        if storage._lists[s["id"]]["files"]:
            break
        import time

        time.sleep(0.05)
    row = next(r for r in c.get("/api/music/libraries").json() if r["id"] == s["id"])
    assert row["kind"] == "ftp" and row["count"] == 1 and row["state"] == "online"
    [track] = [t for t in libraries.other_tracks() if t["library"] == s["id"]]
    assert (track["title"], track["artist"]) == ("Song", "Artist")
    audio = c.get(f"/api/music/libraries/{s['id']}/tracks/{track['id']}/audio",
                  headers={"Range": "bytes=0-2"})  # fmt: skip
    assert audio.status_code == 206 and audio.content == b"ID3"
    # the music page lists it; the video shelf does not
    assert not any(s["id"] in t["storages"] for t in c.get("/api/downloaded").json())
