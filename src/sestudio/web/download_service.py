from __future__ import annotations

import asyncio
import dataclasses
import logging
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from sestudio import downloaded, library, storage
from sestudio.config import AppConfig, load_config
from sestudio.config import reconcile
from sestudio.downloader import audio_file
from sestudio.models import StreamSource, sanitize_path_component
from sestudio.providers.base import ProviderError
from sestudio.sites import ContentSite, SiteError, StreamCandidate, site_for
from sestudio.web.worker import DownloadJob, JobStore

logger = logging.getLogger(__name__)

# Queueing a download is more than a store.submit(): candidates have to be
# ordered and resolved with fallback, the output path built, the metadata
# recorded, and an existing file skipped. The HTTP route and the watcher poller
# both need all of it, so it lives here rather than in either caller.

Lane = Literal["user", "watcher"]


@dataclass
class DownloadSpec:
    """What to download. Mirrors the fields the HTTP request carries."""

    episode_name: str
    series_name: str = ""
    season: int = 0
    embed_url: str = ""
    provider: str = ""
    lang: str = ""
    all_providers: dict[str, str] = field(default_factory=dict)
    poster_url: str = ""
    page_url: str = ""
    to_device: bool = False
    source: str = "fstream"
    # Only the sound, kept as a music track (a page yt-dlp downloads: YouTube).
    audio_only: bool = False


@dataclass
class QueueResult:
    episode_name: str
    status: Literal["queued", "skipped", "error"]
    job: DownloadJob | None = None
    error: str | None = None


def episode_path(root: str, spec: DownloadSpec, site: ContentSite) -> Path:
    """Build the output file path, with a per-language subfolder.

    ``<root>/<Series>/Season NN/<LANG>/<file>`` for episodes, or
    ``<root>/<site films dir>/<LANG>/<file>`` for films. The language folder is
    omitted when no language is given (e.g. CLI downloads).
    """
    safe_ep = sanitize_path_component(spec.episode_name)
    if spec.season == 0:
        parts = [root, site.films_dirname]
    else:
        parts = [
            root,
            sanitize_path_component(spec.series_name),
            f"Season {spec.season:02d}",
        ]
    if spec.lang:
        parts.append(sanitize_path_component(spec.lang.upper()))
    return Path(*parts) / safe_ep


def config_storages(cfg: AppConfig) -> list[dict]:
    """*cfg*'s storages, sound: a config built in code (a test, the CLI) has none yet."""
    return reconcile(cfg).storages


class StorageUnavailable(Exception):
    """The storage downloads go to cannot take one now: away, or full."""


#: Below this much room, the download storage counts as full (SPEC-storage S8).
MIN_FREE_BYTES = 1 * 10**9


def download_root(cfg: AppConfig) -> dict:
    """The storage new downloads go to, checked: answers, and has room.

    Checked before anything is resolved or written, so a download fails with
    the reason at once rather than halfway through (SPEC-storage S8).
    """
    target = next(s for s in config_storages(cfg) if s["download"])
    if not storage.online(target):
        raise StorageUnavailable(f"{target['label']} is offline")
    try:
        free = shutil.disk_usage(target["path"]).free
    except OSError:
        free = None
    if free is not None and free < MIN_FREE_BYTES:
        raise StorageUnavailable(f"{target['label']} is full: {free // 10**6} MB free")
    return target


def record_downloaded_file(
    root: str, out_path: Path, spec: DownloadSpec, storage_id: str = storage.LOCAL
) -> None:
    """Note what this download is, keyed as the listing keys it (`storage:path`
    off ``local``, see ``routes/downloaded.media_key``).

    The path records the series only in sanitised form and says nothing about
    the poster, the page or the site, so the local library reads them back from
    here. Failures are swallowed: metadata is a nicety, the download is not.
    """
    try:
        relative = out_path.resolve().relative_to(Path(root).resolve()).as_posix()
    except ValueError:
        return  # outside the root (a device download) — not part of the library
    if storage_id != storage.LOCAL:
        relative = f"{storage_id}:{relative}"
    try:
        library.set_downloaded_file(
            relative,
            {
                "series_name": spec.series_name,
                "season": spec.season,
                "lang": spec.lang,
                "source": spec.source,
                "poster_url": spec.poster_url,
                "page_url": spec.page_url,
            },
        )
        downloaded.invalidate()
    except Exception as exc:  # pragma: no cover - a bad DB must not stop a download
        logger.warning("Could not record local file %s: %s", relative, exc)


def _ordered_candidates(
    spec: DownloadSpec, site: ContentSite, cfg: AppConfig
) -> list[StreamCandidate]:
    """Primary provider first, then the rest in the viewer's preferred order.

    Ranking only reorders the fallback chain — an unranked host is still tried,
    just later, so a preference never costs a download.
    """
    candidates = [
        c
        for c in site.stream_candidates(spec.all_providers)
        if c.provider != spec.provider
    ]
    if cfg.preferred_hosts:
        rank = {host: i for i, host in enumerate(cfg.preferred_hosts)}
        candidates.sort(key=lambda c: rank.get(c.provider, len(rank)))
    if spec.provider and spec.embed_url:
        candidates.insert(0, StreamCandidate(spec.provider, spec.embed_url))
    return candidates


async def queue_download(
    spec: DownloadSpec,
    *,
    store: JobStore,
    sites: dict[str, ContentSite],
    cfg: AppConfig | None = None,
    lane: Lane = "user",
) -> QueueResult:
    """Resolve a stream and queue it, or say why not.

    *lane* separates background work from what the user asked for: watcher jobs
    are admitted a couple at a time so they cannot fill the pool and stall an
    interactive download.
    """
    cfg = cfg or load_config()
    site = site_for(sites, spec.source)
    if not spec.to_device:
        try:
            target = await asyncio.to_thread(download_root, cfg)
        except StorageUnavailable as exc:
            return QueueResult(spec.episode_name, "error", error=str(exc))

    source: StreamSource | None = None
    last_error = "No supported provider available"
    tried: list[str] = []
    for cand in _ordered_candidates(spec, site, cfg):
        try:
            source = await asyncio.to_thread(
                site.resolve_candidate, cand, store._providers
            )
            tried.append(cand.provider)
            logger.debug("Resolved %s via %s", spec.episode_name, cand.provider)
            break
        except (ProviderError, SiteError) as exc:
            last_error = str(exc)
            tried.append(cand.provider)
            logger.warning(
                "Provider %s failed for %s: %s — trying next",
                cand.provider,
                spec.episode_name,
                exc,
            )

    if source is None:
        logger.warning("Could not resolve %s: %s", spec.episode_name, last_error)
        return QueueResult(spec.episode_name, "error", error=last_error)

    audio = spec.audio_only and not spec.to_device and bool(source.extract_url)
    if audio:
        source = dataclasses.replace(source, audio_only=True)

    safe_ep = sanitize_path_component(spec.episode_name)
    if spec.to_device:
        # Staged in a temp dir for the browser to collect; never treated as part
        # of the library, so the "already downloaded" check is skipped.
        out_path = Path(tempfile.mkdtemp(prefix="sestudio-device-")) / safe_ep
    else:
        out_path = episode_path(target["path"], spec, site)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not spec.to_device:
        # Recorded before the skip check below, so re-queueing a file that is
        # already on disk is also the way to backfill metadata for anything
        # downloaded before this was kept.
        record_downloaded_file(target["path"], out_path, spec, target["id"])

        if audio_file(out_path) or (out_path.exists() and out_path.stat().st_size > 0):
            logger.info(
                "Skipping %s: already exists at %s", spec.episode_name, out_path
            )
            return QueueResult(spec.episode_name, "skipped")

        # Two watchers can cover the same title, and the user can queue a title a
        # watcher is already fetching. Writing the same path twice would have both
        # yt-dlp processes fighting over one file.
        if any(
            job.output_path == out_path
            and job.status not in ("done", "failed", "cancelled")
            for job in store.all_jobs()
        ):
            logger.info("Skipping %s: already downloading", spec.episode_name)
            return QueueResult(spec.episode_name, "skipped")

        # Remove any 0-byte remnant from a previous failed attempt
        if out_path.exists():
            out_path.unlink()

    # Pass the untried providers so the worker can fall back if this one fails.
    remaining = {k: v for k, v in spec.all_providers.items() if k not in tried}
    job = store.submit(
        source,
        out_path,
        safe_ep,
        all_providers=remaining,
        to_device=spec.to_device,
        site_id=site.id,
        lane=lane,
        series=spec.series_name,
        season=spec.season,
        poster_url=spec.poster_url,
    )
    return QueueResult(spec.episode_name, "queued", job=job)
