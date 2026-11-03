"""The folder browser behind "Add a library", and the Android app's default libraries."""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.music import folders, libraries
from sestudio.web.app import create_app


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config" / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(downloaded, "audio_info", lambda f: ("", "", "", None))
    library.reset_connection()
    downloaded.invalidate()
    yield TestClient(create_app()), tmp_path
    library.reset_connection()


def tree(tmp_path):
    root = tmp_path / "tree"
    (root / "Rock" / "Album").mkdir(parents=True)
    (root / "Rock" / "Album" / "a.mp3").write_bytes(b"x")
    (root / "Rock" / "b.flac").write_bytes(b"x")
    (root / "Empty").mkdir()
    (root / "Docs").mkdir()
    (root / "Docs" / "note.txt").write_text("hi")
    (root / ".hidden").mkdir()
    (root / ".hidden" / "c.mp3").write_bytes(b"x")
    (root / "file.mp3").write_bytes(b"x")
    return root


def test_browse_lists_visible_subfolders_with_audio_counts(env):
    c, tmp_path = env
    root = tree(tmp_path)
    r = c.get("/api/music/folders", params={"path": str(root)})
    assert r.status_code == 200
    body = r.json()
    rows = {f["name"]: f for f in body["folders"]}
    assert list(rows) == ["Docs", "Empty", "Rock"]  # sorted, no hidden, no files
    assert rows["Rock"]["audio"] == 2 and rows["Rock"]["has_children"]
    assert rows["Empty"]["audio"] == 0 and not rows["Empty"]["has_children"]
    assert body["parent"] == str(tmp_path)
    assert body["crumbs"][-1] == {"name": "tree", "path": str(root)}


def test_browse_count_is_capped(env, monkeypatch):
    c, tmp_path = env
    root = tree(tmp_path)
    monkeypatch.setattr(folders, "SCAN_CAP", 1)
    rock = next(
        f
        for f in c.get("/api/music/folders", params={"path": str(root)}).json()[
            "folders"
        ]
        if f["name"] == "Rock"
    )
    assert rock["capped"]


@pytest.mark.skipif(
    os.name == "nt" or os.geteuid() == 0, reason="needs POSIX permissions"
)
def test_unreadable_folder_is_shown_not_failing(env):
    c, tmp_path = env
    root = tree(tmp_path)
    locked = root / "Docs"
    locked.chmod(0)
    try:
        body = c.get("/api/music/folders", params={"path": str(root)}).json()
        row = next(f for f in body["folders"] if f["name"] == "Docs")
        assert not row["readable"]
        inside = c.get("/api/music/folders", params={"path": str(locked)})
        assert inside.status_code == 200 and not inside.json()["readable"]
    finally:
        locked.chmod(0o755)


def test_browse_rejects_missing_or_relative_path(env):
    c, tmp_path = env
    assert (
        c.get("/api/music/folders", params={"path": str(tmp_path / "nope")}).status_code
        == 400
    )
    assert (
        c.get("/api/music/folders", params={"path": "relative/dir"}).status_code == 400
    )


def test_roots_include_downloads_and_android_storage(env):
    c, tmp_path = env
    out = tmp_path / "out"
    out.mkdir()
    phone = tmp_path / "storage"
    phone.mkdir()
    c.put("/api/settings", json={"output_root": str(out)})
    (tmp_path / "config" / "android_storage.json").write_text(
        json.dumps({"roots": [{"label": "Phone", "path": str(phone)}], "folders": []})
    )
    roots = c.get("/api/music/folders").json()["roots"]
    assert roots[0] == {"label": "Phone", "path": str(phone)}
    assert {"label": "Downloads", "path": str(out)} in roots
    assert len({r["path"] for r in roots}) == len(roots)


def write_storage(tmp_path, *dirs):
    path = tmp_path / "config"
    path.mkdir(exist_ok=True)
    (path / "android_storage.json").write_text(
        json.dumps(
            {
                "roots": [],
                "folders": [
                    {"label": f"Phone · {d.name}", "path": str(d)} for d in dirs
                ],
            }
        )
    )


def test_default_libraries_are_added_once_and_skip_missing(env):
    _, tmp_path = env
    music = tmp_path / "Music"
    music.mkdir()
    write_storage(tmp_path, music, tmp_path / "Podcasts")  # Podcasts does not exist
    libraries.sync_defaults()
    libraries.sync_defaults()
    got = libraries.registered()
    assert [(x["label"], x["path"]) for x in got] == [("Phone · Music", str(music))]
    assert got[0]["kind"] == libraries.FOLDER


def test_removed_default_stays_removed_but_new_ones_appear(env):
    _, tmp_path = env
    music, download = tmp_path / "Music", tmp_path / "Download"
    music.mkdir()
    write_storage(tmp_path, music, download)
    libraries.sync_defaults()
    libraries.remove(libraries.registered()[0]["id"])
    download.mkdir()
    libraries.sync_defaults()
    assert [x["path"] for x in libraries.registered()] == [str(download)]


def test_no_storage_file_means_no_defaults(env):
    libraries.sync_defaults()
    assert libraries.registered() == []
