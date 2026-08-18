from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Every watcher kind. The three page-based kinds share one collector (they are
# the same diff over a fetched title page, differing only in which keys they
# emit); saved_search and tmdb_criteria have their own.
WATCHER_KINDS: tuple[str, ...] = (
    "series_episodes",
    "title_lang",
    "film_available",
    "saved_search",
    "tmdb_criteria",
)

# How often each kind is worth re-checking. Episodes land daily, search results
# move slowly, and a metadata sweep is expensive enough to run once a day.
DEFAULT_INTERVALS: dict[str, int] = {
    "series_episodes": 3600,
    "title_lang": 3600,
    "film_available": 3600,
    "saved_search": 21600,
    "tmdb_criteria": 86400,
}

# Kinds whose config points at a single title page.
PAGE_KINDS: tuple[str, ...] = ("series_episodes", "title_lang", "film_available")

# Kinds whose collector returns the *whole* current listing every poll. For these,
# coming back empty means something broke, so it is treated as a failed poll.
#
# tmdb_criteria is deliberately excluded: its collector returns only candidates it
# has not already resolved, so an empty result is the normal quiet state and
# guarding on it would disable a healthy watcher within a day.
SNAPSHOT_KINDS: tuple[str, ...] = (*PAGE_KINDS, "saved_search")

_MIN_INTERVAL = 300


@dataclass(frozen=True)
class Hit:
    """One item a watcher found this poll.

    A hit is not yet news: the engine diffs ``item_key`` against the baseline and
    only the previously-unseen ones become events.
    """

    item_key: str
    title: str
    subtitle: str = ""
    poster_url: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    # A candidate that matched on metadata but that no site carries yet. Recorded
    # so it is not re-checked constantly, but never reported — it becomes news on
    # the poll where a site finally has it.
    pending: bool = False


@dataclass
class Watcher:
    """A watcher row, with ``config`` already parsed."""

    id: int
    kind: str
    label: str
    config: dict[str, Any]
    enabled: bool
    auto_download: bool
    interval_seconds: int
    created_at: int
    next_poll_at: int
    last_polled_at: int | None = None
    last_ok_at: int | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    baselined_at: int | None = None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Watcher:
        fields = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in row.items() if k in fields})

    @property
    def is_baselined(self) -> bool:
        return self.baselined_at is not None


def _clean_codes(value: Any) -> list[str]:
    """Normalise a list of ids (languages, site ids) to lowercase; [] means "any"."""
    if not isinstance(value, list):
        return []
    return sorted({str(item).strip().casefold() for item in value if str(item).strip()})


def validate_config(kind: str, config: Any) -> dict[str, Any]:
    """Check and normalise a watcher's config, raising ValueError on bad input.

    Returns a new dict holding only recognised keys, so a client cannot smuggle
    extra fields into the stored JSON.
    """
    if kind not in WATCHER_KINDS:
        raise ValueError(f"Unknown watcher kind {kind!r}")
    if not isinstance(config, dict):
        raise ValueError("config must be an object")

    if kind in PAGE_KINDS:
        page_url = str(config.get("page_url") or "").strip()
        if not page_url:
            raise ValueError(f"{kind} requires a page_url")
        return {
            "page_url": page_url,
            "source": str(config.get("source") or "").strip(),
            # Which languages to report. Empty means every language the site
            # offers, which is what makes title_lang a superset of
            # series_episodes rather than a separate code path.
            "langs": _clean_codes(config.get("langs")),
            # The language to fetch the page in. Both sites report every
            # episode's languages regardless, so this only picks which variant's
            # embeds come back — it does not limit what the watcher can see.
            "fetch_lang": str(config.get("fetch_lang") or "vf").strip().casefold(),
            # Display/download metadata the page itself does not carry.
            "series_name": str(config.get("series_name") or "").strip(),
            "poster_url": str(config.get("poster_url") or "").strip(),
        }

    if kind == "saved_search":
        query = str(config.get("query") or "").strip()
        if not query:
            raise ValueError("saved_search requires a query")
        return {"query": query, "sources": _clean_codes(config.get("sources"))}

    # tmdb_criteria
    media_kind = str(config.get("kind") or "movie").strip().casefold()
    if media_kind not in ("movie", "tv"):
        raise ValueError("tmdb_criteria kind must be 'movie' or 'tv'")
    genre_ids = ",".join(
        part.strip()
        for part in str(config.get("genres") or "").split(",")
        if part.strip().isdigit()
    )
    return {
        "kind": media_kind,
        # TMDB genre ids, comma-separated. Non-numeric parts are dropped rather
        # than passed on: TMDB answers a malformed filter with an unfiltered page,
        # which would silently look like a filter that does nothing.
        "genres": genre_ids,
        "min_score": min(10.0, max(0.0, float(config.get("min_score") or 0.0))),
        "max_score": min(10.0, max(0.0, float(config.get("max_score") or 10.0))),
        "min_votes": max(0, int(config.get("min_votes") or 0)),
        # A relative window, materialised at poll time. Storing absolute dates
        # would freeze the watcher to the day it was created, so it would stop
        # finding anything a few months on.
        #
        # It also bounds how long a title has to earn its votes: a release that
        # only clears a 500-vote floor after the window has passed is never seen,
        # which is why the default is generous.
        "window_days": min(3650, max(1, int(config.get("window_days") or 90))),
    }


def normalise_interval(kind: str, value: Any) -> int:
    """Clamp a requested interval, falling back to the kind's default."""
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        seconds = DEFAULT_INTERVALS.get(kind, 3600)
    return max(_MIN_INTERVAL, seconds)
