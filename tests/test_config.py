from __future__ import annotations


from sestudio import config as config_module
from sestudio.config import AppConfig, load_config, save_config, tmdb_key


def test_defaults_when_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    cfg = load_config()
    assert cfg.output_root == "."
    assert cfg.lang == "vf"


def test_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    save_config(AppConfig(output_root="/tmp/dl", lang="vostfr"))
    cfg = load_config()
    assert cfg.output_root == "/tmp/dl"
    assert cfg.lang == "vostfr"


def test_partial_config(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    (tmp_path / "config.json").write_text('{"lang": "vostfr"}')
    cfg = load_config()
    assert cfg.lang == "vostfr"
    assert cfg.output_root == "."


def test_tmdb_merge_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    assert load_config().tmdb_merge is False
    save_config(AppConfig(tmdb_merge=True))
    assert load_config().tmdb_merge is True


def test_tmdb_cards_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    # On by default, and a stored false survives the round trip rather than
    # being read back as the default.
    assert load_config().tmdb_cards is True
    save_config(AppConfig(tmdb_cards=False))
    assert load_config().tmdb_cards is False


def test_corrupt_config_returns_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    (tmp_path / "config.json").write_text("not json")
    cfg = load_config()
    assert cfg == AppConfig()


def test_tmdb_key_precedence(tmp_path, monkeypatch):
    """Env beats saved config, which beats the key baked into release wheels."""
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setattr(config_module, "_DEFAULT_TMDB_API_KEY", "baked-in")

    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    assert tmdb_key() == "baked-in"

    save_config(AppConfig(tmdb_api_key="from-config"))
    assert tmdb_key() == "from-config"

    monkeypatch.setenv("TMDB_API_KEY", "from-env")
    assert tmdb_key() == "from-env"


def test_tmdb_key_empty_without_a_baked_in_default(tmp_path, monkeypatch):
    """Local builds ship no default, so the feature stays opt-in there."""
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setattr(config_module, "_DEFAULT_TMDB_API_KEY", "")
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    assert tmdb_key() == ""
