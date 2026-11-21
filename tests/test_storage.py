"""Storages: the registry, its migration from the older keys, and the mirrors (SPEC-storage PR 1)."""

from __future__ import annotations

import json

import pytest

from sestudio import storage
from sestudio.config import AppConfig, load_config, save_config
from sestudio.music import libraries


@pytest.fixture()
def cfg_path(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    monkeypatch.setenv("SESTUDIO_CONFIG", str(path))
    return path


def test_fresh_config_has_local_as_download_target(cfg_path):
    [local] = load_config().storages
    assert local == {
        "id": "local", "kind": "folder", "label": "This PC", "path": ".",
        "roles": ["video", "music"], "download": True,
    }  # fmt: skip


def test_old_config_migrates_and_keeps_its_ids(cfg_path, tmp_path):
    old = {
        "output_root": str(tmp_path),
        "music_libraries": [
            {"id": "f1", "kind": "local_folder", "label": "Nas", "path": "/nas"},
            {"id": "r1", "kind": "remote_sestudio", "label": "Other",
             "url": "https://o", "token": "sst_x"},
        ],
    }  # fmt: skip
    cfg_path.write_text(json.dumps(old))
    cfg = load_config()
    assert [(s["id"], s["kind"], s["roles"], s["download"]) for s in cfg.storages] == [
        ("local", "folder", ["video", "music"], True),
        ("f1", "folder", ["music"], False),
        ("r1", "remote_sestudio", ["music"], False),
    ]
    assert cfg.storages[0]["path"] == str(tmp_path)
    # the mirror older readers use is unchanged
    assert cfg.music_libraries == old["music_libraries"]
    save_config(cfg)
    stored = json.loads(cfg_path.read_text())
    assert stored["music_libraries"] == old["music_libraries"]
    assert stored["output_root"] == str(tmp_path)
    assert len(stored["storages"]) == 3


def test_output_root_still_moves_local(cfg_path):
    cfg = load_config()
    cfg.output_root = "/media/new"
    save_config(cfg)
    assert storage.get("local")["path"] == "/media/new"


def test_add_roles_download_and_remove(cfg_path, tmp_path):
    films = tmp_path / "films"
    films.mkdir()
    s = storage.add("folder", ["video"], "", str(films))
    assert s["label"] == "films" and s["roles"] == ["video"] and not s["download"]
    # a video-only folder is not a music library
    assert all(lib["id"] != s["id"] for lib in load_config().music_libraries)

    storage.set_download(s["id"])
    assert storage.download_target()["id"] == s["id"]
    assert [x["download"] for x in storage.all_storages()] == [False, True]

    storage.set_roles(s["id"], ["video", "music"])
    assert any(lib["id"] == s["id"] for lib in load_config().music_libraries)

    storage.rename(s["id"], "  NAS films ")
    assert storage.get(s["id"])["label"] == "NAS films"

    storage.remove(s["id"])
    assert storage.download_target()["id"] == "local"
    assert films.is_dir()  # files are never touched


@pytest.mark.parametrize(
    "call",
    [
        lambda: storage.add("folder", ["video"], path="/does/not/exist"),
        lambda: storage.add("folder", [], path="."),
        lambda: storage.add("folder", ["video", "pictures"], path="."),
        lambda: storage.add("ytmusic_account", ["video"]),
        lambda: storage.add("ftp", ["video"]),
        lambda: storage.remove("local"),
        lambda: storage.get("nope"),
    ],
)
def test_refusals(cfg_path, call):
    with pytest.raises(storage.Invalid):
        call()


def test_downloads_only_go_to_a_folder(cfg_path):
    s = storage.add("remote_sestudio", ["music"], url="https://o", token="t")
    with pytest.raises(storage.Invalid):
        storage.set_download(s["id"])


def test_removing_a_music_library_keeps_a_video_storage(cfg_path, tmp_path):
    both = storage.add("folder", ["video", "music"], path=str(tmp_path))
    libraries.remove(both["id"])
    assert storage.get(both["id"])["roles"] == ["video"]
    assert str(tmp_path) in load_config().music_dismissed
    only = libraries.add("local_folder", path=str(tmp_path))
    libraries.remove(only["id"])
    with pytest.raises(storage.Invalid):
        storage.get(only["id"])


def test_broken_entries_are_dropped_and_one_target_kept(cfg_path, tmp_path):
    cfg_path.write_text(json.dumps({
        "output_root": str(tmp_path),
        "storages": [
            {"id": "local", "kind": "folder", "roles": ["video"], "download": True},
            {"id": "a", "kind": "folder", "path": "/a", "roles": ["video"], "download": True},
            {"id": "a", "kind": "folder", "path": "/dup"},
            {"kind": "folder"},
            {"id": "nopath", "kind": "folder"},
            {"id": "r", "kind": "remote_sestudio", "download": True},
        ],
    }))  # fmt: skip
    cfg = load_config()
    assert [s["id"] for s in cfg.storages] == ["local", "a", "r"]
    assert [s["download"] for s in cfg.storages] == [True, False, False]
    assert cfg.storages[2]["roles"] == ["music"]


def test_round_trip_of_a_plain_config(cfg_path):
    save_config(AppConfig(output_root="/tmp/dl"))
    assert load_config().storages[0]["path"] == "/tmp/dl"
