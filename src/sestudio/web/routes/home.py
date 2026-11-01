from __future__ import annotations

import asyncio
import statistics
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter

from sestudio import library, tmdb
from sestudio.catalogs import TtlCache, parallel

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
