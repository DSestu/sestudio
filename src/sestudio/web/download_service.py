from __future__ import annotations

import asyncio
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from sestudio import downloaded, library
from sestudio.config import AppConfig, load_config
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


def record_downloaded_file(root: str, out_path: Path, spec: DownloadSpec) -> None:
    """Note what this download is, keyed by its path under the download root.

    The path records the series only in sanitised form and says nothing about
    the poster, the page or the site, so the local library reads them back from
    here. Failures are swallowed: metadata is a nicety, the download is not.
    """
    try:
        relative = out_path.resolve().relative_to(Path(root).resolve()).as_posix()
    except ValueError:
        return  # outside the root (a device download) — not part of the library
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

    safe_ep = sanitize_path_component(spec.episode_name)
    if spec.to_device:
        # Staged in a temp dir for the browser to collect; never treated as part
        # of the library, so the "already downloaded" check is skipped.
        out_path = Path(tempfile.mkdtemp(prefix="sestudio-device-")) / safe_ep
    else:
        out_path = episode_path(cfg.output_root, spec, site)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not spec.to_device:
        # Recorded before the skip check below, so re-queueing a file that is
        # already on disk is also the way to backfill metadata for anything
        # downloaded before this was kept.
        record_downloaded_file(cfg.output_root, out_path, spec)

        if out_path.exists() and out_path.stat().st_size > 0:
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
    )
    return QueueResult(spec.episode_name, "queued", job=job)
