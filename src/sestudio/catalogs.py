"""Browsable catalogues: shelves and filtered discovery, one per source of titles.

A catalogue is distinct from a ContentSite: a site plays video, a catalogue
lists titles to pick from. A site may be both (UniqueStream); TMDB is only a
catalogue, whose cards are found on the sites by searching their title.

Each catalogue describes its own filters as data (FilterField), so the UI draws
them without knowing the catalogue — a new source with its own discovery needs
no frontend code. Filter values travel as flat strings: a select is its value,
a multi is comma-joined, a range is "lo,hi".
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, TypeVar

from sestudio import tmdb
from sestudio.config import tmdb_key

T = TypeVar("T")


@dataclass
class FilterField:
    key: str
    label: str
    type: str  # "select" | "multi" | "range"
    options: list[dict[str, str]] = field(default_factory=list)
    # select: a value; multi: a comma-joined list ("" for none); range: "lo,hi".
    default: str = ""
    # Range bounds; a bound left at its extreme means "open".
    min: int = 0
    max: int = 0
    step: int = 1
    # Other fields' options depend on this one: the UI refetches the schema
    # when it changes and drops values the new options no longer offer.
    reload: bool = False
    # A multi the catalogue can only combine so far (0 = unlimited).
    max_selected: int = 0


class Catalog(ABC):
    id: str
    label: str
    # One line under the catalogue's name, saying what it lists.
    description: str = ""

    def available(self) -> bool:
        return True

    @abstractmethod
    def schema(self, values: dict[str, str]) -> list[FilterField]:
        """The filters this catalogue offers, given the current values."""

    @abstractmethod
    def shelves(self) -> list[dict[str, Any]]:
        """Rows for a landing page: {id, title, cards, values} — `values` are
        the filters that list the same titles in full ("See all")."""

    @abstractmethod
    def discover(self, values: dict[str, str], page: int) -> dict[str, Any]:
        """One page of titles: {cards, page, has_more, note}. `note` says when
        the catalogue had to ignore part of the request ("" otherwise)."""


def card(
    key: str,
    title: str,
    poster_url: str,
    open_: dict[str, Any],
    *,
    year: int = 0,
    rating: float = 0.0,
    overview: str = "",
    badge: str = "",
    genres: list[str] | None = None,
) -> dict[str, Any]:
    """A catalogue card. `open_` is {"card": <SeasonCard dict>} for a title a
    site plays directly, or {"search": {"term", "year"}} for one the sites
    must be searched for."""
    return {
        "key": key,
        "title": title,
        "year": year,
        "poster_url": poster_url,
        "rating": rating,
        "overview": overview,
        "badge": badge,
        "genres": genres or [],
        "open": open_,
    }


def split(value: str) -> list[str]:
    return [v for v in value.split(",") if v]


def parse_range(value: str, lo: int, hi: int) -> tuple[int, int]:
    """A "lo,hi" value clamped to the field's bounds; anything malformed is open."""
    try:
        a, b = (int(float(v)) for v in value.split(","))
    except ValueError:
        return lo, hi
    return max(lo, min(a, hi)), max(lo, min(b, hi))


def parallel(fns: list[Callable[[], T]]) -> list[T | None]:
    """Run blocking calls side by side; a failing one yields None, not an error,
    since a shelf that cannot load should only hide itself."""

    def safe(fn: Callable[[], T]) -> T | None:
        try:
            return fn()
        except Exception:  # noqa: BLE001
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(safe, fns))


class TtlCache:
    """A tiny per-process cache: shelves are fetched on every Home visit, and
    the lists behind them change by the hour, not by the second."""

    def __init__(self, ttl: float) -> None:
        self.ttl = ttl
        self._items: dict[str, tuple[float, Any]] = {}

    def get(self, key: str, compute: Callable[[], T]) -> T:
        hit = self._items.get(key)
        if hit and time.monotonic() - hit[0] < self.ttl:
            return hit[1]
        value = compute()
        self._items[key] = (time.monotonic(), value)
        return value


# --- TMDB -------------------------------------------------------------------

_TMDB_SORTS = [
    ("popularity.desc", "Most popular"),
    ("vote_average.desc", "Top rated"),
    ("vote_average.asc", "Lowest rated"),
    ("date.desc", "Newest"),
    ("date.asc", "Oldest"),
    ("title.asc", "Title A–Z"),
]
_TMDB_VOTES = ["0", "50", "100", "200", "500", "1000"]
# The genres Home shows a row for (TMDB movie genre ids).
_TMDB_SHELF_GENRES = [28, 35, 878, 27, 16, 18]
_FIRST_YEAR = 1900


def _tmdb_sort(kind: str, sort: str) -> str:
    """The generic sort names mapped onto TMDB's per-kind field names."""
    if sort.startswith("date."):
        field_ = "primary_release_date" if kind == "movie" else "first_air_date"
        return field_ + sort[len("date") :]
    if sort.startswith("title."):
        return ("title" if kind == "movie" else "name") + sort[len("title") :]
    return sort


class TmdbCatalog(Catalog):
    id = "tmdb"
    label = "TMDB"
    description = "Films & series · finds a source"

    def __init__(self) -> None:
        self._shelves = TtlCache(600)

    def available(self) -> bool:
        return bool(tmdb_key())

    def _last_year(self) -> int:
        return date.today().year + 5

    def schema(self, values: dict[str, str]) -> list[FilterField]:
        kind = values.get("kind") if values.get("kind") in ("movie", "tv") else "movie"
        genres = tmdb.genres(kind)
        last = self._last_year()
        return [
            FilterField(
                "kind",
                "Type",
                "select",
                [
                    {"value": "movie", "label": "Films"},
                    {"value": "tv", "label": "Series"},
                ],
                default="movie",
                reload=True,
            ),
            FilterField(
                "sort",
                "Sort",
                "select",
                [{"value": v, "label": label} for v, label in _TMDB_SORTS],
                default="popularity.desc",
            ),
            FilterField(
                "release",
                "Release",
                "select",
                [
                    {"value": "out", "label": "Released"},
                    {"value": "upcoming", "label": "Coming soon"},
                    {"value": "all", "label": "Any"},
                ],
                default="out",
            ),
            FilterField(
                "genres",
                "Genres",
                "multi",
                [{"value": str(g["id"]), "label": g["name"]} for g in genres],
            ),
            FilterField(
                "years",
                "Years",
                "range",
                default=f"{_FIRST_YEAR},{last}",
                min=_FIRST_YEAR,
                max=last,
            ),
            FilterField("score", "Score", "range", default="0,10", min=0, max=10),
            FilterField(
                "votes",
                "Votes",
                "select",
                [
                    {"value": v, "label": "Any" if v == "0" else f"{v}+"}
                    for v in _TMDB_VOTES
                ],
                default="0",
            ),
        ]

    def _cards(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        names: dict[int, str] = {}
        for kind in {r["kind"] for r in results}:
            names.update({g["id"]: g["name"] for g in tmdb.genres(kind)})
        today = date.today().isoformat()
        return [
            card(
                f"{r['kind']}-{r['tmdb_id']}",
                r["title"],
                r["poster_url"],
                {"search": {"term": r["title"], "year": r["year"]}},
                year=r["year"],
                rating=r["rating"],
                overview=r["overview"],
                # An announced title is dated to the day: the year alone would
                # not say how far off it is.
                badge=r["release_date"] if r["release_date"] > today else "",
                genres=[names[g] for g in r["genre_ids"] if g in names],
            )
            for r in results
        ]

    def discover(self, values: dict[str, str], page: int) -> dict[str, Any]:
        kind = values.get("kind") if values.get("kind") in ("movie", "tv") else "movie"
        last = self._last_year()
        lo, hi = parse_range(values.get("years", ""), _FIRST_YEAR, last)
        from_date = f"{lo}-01-01" if lo > _FIRST_YEAR else ""
        to_date = f"{hi}-12-31" if hi < last else ""
        # Bound the request, not only the response: under a "Newest" sort every
        # title on page one would otherwise be an unreleased announcement.
        release = values.get("release", "out")
        today = date.today()
        if release == "out":
            to_date = min(to_date or today.isoformat(), today.isoformat())
        elif release == "upcoming":
            tomorrow = (today + timedelta(days=1)).isoformat()
            from_date = max(from_date, tomorrow)
        min_score, max_score = parse_range(values.get("score", ""), 0, 10)
        votes = values.get("votes", "0")
        res = tmdb.discover(
            kind,
            _tmdb_sort(kind, values.get("sort", "popularity.desc")),
            ",".join(split(values.get("genres", ""))),
            float(min_score),
            float(max_score),
            int(votes) if votes.isdigit() else 0,
            from_date,
            to_date,
            page,
        )
        return {
            "cards": self._cards(res["results"]),
            "page": res["page"],
            "has_more": res["page"] < res["total_pages"],
            "note": "",
        }

    def shelves(self) -> list[dict[str, Any]]:
        return self._shelves.get("all", self._fetch_shelves)

    def _fetch_shelves(self) -> list[dict[str, Any]]:
        names = {g["id"]: g["name"] for g in tmdb.genres("movie")}
        picked = [g for g in _TMDB_SHELF_GENRES if g in names]
        trending, *rows = parallel(
            [tmdb.catalog]
            + [
                (
                    lambda g=g: tmdb.discover(
                        "movie", genres=str(g), to_date=date.today().isoformat()
                    )["results"][:12]
                )
                for g in picked
            ]
        )
        shelves = [
            {
                "id": "trending",
                "title": "Trending this week",
                "cards": self._cards(trending or []),
                "values": {},
            }
        ] + [
            {
                "id": f"genre-{g}",
                "title": names[g],
                "cards": self._cards(row or []),
                "values": {"kind": "movie", "genres": str(g)},
            }
            for g, row in zip(picked, rows)
        ]
        return [s for s in shelves if s["cards"]]


def build_catalogs(sites: dict[str, Any]) -> dict[str, Catalog]:
    """Every catalogue, in the order the UI lists them: sites first."""
    catalogs: dict[str, Catalog] = {
        sid: site for sid, site in sites.items() if isinstance(site, Catalog)
    }
    catalogs["tmdb"] = TmdbCatalog()
    return catalogs
