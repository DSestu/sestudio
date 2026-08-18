from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any

from sestudio import tmdb
from sestudio.config import load_config
from sestudio.sites.base import ContentSite
from sestudio.watchers.keys import tmdb_item_key
from sestudio.watchers.models import Hit, Watcher
from sestudio import library

logger = logging.getLogger(__name__)

# A criteria watcher answers "tell me when something matching this is grabbable",
# which is two questions with very different costs:
#
#   Stage 1 — does it match the metadata? One TMDB discover call per page, cheap,
#             and re-run fresh every poll so a title that only earns its votes
#             later still qualifies later.
#   Stage 2 — does any site actually carry it? A full scrape per candidate, so
#             this is what has to be capped.
#
# Nothing fires on stage 1 alone: a title TMDB lists but no site has is something
# you can do nothing about, and would fill the timeline for weeks.

# Pages of discover results scanned per poll. Sorted newest-first, so page 1 is
# the releases that matter; three pages is ~60 titles of headroom.
_PAGES = 3

# Stage-2 confirmations per poll. Uncapped, one watcher would scrape every site
# for every new release in its genre on every tick.
_MAX_CONFIRMATIONS = 10

# How long a candidate no site carries is left alone between checks.
_RECHECK_SECONDS = 86400

# When to give up on a candidate no site ever picked up.
_PENDING_TTL_SECONDS = 180 * 86400


def _sort_for(kind: str) -> str:
    """Newest first.

    Deliberately not popularity: popularity reshuffles daily, so titles the
    watcher has never seen drift onto page 1 forever (noise) while a genuine new
    release that never charts is never seen at all (misses).
    """
    return "primary_release_date.desc" if kind == "movie" else "first_air_date.desc"


def _window(window_days: int, today: date | None = None) -> tuple[str, str]:
    """The release-date window, materialised now rather than at creation."""
    end = today or date.today()
    start = end - timedelta(days=window_days)
    return start.isoformat(), end.isoformat()


def _candidates(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Stage 1: everything matching the metadata filters, newest first."""
    kind = str(config.get("kind") or "movie")
    from_date, to_date = _window(int(config.get("window_days") or 90))
    found: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()
    for page in range(1, _PAGES + 1):
        payload = tmdb.discover(
            kind=kind,
            sort_by=_sort_for(kind),
            genres=str(config.get("genres") or ""),
            min_score=float(config.get("min_score") or 0.0),
            max_score=float(config.get("max_score") or 10.0),
            min_votes=int(config.get("min_votes") or 0),
            from_date=from_date,
            to_date=to_date,
            page=page,
        )
        results = payload.get("results") or []
        for card in results:
            if card.get("tmdb_id") and card["tmdb_id"] not in seen_ids:
                seen_ids.add(card["tmdb_id"])
                found.append(card)
        if page >= int(payload.get("total_pages") or 1):
            break
    return found


def _carried_by(
    title: str, year: int, sites: list[ContentSite]
) -> tuple[str, str, str] | None:
    """Stage 2: the first site that has this title, as (site id, page url, name).

    Matching is by normalised title, and by year when both sides state one — a
    site's own title text is all there is to go on, since no site exposes a TMDB
    id.
    """
    wanted = _normalise(title)
    if not wanted:
        return None
    for site in sites:
        try:
            cards = site.search(title)
        except Exception as exc:
            logger.debug("Criteria stage 2: %s search failed: %s", site.id, exc)
            continue
        for card in cards:
            if (
                _normalise(card.series_name) != wanted
                and _normalise(card.title) != wanted
            ):
                continue
            if year and card.year and abs(card.year - year) > 1:
                continue
            return site.id, card.page_url, card.series_name or card.title
    return None


def _normalise(name: str) -> str:
    """Loose title identity: case, accents-as-written and punctuation dropped."""
    return "".join(ch for ch in name.casefold() if ch.isalnum())


def collect_criteria_hits(watcher: Watcher, sites: dict[str, ContentSite]) -> list[Hit]:
    """Hits for a metadata-criteria watcher.

    Reads its own seen-state, unlike the other collectors: bounding stage-2 work
    is only possible by knowing which candidates have already been dealt with.
    """
    config = watcher.config
    now = int(time.time())
    # Housekeeping first: a poll that finds no candidates is still a poll, and
    # aged-out candidates should not survive on the strength of a quiet day.
    library.watcher_drop_stale_pending(watcher.id, now - _PENDING_TTL_SECONDS)

    candidates = _candidates(config)
    if not candidates:
        return []

    already = library.watcher_seen_keys(watcher.id, "seen")
    due_pending = set(library.watcher_pending_keys(watcher.id, now - _RECHECK_SECONDS))
    known_pending = library.watcher_seen_keys(watcher.id, "pending")

    cfg = load_config()
    enabled = [
        site for site in sites.values() if site.id not in (cfg.disabled_sites or [])
    ]

    to_check: list[dict[str, Any]] = []
    for card in candidates:
        key = tmdb_item_key(str(config.get("kind") or "movie"), card["tmdb_id"])
        if key in already:
            continue  # already reported, once and for all
        if key in known_pending and key not in due_pending:
            continue  # checked recently; leave it alone
        to_check.append(card)

    if len(to_check) > _MAX_CONFIRMATIONS:
        logger.info(
            "Watcher %d: %d candidates to confirm, checking %d this poll",
            watcher.id,
            len(to_check),
            _MAX_CONFIRMATIONS,
        )
        to_check = to_check[:_MAX_CONFIRMATIONS]

    kind = str(config.get("kind") or "movie")
    hits: list[Hit] = []
    for card in to_check:
        key = tmdb_item_key(kind, card["tmdb_id"])
        carried = _carried_by(card["title"], int(card.get("year") or 0), enabled)
        if carried is None:
            # Matched the criteria but nothing has it yet: park it.
            hits.append(Hit(item_key=key, title=card["title"], pending=True))
            continue
        source, page_url, series_name = carried
        rating = card.get("rating") or 0
        hits.append(
            Hit(
                item_key=key,
                title=card["title"],
                subtitle=" · ".join(
                    part
                    for part in (
                        f"★ {rating}" if rating else "",
                        str(card.get("year") or ""),
                        "Film" if kind == "movie" else "Series",
                    )
                    if part
                ),
                poster_url=card.get("poster_url") or "",
                data={
                    "page_url": page_url,
                    "source": source,
                    "series_name": series_name,
                    "tmdb_id": card["tmdb_id"],
                    "rating": rating,
                    "year": card.get("year") or 0,
                    "is_film": kind == "movie",
                    # Not "episode": there is no episode number to download from
                    # a discover card, so auto-download leaves these alone.
                    "kind": "card",
                },
            )
        )
    return hits
