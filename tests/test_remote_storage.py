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
