from __future__ import annotations

import asyncio
import dataclasses
import logging
import statistics
import time
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request

from sestudio import library, tmdb
from sestudio.catalogs import TtlCache, parallel
from sestudio.config import load_config
from sestudio.sites import ContentSite
from sestudio.web.routes.search import SITE_TIMEOUT_S, _search_site

logger = logging.getLogger(__name__)

router = APIRouter()

_UPCOMING_DAYS = 7
# Per series rather than per list, so following one more series fetches only it.
_airing_cache = TtlCache(6 * 3600)
_AIRING = ("Returning Series", "In Production")
# One VF finding is an anecdote; two make a (rough) habit.
_MIN_VF_SAMPLES = 2


def _followed() -> dict[str, dict[str, Any]]:
    """Series the user follows, by folded name: watched (not dismissed),
    watched for by a page watcher, or on the watchlist. Films (season 0) never
    have a next episode. Earlier sources win for page_url/source/lang, as what
    the user actually played says most about the version they follow."""
    snapshot = library.get_snapshot()
    found: dict[str, dict[str, Any]] = {}

    def add(name: str, page_url: Any, source: Any, lang: Any, watcher_id=None):
        entry = found.setdefault(
            tmdb._fold(name),
            {"series": name, "page_url": None, "source": None, "lang": None},
        )
        entry["page_url"] = entry["page_url"] or page_url or None
        entry["source"] = entry["source"] or source or None
        entry["lang"] = entry["lang"] or lang or None
        if watcher_id is not None:
            entry.setdefault("watcher_ids", set()).add(watcher_id)

    by_series: dict[str, list[dict[str, Any]]] = {}
    for e in snapshot["watch"].values():
        if e.get("series") and e.get("season"):
            by_series.setdefault(e["series"], []).append(e)
    for name, entries in by_series.items():
        latest = max(entries, key=lambda e: e.get("updatedAt") or 0)
        dismissed = max(e.get("dismissedAt") or 0 for e in entries)
        if (latest.get("updatedAt") or 0) > dismissed:
            # An entry without source is fstream's, per the client's convention.
            add(
                name,
                latest.get("page_url"),
                latest.get("source") or "fstream",
                latest.get("lang"),
            )

    for w in library.watcher_list():
        config = w["config"]
        if w["kind"] in ("series_episodes", "title_lang") and config.get("series_name"):
            langs = config.get("langs") or []
            add(
                config["series_name"],
                config.get("page_url"),
                config.get("source"),
                langs[0] if len(langs) == 1 else None,
                w["id"],
            )

    for e in snapshot["collections"].get("watchlist", {}).values():
        if e.get("series") and e.get("season"):
            add(
                e["series"],
                e.get("page_url"),
                e.get("source") or "fstream",
                e.get("lang"),
            )
    return found


def _vf_findings(
    watcher_ids: set[int], events: list[dict[str, Any]]
) -> list[tuple[int, int, date]]:
    """(season, episode, day found) for each episode a watcher first saw in VF."""
    out = []
    for ev in events:
        parts = ev["item_key"].split("|")  # eplang|SS|NNNN|lang
        if (
            ev["watcher_id"] in watcher_ids
            and len(parts) == 4
            and parts[0] == "eplang"
            and parts[3] == "vf"
        ):
            out.append(
                (
                    int(parts[1]),
                    int(parts[2]),
                    datetime.fromtimestamp(ev["created_at"]).date(),
                )
            )
    return out


def _vf_delay(findings: list[tuple[int, int, date]], air_dates: dict) -> int | None:
    """Median days between an episode's original air date and its VF finding."""
    delays = []
    for season, number, found_on in findings:
        aired = air_dates.get((season, number))
        if aired:
            days = (found_on - date.fromisoformat(aired)).days
            if days >= 0:
                delays.append(days)
    return round(statistics.median(delays)) if len(delays) >= _MIN_VF_SAMPLES else None


def _upcoming() -> list[dict[str, Any]]:
    followed = list(_followed().values())
    if not followed:
        return []
    # shortcut: only the latest 500 events are read, enough while they are pruned.
    events = library.watcher_event_list(limit=500)
    findings = [_vf_findings(f.get("watcher_ids", set()), events) for f in followed]
    airing = parallel(
        [
            lambda f=f, fs=fs: _airing_cache.get(
                f["series"], lambda: tmdb.tv_airing(f["series"], [s for s, _, _ in fs])
            )
            for f, fs in zip(followed, findings)
        ]
    )

    today = date.today()
    last = (today + timedelta(days=_UPCOMING_DAYS - 1)).isoformat()
    episodes: dict[int, dict[str, Any]] = {}
    for f, fs, info in zip(followed, findings, airing):
        nxt = (info or {}).get("next_episode") or {}
        air_date = nxt.get("air_date") or ""
        if (
            not info
            or info["status"] not in _AIRING
            or not today.isoformat() <= air_date <= last
            or info["tmdb_id"] in episodes
        ):
            continue
        episodes[info["tmdb_id"]] = {
            "series": f["series"],
            "tmdb_id": info["tmdb_id"],
            "season": nxt.get("season_number"),
            "episode": nxt.get("episode_number"),
            "name": nxt.get("name") or None,
            "air_date": air_date,
            "poster_url": info["poster_url"] or None,
            "vf_delay_days": _vf_delay(fs, info["air_dates"]),
            "page_url": f["page_url"],
            "source": f["source"],
            "lang": f["lang"],
        }
    return sorted(episodes.values(), key=lambda e: e["air_date"])


@router.get("/home/upcoming")
async def upcoming() -> dict[str, Any]:
    """Followed series' episodes airing in the next 7 days, for Home's agenda.

    TMDB is optional polish here, so a missing key or a TMDB outage yields an
    empty agenda rather than an error.
    """
    return {"episodes": await asyncio.to_thread(_upcoming)}


# --- For you ----------------------------------------------------------------- #

_FORYOU_TTL_S = 24 * 3600
_SEEDS = 5
# Each candidate costs one search per site, so only the top of each seed's
# recommendations is tried, and a group stops at a widget's worth of titles.
_CANDIDATES_PER_SEED = 8
_ITEMS_PER_GROUP = 6
_LANG_ORDER = ("vf", "vostfr", "vo")


async def _langs(site: ContentSite, url: str) -> list[str]:
    """The versions a site offers on one page; none when it can't be fetched."""
    try:
        page = await asyncio.wait_for(
            asyncio.to_thread(site.fetch_page, url), SITE_TIMEOUT_S
        )
    except Exception as exc:
        logger.warning("For you: could not read langs of %s: %s", url, exc)
        return []
    return page.available_langs


async def _carried(
    rec: dict[str, Any], sites: list[ContentSite], preferred: str
) -> dict[str, Any] | None:
    """*rec* as a For you item when a site carries it, else None."""
    outcomes = await asyncio.gather(*(_search_site(s, rec["title"]) for s in sites))
    is_film = rec["kind"] == "movie"
    wanted = tmdb._fold(rec["title"])
    matches = [
        dataclasses.asdict(c)
        for result, _, _ in outcomes
        for c in result
        if tmdb._fold(c.series_name) == wanted
        and c.is_film == is_film
        # A series card's year is its season's, so only films are checked.
        and not (is_film and c.year and rec["year"] and abs(c.year - rec["year"]) > 1)
    ]
    if not matches:
        return None
    # As the search merge does: the preferred site's card opens, a series
    # opens at its first season, and other pages of that season ride as alts.
    matches.sort(
        key=lambda c: (
            c["source"] != preferred,
            c["season_number"],
            not c["poster_url"],
        )
    )
    card, *rest = matches
    alts = [c for c in rest if c["season_number"] == card["season_number"]]
    if alts:
        card = {**card, "alt_page_urls": [c["page_url"] for c in alts], "alts": alts}
    by_id = {s.id: s for s in sites}
    found = await asyncio.gather(
        *(_langs(by_id[c["source"]], c["page_url"]) for c in [matches[0], *alts])
    )
    langs = {lang for page in found for lang in page}
    return {
        "title": rec["title"],
        "year": rec["year"] or None,
        "tmdb_id": rec["tmdb_id"],
        "kind": rec["kind"],
        "poster_url": rec["poster_url"] or card["poster_url"],
        "rating": rec["rating"] or None,
        "versions": [lang for lang in _LANG_ORDER if lang in langs],
        "card": card,
    }


async def _compute(registered: dict[str, ContentSite]) -> dict[str, Any] | None:
    """The groups, or None when there is nothing to seed them yet."""
    snapshot = await asyncio.to_thread(library.get_snapshot)
    entries = sorted(
        snapshot["watch"].values(),
        key=lambda e: e.get("updatedAt") or 0,
        reverse=True,
    )
    # Every watched title is excluded; the most recent few are the seeds.
    watched: set[str] = set()
    seeds: list[dict[str, Any]] = []
    for entry in entries:
        name = tmdb._fold(entry.get("series") or "")
        if name and name not in watched:
            watched.add(name)
            if len(seeds) < _SEEDS:
                seeds.append(entry)
    if not seeds:
        return None
    listed = {
        tmdb._fold(e.get("series") or "")
        for entries_by_key in snapshot["collections"].values()
        for e in entries_by_key.values()
    }
    known = watched | listed

    details = await asyncio.gather(
        *(
            asyncio.to_thread(tmdb.enrich, s["series"], 0, s.get("season") == 0)
            for s in seeds
        )
    )
    details = [d for d in details if d]
    if not details:
        # tmdb caches misses itself, and an outage should be retried, not kept.
        return None
    # TV and film ids are separate spaces on TMDB, so the kind is part of the id.
    used = {(d["kind"], d["tmdb_id"]) for d in details}

    cfg = load_config()
    disabled = set(cfg.disabled_sites)
    sites = [s for sid, s in registered.items() if s.searchable and sid not in disabled]

    groups: list[dict[str, Any]] = []
    for detail in details:
        candidates = []
        for rec in detail["recommendations"]:
            ident = (rec["kind"], rec["tmdb_id"])
            if ident in used or tmdb._fold(rec["title"]) in known:
                continue
            used.add(ident)
            candidates.append(rec)
            if len(candidates) == _CANDIDATES_PER_SEED:
                break
        found = await asyncio.gather(
            *(_carried(rec, sites, cfg.preferred_site) for rec in candidates)
        )
        items = [item for item in found if item][:_ITEMS_PER_GROUP]
        if items:
            groups.append(
                {
                    "because": {
                        "title": detail["title"],
                        "tmdb_id": detail["tmdb_id"],
                        "kind": detail["kind"],
                    },
                    "items": items,
                }
            )
    return {"groups": groups}


@router.get("/home/foryou")
async def for_you(request: Request, refresh: bool = False) -> dict[str, Any]:
    """Recommendations like the last titles watched, one group per title, kept
    only when a site carries them. Computed lazily and kept for a day: one
    refresh searches every site for dozens of titles."""
    state = request.app.state
    if not hasattr(state, "foryou_lock"):
        state.foryou_lock = asyncio.Lock()
    async with state.foryou_lock:
        cached = getattr(state, "foryou", None)
        if cached and not refresh and time.monotonic() - cached[0] < _FORYOU_TTL_S:
            return cached[1]
        try:
            result = await _compute(state.sites)
        except tmdb.TmdbDisabled:
            return {"groups": []}
        except Exception as exc:  # noqa: BLE001 — an optional widget never 500s
            logger.warning("For you failed: %s", exc)
            return {"groups": []}
        if result is None:
            return {"groups": []}
        state.foryou = (time.monotonic(), result)
        return result
