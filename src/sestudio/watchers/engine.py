from __future__ import annotations

import logging
import time
from typing import Any

from sestudio import library
from sestudio.sites.base import ContentSite
from sestudio.watchers.kinds import COLLECTORS
from sestudio.watchers.models import SNAPSHOT_KINDS, Hit, Watcher

logger = logging.getLogger(__name__)


class TransientEmptyResult(Exception):
    """A poll came back empty for a watcher that had items before.

    Treated as a failed poll rather than as "everything disappeared". A season
    page that briefly parses to nothing would otherwise retract nothing (the
    baseline only grows) but *would* let the next good poll look normal — the real
    danger is a site that starts returning empty pages permanently, which without
    this guard silently freezes the watcher instead of surfacing an error.
    """


class UnsupportedKind(Exception):
    """The watcher's kind has no collector yet."""


def _event_dict(
    event_id: int, watcher: Watcher, hit: Hit, created_at: int
) -> dict[str, Any]:
    """The event as the timeline will read it back.

    Every column the stored row has, so a caller handed a fresh event sees the
    same shape as one fetched from the database. Auto-download fills in job_id
    and download_state afterwards, on this same dict.
    """
    return {
        "id": event_id,
        "watcher_id": watcher.id,
        "watcher_kind": watcher.kind,
        "event_type": "new_item",
        "item_key": hit.item_key,
        "title": hit.title,
        "subtitle": hit.subtitle,
        "poster_url": hit.poster_url,
        "data": hit.data,
        "created_at": created_at,
        "read_at": None,
        "job_id": None,
        "download_state": "",
    }


def poll_once(watcher: Watcher, sites: dict[str, ContentSite]) -> list[dict[str, Any]]:
    """Evaluate one watcher and return the timeline events it produced.

    Fully synchronous — the site calls block and the database calls block — so it
    can be tested without an event loop. The poller is what runs it in a thread.

    Order matters here: events are committed before the caller notifies anyone, so
    a failing notifier can never cost an inbox row.
    """
    collector = COLLECTORS.get(watcher.kind)
    if collector is None:
        raise UnsupportedKind(f"Watcher kind {watcher.kind!r} cannot be polled yet")

    hits = collector(watcher, sites)

    # Collapse duplicates so one item cannot be recorded (or reported) twice.
    by_key: dict[str, Hit] = {}
    for hit in hits:
        by_key.setdefault(hit.item_key, hit)

    if (
        not by_key
        and watcher.kind in SNAPSHOT_KINDS
        and library.watcher_seen_count(watcher.id) > 0
    ):
        raise TransientEmptyResult(
            f"Watcher {watcher.id} found nothing but has seen items before"
        )

    ready = [key for key, hit in by_key.items() if not hit.pending]
    parked = [key for key, hit in by_key.items() if hit.pending]

    # Ready first, deliberately: the ready call is the one that stamps the
    # baseline, and on a first poll it must be the one that returns nothing. If
    # the pending call baselined instead, every ready hit would fire immediately.
    new_keys = library.watcher_record_seen(watcher.id, ready)
    if parked:
        # Recorded but never reported. These become news on the poll where a site
        # finally carries them, which is when they are re-recorded as 'seen'.
        library.watcher_record_seen(watcher.id, parked, state="pending")
    if not new_keys:
        return []

    events: list[dict[str, Any]] = []
    created_at = int(time.time())
    for key in new_keys:
        hit = by_key[key]
        event_id = library.watcher_add_event(
            watcher_id=watcher.id,
            watcher_kind=watcher.kind,
            event_type="new_item",
            item_key=key,
            title=hit.title,
            subtitle=hit.subtitle,
            poster_url=hit.poster_url,
            data=hit.data,
        )
        if event_id is None:
            # Already in the timeline from an earlier run; not news twice.
            continue
        events.append(_event_dict(event_id, watcher, hit, created_at))

    if events:
        logger.info(
            "Watcher %d (%s) found %d new item(s)",
            watcher.id,
            watcher.kind,
            len(events),
        )
    return events
