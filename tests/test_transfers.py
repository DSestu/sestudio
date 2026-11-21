"""Copy and move between storages (SPEC-storage §9, X2): the transfer engine."""

from __future__ import annotations

import time

import fsspec
import pytest

from sestudio import library, remotefs, storage, transfers

REL = "Show/Season 01/VF/S01E01 - Pilot.mkv"


@pytest.fixture()
def two(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library.reset_connection()
    storage._state.clear()
    storage._lists.clear()
    transfers._jobs.clear()
    out, nas = tmp_path / "out", tmp_path / "nas"
    (out / REL).parent.mkdir(parents=True)
    (out / REL).write_bytes(b"0123456789")
    (out / REL).with_name("S01E01 - Pilot.fr.vtt").write_text("WEBVTT\n")
    nas.mkdir()
    from sestudio.config import load_config, save_config

    cfg = load_config()
    cfg.output_root = str(out)
    save_config(cfg)
    dest = storage.add("folder", ["video"], "NAS films", str(nas))
    yield out, nas, dest["id"]
    library.reset_connection()


def _wait(job_id: str) -> dict:
    for _ in range(200):
        job = next(j for j in transfers.all_jobs() if j["id"] == job_id)
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError("the transfer never finished")


def test_copy_keeps_the_original_and_its_path(two):
    out, nas, dest = two
    job = _wait(transfers.create([REL], dest, "copy").id)
    assert job["status"] == "done" and job["done_bytes"] >= 10
    assert (nas / REL).read_bytes() == b"0123456789" and (out / REL).exists()
    assert (nas / REL).with_name("S01E01 - Pilot.fr.vtt").exists()  # the sidecar too
    assert not list(nas.rglob("*.part"))


def test_move_deletes_only_after_the_copy_and_carries_the_metadata(two):
    out, nas, dest = two
    library.set_downloaded_file(REL, {"series_name": "My Show"})
    job = _wait(transfers.create([REL], dest, "move").id)
    assert job["status"] == "done"
    assert not (out / REL).exists() and (nas / REL).exists()
    assert not (out / REL).with_name("S01E01 - Pilot.fr.vtt").exists()
    rows = library.downloaded_files()
    assert REL not in rows and rows[f"{dest}:{REL}"] == {"series_name": "My Show"}


@pytest.mark.parametrize(
    ("conflict", "expect_name", "status"),
    [("skip", None, "skipped"), ("replace", "S01E01 - Pilot.mkv", "done"),
     ("keep_both", "S01E01 - Pilot (2).mkv", "done")],
)  # fmt: skip
def test_conflicts(two, conflict, expect_name, status):
    out, nas, dest = two
    (nas / REL).parent.mkdir(parents=True)
    (nas / REL).write_bytes(b"old")
    job = _wait(transfers.create([REL], dest, "copy", conflict).id)
    assert job["items"][0]["status"] == status
    if expect_name:
        assert (nas / REL).with_name(expect_name).read_bytes() == b"0123456789"
    else:
        assert (nas / REL).read_bytes() == b"old"


def test_a_folder_puts_every_file_in_it(two):
    out, nas, dest = two
    _wait(transfers.create([REL], dest, "copy", "skip", "Films/New").id)
    assert (nas / "Films/New/S01E01 - Pilot.mkv").exists()


def test_refusals(two, monkeypatch):
    out, nas, dest = two
    with pytest.raises(transfers.Invalid, match="Already on"):
        transfers.create([f"{dest}:x.mkv"], dest, "copy")
    tiny = type("U", (), {"free": 5, "total": 100})()
    monkeypatch.setattr(transfers.shutil, "disk_usage", lambda p: tiny)
    with pytest.raises(transfers.Invalid, match="Not enough room on NAS films"):
        transfers.create([REL], dest, "copy")
    with pytest.raises(transfers.Invalid, match="Copy or move"):
        transfers.create([REL], dest, "zip")


def test_copy_to_a_server(two, monkeypatch):
    out, _, _ = two
    fs = fsspec.filesystem("memory", skip_instance_cache=True)
    fs.store.clear()
    fs.pseudo_dirs.clear()
    fs.mkdir("/films")
    monkeypatch.setattr(remotefs, "_open", lambda s, secret=None: fs)
    remotefs._cache.clear()
    server = storage.add(
        "sftp", ["video"], "Seedbox", path="/films", network={"host": "nas"}
    )
    job = _wait(transfers.create([REL], server["id"], "copy").id)
    assert job["status"] == "done", job["items"]
    assert fs.cat(f"/films/{REL}") == b"0123456789"


def test_cancel_and_clear(two):
    out, nas, dest = two
    job = transfers.create([REL], dest, "copy")
    transfers.control(job.id, "cancel")
    assert _wait(job.id)["status"] == "cancelled"
    assert transfers.control(job.id, "clear") == {"ok": True}
    assert transfers.all_jobs() == []


def test_the_api(two):
    from fastapi.testclient import TestClient

    from sestudio.web.app import create_app

    out, nas, dest = two
    c = TestClient(create_app())
    bad = c.post("/api/transfers", json={"files": [REL], "to": "nope"})
    assert bad.status_code == 400
    job = c.post(
        "/api/transfers", json={"files": [REL], "to": dest, "mode": "move"}
    ).json()
    assert job["status"] in ("queued", "running", "done") and job["total_bytes"] == 10
    assert _wait(job["id"])["status"] == "done"
    assert c.get("/api/transfers").json()[0]["counts"] == {
        "done": 1,
        "skipped": 0,
        "failed": 0,
    }
    assert c.post(f"/api/transfers/{job['id']}/explode").status_code == 404
