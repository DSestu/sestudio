from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path.home() / ".config" / "sestudio" / "config.json"

# A key baked into released wheels by the release workflow, so `uvx sestudio`
# has metadata working out of the box. The module is generated at build time
# and is absent from the repo (and from local builds), hence the guard.
try:
    from sestudio._tmdb_default import (  # type: ignore[import-not-found]
        TMDB_API_KEY as _DEFAULT_TMDB_API_KEY,
    )
except ImportError:
    _DEFAULT_TMDB_API_KEY = ""


@dataclass
class AppConfig:
    output_root: str = "."
    lang: str = "vf"
    # Web UI default download destination: "server" (job queue on the server's
    # disk) or "device" (forwarded to the browser as a file download).
    download_destination: str = "server"
    # Optional TMDB key enabling metadata enrichment; empty disables the feature.
    tmdb_api_key: str = ""
    # Merge search results by their resolved TMDB id rather than by title. Costs
    # a lookup per result, so it stays opt-in and needs a key to do anything.
    tmdb_merge: bool = False
    # Dress search result cards in TMDB posters, ratings and years. On by
    # default (it is the point of configuring a key); off falls back to the
    # source's own posters and titles.
    tmdb_cards: bool = True


def _config_path() -> Path:
    env = os.environ.get("SESTUDIO_CONFIG")
    return Path(env) if env else _CONFIG_PATH


def load_config() -> AppConfig:
    path = _config_path()
    if not path.exists():
        return AppConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return AppConfig(
            output_root=str(data.get("output_root", ".")),
            lang=str(data.get("lang", "vf")),
            download_destination=str(data.get("download_destination", "server")),
            tmdb_api_key=str(data.get("tmdb_api_key", "")),
            tmdb_merge=bool(data.get("tmdb_merge", False)),
            tmdb_cards=bool(data.get("tmdb_cards", True)),
        )
    except Exception as exc:
        logger.warning("Failed to read config at %s (%s), using defaults", path, exc)
        return AppConfig()


def tmdb_key() -> str:
    """TMDB API key: environment, then saved config, then the shipped default.

    Env first so it needn't be stored on disk; the built-in default last so a
    user-supplied key always wins over it.
    """
    return (
        os.environ.get("TMDB_API_KEY")
        or load_config().tmdb_api_key
        or _DEFAULT_TMDB_API_KEY
    )


def save_config(cfg: AppConfig) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(cfg), indent=2), encoding="utf-8")
    tmp.replace(path)
    logger.debug("Config saved to %s", path)
