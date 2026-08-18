from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import FastAPI

from sestudio import library
from sestudio.sites import site_for
from sestudio.sites.base import ContentSite, SiteError
from sestudio.tmdb import TmdbDisabled
from sestudio.watchers.autodownload import auto_download
from sestudio.watchers.engine import UnsupportedKind, poll_once
from sestudio.watchers.models import PAGE_KINDS, Watcher
from sestudio.watchers.notify import dispatch

logger = logging.getLogger(__name__)

# How often the loop looks for due watchers. Each watcher has its own
# next_poll_at, so this is only the granularity of "when do we check".
WATCHER_TICK_SECONDS = 60

# Backoff ceiling for a watcher that keeps failing.
MAX_BACKOFF_SECONDS = 21600

# Failure counts at which the timeline hears about it. One event per outage
# rather than one per tick, so a site being down for a day is a single row.
ERROR_EVENT_THRESHOLD = 5
DISABLE_THRESHOLD = 20

# New and overdue watchers are spread over this window so a restart does not
# fire every watcher at once.
STARTUP_SPREAD_SECONDS = 300

_PRUNE_EVERY_SECONDS = 3600
_MIN_INTERVAL = 300

# Watchers polled per tick. Caps how hard a backlog can hit the source sites,
# and keeps one slow scrape from stalling the whole queue for a full interval.
_MAX_PER_TICK = 5


def watchers_enabled() -> bool:
    """Whether the background poller should run.

    Off via SESTUDIO_WATCHERS=0. Tests that enter the app's lifespan need a way to
    keep it from making network calls.
    """
    value = os.environ.get("SESTUDIO_WATCHERS", "1").strip().casefold()
    return value not in ("0", "false", "no", "off")


@dataclass
class PollOutcome:
    watcher_id: int
    events: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    failures: int = 0
    disabled: bool = False


def initial_next_poll(now: int | None = None) -> int:
    """A first poll time jittered across the startup window."""
    base = int(time.time()) if now is None else now
    return base + random.randint(0, STARTUP_SPREAD_SECONDS)


def _interval(watcher: Watcher) -> int:
    return max(_MIN_INTERVAL, int(watcher.interval_seconds))


def _next_after_success(watcher: Watcher, now: int) -> int:
    interval = _interval(watcher)
    # Up to 10% jitter so watchers created together do not stay in lockstep.
    return now + interval + int(random.uniform(0, interval * 0.1))


def _next_after_failure(watcher: Watcher, failures: int, now: int) -> int:
    interval = _interval(watcher)
    return now + min(interval * 2 ** min(failures, 5), MAX_BACKOFF_SECONDS)


def _site_base(site: ContentSite) -> str:
    """The site's current origin.

    Sites disagree on shape: fstream holds ``base_url`` as a string, senpai
    exposes it as a method that re-resolves a rotating domain.
    """
    value = getattr(site, "base_url", "")
    try:
        return str(value() if callable(value) else value)
    except Exception:  # a domain lookup that fails leaves the URL as it was
        return ""


def _rehost(site: ContentSite, url: str) -> str:
    """Move *url* onto the site's current origin, keeping path and query."""
    base = urlsplit(_site_base(site))
    parts = urlsplit(url)
    if not base.netloc or base.netloc == parts.netloc:
        return url
    return urlunsplit(
        (base.scheme or parts.scheme, base.netloc, parts.path, parts.query, "")
    )


def _repair_page_url(watcher: Watcher, sites: dict[str, ContentSite]) -> Watcher | None:
    """Re-point a page watcher at the site's current domain.

    Senpai moves to a new TLD every few days. Item keys survive that (they hold no
    URL), but the stored page_url does not — without this every senpai watcher
    would die permanently on the next move.

    Returns an updated watcher when the URL actually changed, else None.
    """
    if watcher.kind not in PAGE_KINDS:
        return None
    page_url = str(watcher.config.get("page_url") or "")
    source = str(watcher.config.get("source") or "") or None
    try:
        site = site_for(sites, source, page_url)
    except KeyError:
        return None
    repaired = _rehost(site, page_url)
    if repaired == page_url:
        return None
    config = {**watcher.config, "page_url": repaired}
    library.watcher_update(watcher.id, config=config)
    logger.info("Watcher %d page_url repaired to %s", watcher.id, repaired)
    watcher.config = config
    return watcher


def run_watcher(watcher: Watcher, sites: dict[str, ContentSite]) -> PollOutcome:
    """Poll one watcher, record the outcome, and never raise for site trouble.

    Used by both the background loop and the manual "poll now" endpoint, so the
    two cannot drift apart on bookkeeping.
    """
    now = int(time.time())
    try:
        events = poll_once(watcher, sites)
    except SiteError as exc:
        repaired = _repair_page_url(watcher, sites)
        if repaired is None:
            return _record_failure(watcher, exc, now)
        try:
            events = poll_once(repaired, sites)
        except Exception as retry_exc:
            return _record_failure(watcher, retry_exc, now)
    except UnsupportedKind as exc:
        # A config the server cannot act on is not a transient fault; stop
        # retrying it rather than burning a poll slot every interval.
        library.watcher_update(watcher.id, enabled=False)
        library.watcher_record_failure(watcher.id, str(exc), now + MAX_BACKOFF_SECONDS)
        return PollOutcome(watcher.id, error=str(exc), disabled=True)
    except TmdbDisabled as exc:
        # No API key: the watcher is inactive, not broken. Counting this as a
        # failure would auto-disable every criteria watcher within a day of the
        # key being cleared, and re-adding the key would not bring them back.
        logger.debug("Watcher %d idle: %s", watcher.id, exc)
        library.watcher_update(watcher.id, next_poll_at=now + _interval(watcher))
        return PollOutcome(watcher.id, error=None)
    except Exception as exc:
        # Covers TransientEmptyResult and any scrape/parse surprise. Note that
        # asyncio.CancelledError is a BaseException, so shutdown is not caught here.
        return _record_failure(watcher, exc, now)

    library.watcher_record_success(watcher.id, _next_after_success(watcher, now))
    return PollOutcome(watcher.id, events=events)


def _record_failure(watcher: Watcher, exc: BaseException, now: int) -> PollOutcome:
    message = f"{type(exc).__name__}: {exc}"
    failures = watcher.consecutive_failures + 1
    count = library.watcher_record_failure(
        watcher.id, message, _next_after_failure(watcher, failures, now)
    )
    logger.warning("Watcher %d failed (%d): %s", watcher.id, count, message)

    disabled = False
    if count >= DISABLE_THRESHOLD:
        library.watcher_update(watcher.id, enabled=False)
        disabled = True
        library.watcher_add_event(
            watcher_id=watcher.id,
            watcher_kind=watcher.kind,
            event_type="watcher_disabled",
            title=watcher.label or f"Watcher {watcher.id}",
            subtitle=f"Disabled after {count} failed checks",
            data={"error": message},
        )
    elif count == ERROR_EVENT_THRESHOLD:
        library.watcher_add_event(
            watcher_id=watcher.id,
            watcher_kind=watcher.kind,
            event_type="watcher_error",
            title=watcher.label or f"Watcher {watcher.id}",
            subtitle="Checks are failing",
            data={"error": message},
        )
    return PollOutcome(watcher.id, error=message, failures=count, disabled=disabled)


async def _tick(app: FastAPI) -> list[PollOutcome]:
    now = int(time.time())
    due = await asyncio.to_thread(library.watcher_list_due, now)
    if not due:
        return []

    # After downtime every watcher is overdue at once. Take the longest-waiting
    # few and leave the rest for the next tick: they stay due, and because the
    # query orders by next_poll_at they are first in line, so nothing starves.
    # Not rewriting their next_poll_at is deliberate — it would push back
    # watchers that were legitimately ready.
    outcomes: list[PollOutcome] = []
    for row in due[:_MAX_PER_TICK]:
        watcher = Watcher.from_row(row)
        # Sequential by design: a senpai season fetch already fans out 8 threads
        # internally, so polling watchers in parallel would hammer one host.
        outcome = await asyncio.to_thread(run_watcher, watcher, app.state.sites)
        outcomes.append(outcome)
        await maybe_auto_download(watcher, outcome, app)
    return outcomes


async def maybe_auto_download(
    watcher: Watcher, outcome: PollOutcome, app: FastAPI
) -> None:
    """Queue anything a watcher with auto-download just found.

    Runs after the events are committed and never propagates: a download that
    cannot be queued is recorded on its event, because losing a notification
    would be the worse failure.
    """
    if not outcome.events:
        return
    if watcher.auto_download:
        try:
            await auto_download(
                watcher,
                outcome.events,
                store=app.state.job_store,
                sites=app.state.sites,
            )
        except Exception as exc:
            logger.warning("Watcher %d: auto-download failed: %s", watcher.id, exc)

    # Last, so the message reflects whatever auto-download decided, and so a
    # messaging outage cannot cost either the events or the downloads.
    try:
        await asyncio.to_thread(dispatch, watcher.label, outcome.events)
    except Exception as exc:  # dispatch swallows its own, so this is belt-and-braces
        logger.warning("Watcher %d: notify failed: %s", watcher.id, exc)


async def run_poller(app: FastAPI) -> None:
    """Check for due watchers forever, tolerating any single failure."""
    last_prune = 0.0
    while True:
        # Sleeping first means an accidentally-started poller does no I/O before
        # the process (or a test) has a chance to shut it down.
        await asyncio.sleep(WATCHER_TICK_SECONDS)
        try:
            await _tick(app)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Watcher tick failed: %s", exc)

        now = time.monotonic()
        if now - last_prune >= _PRUNE_EVERY_SECONDS:
            last_prune = now
            try:
                await asyncio.to_thread(library.watcher_prune_events, int(time.time()))
            except Exception as exc:
                logger.warning("Could not prune watcher events: %s", exc)
