from __future__ import annotations

import asyncio
import logging
from typing import Any

from sestudio import library
from sestudio.config import AppConfig, load_config
from sestudio.models import Episode
from sestudio.sites import site_for
from sestudio.sites.base import ContentSite
from sestudio.watchers.models import Watcher
from sestudio.web.download_service import DownloadSpec, queue_download
from sestudio.web.worker import JobStore

logger = logging.getLogger(__name__)

# Turning a fired event into a download needs the episode's embed URLs, which the
# event does not carry — and could not: an episode that arrived in a language
# other than the one the poll fetched comes back with an empty embed map. So the
# page is re-fetched once per language that actually produced something.


def _episodes_by_number(
    site: ContentSite, page_url: str, lang: str
) -> dict[int, Episode]:
    page = site.fetch_page(page_url, lang)
    return {episode.number: episode for episode in page.episodes}


def _spec_for(
    watcher: Watcher, event: dict[str, Any], episode: Episode, site: ContentSite
) -> DownloadSpec | None:
    if not episode.embed_urls:
        return None
    candidates = site.stream_candidates(episode.embed_urls)
    if not candidates:
        return None
    data = event.get("data") or {}
    return DownloadSpec(
        episode_name=str(data.get("episode_name") or episode.filename),
        series_name=str(data.get("series_name") or watcher.label),
        season=int(data.get("season") or 0),
        embed_url=candidates[0].embed_url,
        provider=candidates[0].provider,
        lang=str(data.get("lang") or ""),
        all_providers=dict(episode.embed_urls),
        poster_url=str(watcher.config.get("poster_url") or ""),
        page_url=str(data.get("page_url") or ""),
        source=site.id,
    )


async def auto_download(
    watcher: Watcher,
    events: list[dict[str, Any]],
    *,
    store: JobStore,
    sites: dict[str, ContentSite],
    cfg: AppConfig | None = None,
) -> int:
    """Queue downloads for the episodes a watcher just reported. Returns the count.

    Runs after the events are committed, so a failure here costs a download but
    never a notification. Anything that cannot be queued is recorded on its event
    rather than un-seen: re-notifying every hour is worse than a download the row
    invites you to retry.
    """
    if not watcher.auto_download:
        return 0
    downloadable = [
        event
        for event in events
        if (event.get("data") or {}).get("kind") == "episode"
        and (event.get("data") or {}).get("page_url")
    ]
    if not downloadable:
        return 0

    cfg = cfg or load_config()
    page_url = str((downloadable[0].get("data") or {}).get("page_url") or "")
    source = str(watcher.config.get("source") or "") or None
    try:
        site = site_for(sites, source, page_url)
    except KeyError:
        logger.warning("Watcher %d: unknown source %r", watcher.id, source)
        return 0

    # One fetch per language, not per episode: a whole season landing in VF is
    # one page fetch, not twenty-four.
    langs = {str((e.get("data") or {}).get("lang") or "") for e in downloadable}
    pages: dict[str, dict[int, Episode]] = {}
    for lang in sorted(langs):
        try:
            pages[lang] = await asyncio.to_thread(
                _episodes_by_number, site, page_url, lang
            )
        except Exception as exc:
            logger.warning(
                "Watcher %d: could not re-fetch %s for %s: %s",
                watcher.id,
                page_url,
                lang,
                exc,
            )
            pages[lang] = {}

    queued = 0
    for event in downloadable:
        data = event.get("data") or {}
        lang = str(data.get("lang") or "")
        number = data.get("number")
        episode = pages.get(lang, {}).get(int(number)) if number is not None else None
        spec = _spec_for(watcher, event, episode, site) if episode else None
        if spec is None:
            _mark(event, None, "error")
            continue
        try:
            outcome = await queue_download(
                spec, store=store, sites=sites, cfg=cfg, lane="watcher"
            )
        except Exception as exc:
            logger.warning(
                "Watcher %d: queueing %s failed: %s", watcher.id, spec.episode_name, exc
            )
            _mark(event, None, "error")
            continue
        if outcome.status == "queued" and outcome.job is not None:
            _mark(event, outcome.job.id, "queued")
            queued += 1
        elif outcome.status == "skipped":
            _mark(event, None, "skipped")
        else:
            _mark(event, None, "error")

    if queued:
        logger.info("Watcher %d auto-queued %d download(s)", watcher.id, queued)
    return queued


def _mark(event: dict[str, Any], job_id: str | None, state: str) -> None:
    event["job_id"] = job_id
    event["download_state"] = state
    event_id = event.get("id")
    if isinstance(event_id, int):
        try:
            library.watcher_set_event_download(
                event_id, job_id=job_id, download_state=state
            )
        except Exception as exc:  # pragma: no cover — a bad DB must not stop the poll
            logger.warning(
                "Could not record download state for event %s: %s", event_id, exc
            )
