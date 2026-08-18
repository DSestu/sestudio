from __future__ import annotations

import logging

from sestudio.sites import site_for
from sestudio.sites.base import ContentSite, SiteError
from sestudio.watchers.criteria import collect_criteria_hits
from sestudio.watchers.keys import (
    card_key,
    episode_lang_key,
    film_key,
    playable_langs,
    title_lang_key,
)
from sestudio.watchers.models import Hit, Watcher

logger = logging.getLogger(__name__)

# Collectors do the blocking site work and return candidate hits. They never
# touch the database: the engine owns the diff, so a collector can be tested by
# handing it a fake site and reading the list back.

_LANG_LABELS = {
    "vf": "VF",
    "vff": "VF (FR)",
    "vfq": "VF (QC)",
    "vostfr": "VOSTFR",
    "vo": "VO",
}


def _lang_label(lang: str) -> str:
    return _LANG_LABELS.get(lang, lang.upper())


def collect_page_hits(watcher: Watcher, sites: dict[str, ContentSite]) -> list[Hit]:
    """Hits for the three page-based kinds (episodes, languages, film).

    One fetch is enough for all of them: both sites report each episode's full
    language list regardless of which language the page was requested in, so the
    whole (episode, language) matrix comes back in a single call.

    ``series_episodes`` is ``title_lang`` with a language filter applied — the
    same code, not a parallel implementation, because two differs for one diff is
    exactly where "VF arrived but VOSTFR already existed" would break.
    """
    config = watcher.config
    page_url = str(config.get("page_url") or "")
    source = str(config.get("source") or "") or None
    fetch_lang = str(config.get("fetch_lang") or "vf")
    wanted = {code for code in config.get("langs") or []}
    poster_url = str(config.get("poster_url") or "")

    site = site_for(sites, source, page_url)
    page = site.fetch_page(page_url, fetch_lang)

    series_name = str(config.get("series_name") or "") or watcher.label

    hits: list[Hit] = []

    # Coarse signal: the title gained a whole language. Fires once per language,
    # ever, and reads as "VF is out" rather than as N episode rows.
    if watcher.kind in ("title_lang", "film_available"):
        for lang in page.available_langs:
            code = lang.strip().casefold()
            if not code or (wanted and code not in wanted):
                continue
            hits.append(
                Hit(
                    item_key=title_lang_key(code),
                    title=series_name or page_url,
                    subtitle=f"{_lang_label(code)} now available",
                    poster_url=poster_url,
                    data={
                        "page_url": page_url,
                        "source": site.id,
                        "lang": code,
                        "season": page.season,
                        "is_film": page.is_film,
                        "kind": "title_lang",
                    },
                )
            )

    for episode in page.episodes:
        langs = playable_langs(episode, fetch_lang)
        if wanted:
            langs &= wanted
        for code in sorted(langs):
            if page.is_film:
                item_key = film_key(code)
                subtitle = f"Film · {_lang_label(code)}"
            else:
                item_key = episode_lang_key(page.season, episode.number, code)
                subtitle = (
                    f"S{page.season:02d}E{episode.number:02d} · {_lang_label(code)}"
                )
            hits.append(
                Hit(
                    item_key=item_key,
                    title=episode.title or series_name or page_url,
                    subtitle=subtitle,
                    poster_url=poster_url,
                    data={
                        "page_url": page_url,
                        "source": site.id,
                        "lang": code,
                        "season": page.season,
                        "number": episode.number,
                        "is_film": page.is_film,
                        "series_name": series_name,
                        "episode_name": episode.filename,
                        "kind": "episode",
                    },
                )
            )

    return hits


def collect_saved_search_hits(
    watcher: Watcher, sites: dict[str, ContentSite]
) -> list[Hit]:
    """Hits for a saved search: cards whose (source, path) was not seen before."""
    query = str(watcher.config.get("query") or "")
    wanted = {code for code in watcher.config.get("sources") or []}
    targets = [
        site for site in sites.values() if not wanted or site.id.casefold() in wanted
    ]
    if not targets:
        raise SiteError("No sites enabled for this watcher")

    hits: list[Hit] = []
    failures: list[str] = []
    for site in targets:
        try:
            cards = site.search(query)
        except Exception as exc:  # a dead site must not hide the others' results
            failures.append(f"{site.id}: {exc}")
            logger.warning(
                "Watcher %d: search failed on %s: %s", watcher.id, site.id, exc
            )
            continue
        for card in cards:
            hits.append(
                Hit(
                    item_key=card_key(card.source, card.page_url),
                    title=card.title or card.series_name,
                    subtitle=f"{site.display_name}"
                    + (f" · {card.year}" if card.year else ""),
                    poster_url=card.poster_url,
                    data={
                        "page_url": card.page_url,
                        "source": card.source,
                        "series_name": card.series_name,
                        "season": card.season_number,
                        "is_film": card.is_film,
                        "kind": "card",
                    },
                )
            )
    # Every site failing is a failed poll, not an empty result — otherwise the
    # empty-result guard would be the only thing standing between an outage and a
    # wiped-looking catalogue.
    if failures and not hits:
        raise SiteError("; ".join(failures))
    return hits


COLLECTORS = {
    "series_episodes": collect_page_hits,
    "title_lang": collect_page_hits,
    "film_available": collect_page_hits,
    "saved_search": collect_saved_search_hits,
    "tmdb_criteria": collect_criteria_hits,
}
