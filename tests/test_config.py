from __future__ import annotations

import os

import pytest

from sestudio.config import AppConfig, load_config, save_config


def test_defaults_when_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("FSTREAM_DL_CONFIG", str(tmp_path / "config.json"))
    cfg = load_config()
    assert cfg.output_root == "."
    assert cfg.lang == "vf"


def test_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("FSTREAM_DL_CONFIG", str(tmp_path / "config.json"))
    save_config(AppConfig(output_root="/tmp/dl", lang="vostfr"))
    cfg = load_config()
    assert cfg.output_root == "/tmp/dl"
    assert cfg.lang == "vostfr"


def test_partial_config(tmp_path, monkeypatch):
    monkeypatch.setenv("FSTREAM_DL_CONFIG", str(tmp_path / "config.json"))
    (tmp_path / "config.json").write_text('{"lang": "vostfr"}')
    cfg = load_config()
    assert cfg.lang == "vostfr"
    assert cfg.output_root == "."


def test_corrupt_config_returns_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("FSTREAM_DL_CONFIG", str(tmp_path / "config.json"))
    (tmp_path / "config.json").write_text("not json")
    cfg = load_config()
    assert cfg == AppConfig()
