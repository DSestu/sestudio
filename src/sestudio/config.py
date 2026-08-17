from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
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


# What a download reaches for first, most-wanted last-resort last. Senpai leads
# because it serves its own files (no third-party host to go down), then the
# hosts that have proved most reliable. Anything not listed still runs as
# fallback, after these.
DEFAULT_DOWNLOAD_ORDER: list[str] = [
    "senpai",
    "premium",
    "uqload",
    "vidzy",
    "netu",
    "voe",
]


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
    tmdb_posters: bool = True
    # Content sites excluded from search. Stored as an opt-out list so a newly
    # added site is enabled by default. Only search is affected: a disabled
    # site still resolves streams, so saved library entries keep working.
    disabled_sites: list[str] = field(default_factory=list)
    # The site to favour when several carry the same title: its results are
    # listed first, and it wins the card when listings are merged. Senpai
    # serves its own files rather than third-party embeds, so it is the most
    # dependable default.
    preferred_site: str = "senpai"
    # Download preference, most-wanted first; see DEFAULT_DOWNLOAD_ORDER.
    # Anything unlisted still runs as fallback, after the ranked entries, so an
    # order can change which host is used but never whether a file can be got.
    preferred_hosts: list[str] = field(
        default_factory=lambda: list(DEFAULT_DOWNLOAD_ORDER)
    )
    # Which site a title is taken from when several carry it.
    preferred_sites: list[str] = field(default_factory=lambda: ["senpai"])
    # Start playing as soon as a title is opened, unless something is already
    # playing — that keeps the floor. Off means opening a title only browses it:
    # the description and episode list, nothing started until you press play.
    autoplay_on_open: bool = True
    # Show one card per show in search results instead of one per season, with
    # the season count on the card. On by default: a long-running series
    # otherwise fills the grid with near-identical cards.
    collapse_seasons: bool = True


def _config_path() -> Path:
    env = os.environ.get("SESTUDIO_CONFIG")
    return Path(env) if env else _CONFIG_PATH


def config_dir() -> Path:
    """Where this app keeps its own files — settings, library, derived caches.

    Follows ``SESTUDIO_CONFIG`` so a test (or a second instance) that redirects
    the settings takes everything else with it.
    """
    return _config_path().parent


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
            tmdb_posters=bool(data.get("tmdb_posters", True)),
            disabled_sites=[str(s) for s in data.get("disabled_sites", []) or []],
            preferred_site=str(data.get("preferred_site", "senpai")),
            preferred_hosts=[
                str(h) for h in data.get("preferred_hosts", DEFAULT_DOWNLOAD_ORDER)
            ],
            preferred_sites=[str(s) for s in data.get("preferred_sites", ["senpai"])],
            autoplay_on_open=bool(data.get("autoplay_on_open", True)),
            collapse_seasons=bool(data.get("collapse_seasons", True)),
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
