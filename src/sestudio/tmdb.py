from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Any

import httpx

from sestudio.config import _config_path, tmdb_key

logger = logging.getLogger(__name__)

_API = "https://api.themoviedb.org/3"
_IMG = "https://image.tmdb.org/t/p"
# Content here is French (VF/VOSTFR), so prefer French metadata; TMDB falls
# back to the original language per-field when a translation is missing.
_LANG = "fr-FR"
_TIMEOUT = 10
# The only date shape TMDB's discover filters accept.
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_CAST_LIMIT = 8
_RECOMMENDATION_LIMIT = 12
# Bumped whenever _normalise gains fields, so stale disk-cache entries
# (missing the new fields) are refetched instead of served.
_CACHE_VERSION = 3

# The sort orders the TMDB website itself offers on its discover pages.
_MOVIE_SORTS = frozenset(
    {
        "popularity.desc",
        "popularity.asc",
        "vote_average.desc",
        "vote_average.asc",
        "primary_release_date.desc",
        "primary_release_date.asc",
        "title.asc",
        "title.desc",
    }
)
_TV_SORTS = frozenset(
    {
        "popularity.desc",
        "popularity.asc",
        "vote_average.desc",
        "vote_average.asc",
        "first_air_date.desc",
        "first_air_date.asc",
        "name.asc",
        "name.desc",
    }
)


class TmdbDisabled(RuntimeError):
    """No API key configured — enrichment is opt-in."""


def _cache_path() -> Path:
    return _config_path().with_name("tmdb_cache.json")


_lock = threading.Lock()
_memory: dict[str, Any] | None = None


def _load_cache() -> dict[str, Any]:
    global _memory
    cached = _memory
    if cached is not None:
        return cached
    path = _cache_path()
    try:
        loaded = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception as exc:  # noqa: BLE001 — a corrupt cache must not break search
        logger.warning("Ignoring unreadable TMDB cache at %s: %s", path, exc)
        loaded = {}
    _memory = loaded
    return loaded


def _save_cache(cache: dict[str, Any]) -> None:
    path = _cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache), encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:  # pragma: no cover — cache is best-effort
        logger.debug("Could not write TMDB cache: %s", exc)


def clear_cache() -> None:
    """Drop the in-memory caches (used by tests)."""
    global _memory
    with _lock:
        _memory = None
        _genre_cache.clear()


def _client() -> httpx.Client:
    """A TLS-verifying client — unlike the scraper's, this one carries a key."""
    return httpx.Client(timeout=_TIMEOUT, follow_redirects=True)


def _image(path: str | None, size: str) -> str:
    return f"{_IMG}/{size}{path}" if path else ""


def _light_card(r: dict[str, Any], kind: str) -> dict[str, Any]:
    """A poster card: the shape shared by trending, discover and credits.

    The overview and genre ids ride along because the browse list can be read as
    detail rows, and every search/discover response already contains them —
    carrying them costs no extra request. Genre *names* are not resolved here:
    the client already holds the id→name list for its filter chips.
    """
    date = r.get("release_date") or r.get("first_air_date") or ""
    return {
        "tmdb_id": r.get("id"),
        "kind": kind,
        "title": r.get("title") or r.get("name") or "",
        "year": int(date[:4]) if date[:4].isdigit() else 0,
        # The full date as well as the year: a discover page mixes released and
        # unreleased titles, and only the day tells them apart. "" when TMDB
        # has no date at all, which reads as "undated", not "upcoming".
        "release_date": date,
        "rating": round(float(r.get("vote_average") or 0), 1),
        "poster_url": _image(r.get("poster_path"), "w342"),
        "overview": r.get("overview") or "",
        "genre_ids": [g for g in r.get("genre_ids") or [] if isinstance(g, int)],
    }


def _directors(detail: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    """Film directors, or a series' creators — the equivalent credit for TV."""
    if kind == "tv":
        people = detail.get("created_by") or []
    else:
        crew = (detail.get("credits") or {}).get("crew") or []
        people = [c for c in crew if c.get("job") == "Director"]
    return [
        {"id": p.get("id"), "name": p.get("name", "")} for p in people if p.get("name")
    ]


def _normalise(detail: dict[str, Any], kind: str) -> dict[str, Any]:
    """Reduce a TMDB payload to the fields the UI actually renders."""
    date = detail.get("release_date") or detail.get("first_air_date") or ""
    credits = detail.get("credits") or {}
    videos = (detail.get("videos") or {}).get("results") or []
    recommendations = (detail.get("recommendations") or {}).get("results") or []
    trailer = next(
        (
            v.get("key")
            for v in videos
            if v.get("site") == "YouTube" and v.get("type") == "Trailer"
        ),
        "",
    )
    return {
        "tmdb_id": detail.get("id"),
        "kind": kind,
        "title": detail.get("title") or detail.get("name") or "",
        "overview": detail.get("overview") or "",
        "year": int(date[:4]) if date[:4].isdigit() else 0,
        "rating": round(float(detail.get("vote_average") or 0), 1),
        "vote_count": int(detail.get("vote_count") or 0),
        "poster_url": _image(detail.get("poster_path"), "w342"),
        "backdrop_url": _image(detail.get("backdrop_path"), "w1280"),
        "genres": [g["name"] for g in detail.get("genres") or [] if g.get("name")],
        "cast": [
            {
                "id": c.get("id"),
                "name": c.get("name", ""),
                "character": c.get("character", ""),
                "profile_url": _image(c.get("profile_path"), "w185"),
            }
            for c in (credits.get("cast") or [])[:_CAST_LIMIT]
        ],
        "directors": _directors(detail, kind),
        "recommendations": [
            _light_card(r, r.get("media_type") or kind)
            for r in recommendations[:_RECOMMENDATION_LIMIT]
        ],
        "trailer_key": trailer,
    }


def enrich(title: str, year: int = 0, is_film: bool = False) -> dict[str, Any] | None:
    """Look up *title* on TMDB and return normalised metadata, or None.

    Results (including misses) are cached in memory and on disk, so repeated
    searches cost nothing. Raises TmdbDisabled when no API key is configured.
    """
    key = tmdb_key()
    if not key:
        raise TmdbDisabled("No TMDB API key configured")

    kind = "movie" if is_film else "tv"
    cache_key = f"v{_CACHE_VERSION}:{kind}:{title.casefold()}:{year}"
    with _lock:
        cache = _load_cache()
        if cache_key in cache:
            return cache[cache_key]

    try:
        with _client() as client:
            params: dict[str, Any] = {
                "api_key": key,
                "query": title,
                "language": _LANG,
            }
            # TMDB names the year filter differently per media type.
            if year:
                params["year" if kind == "movie" else "first_air_date_year"] = year
            found = client.get(f"{_API}/search/{kind}", params=params)
            found.raise_for_status()
            results = found.json().get("results") or []
            if not results and year:
                # The year is scraped from a title and can be wrong — retry without.
                params.pop("year", None)
                params.pop("first_air_date_year", None)
                found = client.get(f"{_API}/search/{kind}", params=params)
                found.raise_for_status()
                results = found.json().get("results") or []
            if not results:
                result: dict[str, Any] | None = None
            else:
                detail = client.get(
                    f"{_API}/{kind}/{results[0]['id']}",
                    params={
                        "api_key": key,
                        "language": _LANG,
                        "append_to_response": "credits,videos,recommendations",
                    },
                )
                detail.raise_for_status()
                result = _normalise(detail.json(), kind)
    except httpx.HTTPError as exc:
        # Network/API trouble must never break search — just skip enrichment.
        logger.warning("TMDB lookup failed for %r: %s", title, exc)
        return None

    with _lock:
        cache = _load_cache()
        cache[cache_key] = result
        _save_cache(cache)
    return result


def catalog() -> list[dict[str, Any]]:
    """A browsable list of poster cards (trending this week)."""
    key = tmdb_key()
    if not key:
        raise TmdbDisabled("No TMDB API key configured")
    try:
        with _client() as client:
            resp = client.get(
                f"{_API}/trending/all/week",
                params={"api_key": key, "language": _LANG},
            )
            resp.raise_for_status()
            results = resp.json().get("results") or []
    except httpx.HTTPError as exc:
        logger.warning("TMDB catalog fetch failed: %s", exc)
        return []

    return [
        _light_card(r, r["media_type"])
        for r in results
        if r.get("media_type") in ("movie", "tv")
    ]


_PEOPLE_LIMIT = 12


def search_people(query: str) -> list[dict[str, Any]]:
    """People matching *query*, most prominent first.

    Each carries the titles TMDB considers them known for, so a result is
    identifiable when several people share a name.
    """
    key = tmdb_key()
    if not key:
        raise TmdbDisabled("No TMDB API key configured")
    if not query.strip():
        return []
    try:
        with _client() as client:
            resp = client.get(
                f"{_API}/search/person",
                params={"api_key": key, "language": _LANG, "query": query},
            )
            resp.raise_for_status()
            results = resp.json().get("results") or []
    except httpx.HTTPError as exc:
        logger.warning("TMDB person search failed for %r: %s", query, exc)
        return []

    people: list[dict[str, Any]] = []
    for r in results[:_PEOPLE_LIMIT]:
        known_for = [
            t.get("title") or t.get("name") or ""
            for t in r.get("known_for") or []
            if t.get("media_type") in ("movie", "tv")
        ]
        people.append(
            {
                "id": r.get("id"),
                "name": r.get("name") or "",
                "known_for_department": r.get("known_for_department") or "",
                "profile_url": _image(r.get("profile_path"), "w185"),
                "known_for": [t for t in known_for if t][:3],
            }
        )
    return people


def discover(
    kind: str = "movie",
    sort_by: str = "popularity.desc",
    genres: str = "",
    min_score: float = 0.0,
    max_score: float = 10.0,
    min_votes: int = 0,
    from_date: str = "",
    to_date: str = "",
    page: int = 1,
) -> dict[str, Any]:
    """Browse the TMDB catalogue with the filters the TMDB site itself offers.

    `genres` is a comma-separated list of TMDB genre ids. `from_date`/`to_date`
    bound the release date as ``YYYY-MM-DD``, "" meaning "open". Not cached:
    discover pages are cheap, paginated and change with every filter tweak.
    """
    key = tmdb_key()
    if not key:
        raise TmdbDisabled("No TMDB API key configured")
    if kind not in ("movie", "tv"):
        raise ValueError(f"Unknown kind {kind!r}")
    if sort_by not in (_MOVIE_SORTS if kind == "movie" else _TV_SORTS):
        raise ValueError(f"Unknown sort {sort_by!r} for {kind}")

    params: dict[str, Any] = {
        "api_key": key,
        "language": _LANG,
        "sort_by": sort_by,
        "page": max(1, min(page, 500)),  # TMDB caps discover at 500 pages
    }
    if genres:
        params["with_genres"] = genres
    if min_score > 0:
        params["vote_average.gte"] = min_score
    if max_score < 10:
        params["vote_average.lte"] = max_score
    if min_votes > 0:
        params["vote_count.gte"] = min_votes
    # TMDB names the release-date field per media type. Anything that isn't a
    # plain YYYY-MM-DD is dropped rather than passed on: TMDB answers a
    # malformed date with an unfiltered page, which would silently look like a
    # filter that does nothing.
    date_field = "primary_release_date" if kind == "movie" else "first_air_date"
    if _ISO_DATE.fullmatch(from_date):
        params[f"{date_field}.gte"] = from_date
    if _ISO_DATE.fullmatch(to_date):
        params[f"{date_field}.lte"] = to_date
    try:
        with _client() as client:
            resp = client.get(f"{_API}/discover/{kind}", params=params)
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("TMDB discover failed: %s", exc)
        return {"page": 1, "total_pages": 1, "results": []}

    return {
        "page": payload.get("page") or 1,
        "total_pages": payload.get("total_pages") or 1,
        "results": [_light_card(r, kind) for r in payload.get("results") or []],
    }


# Genre lists are tiny and immutable in practice — one fetch per kind per process.
_genre_cache: dict[str, list[dict[str, Any]]] = {}


def genres(kind: str = "movie") -> list[dict[str, Any]]:
    """The TMDB genre list (id + name) for movies or TV."""
    key = tmdb_key()
    if not key:
        raise TmdbDisabled("No TMDB API key configured")
    if kind not in ("movie", "tv"):
        raise ValueError(f"Unknown kind {kind!r}")
    cached = _genre_cache.get(kind)
    if cached is not None:
        return cached
    try:
        with _client() as client:
            resp = client.get(
                f"{_API}/genre/{kind}/list",
                params={"api_key": key, "language": _LANG},
            )
            resp.raise_for_status()
            found = [
                {"id": g["id"], "name": g["name"]}
                for g in resp.json().get("genres") or []
                if g.get("id") and g.get("name")
            ]
    except httpx.HTTPError as exc:
        logger.warning("TMDB genre list failed: %s", exc)
        return []
    _genre_cache[kind] = found
    return found


def person(person_id: int) -> dict[str, Any] | None:
    """A person's profile and filmography (acting + directing), or None."""
    key = tmdb_key()
    if not key:
        raise TmdbDisabled("No TMDB API key configured")
    try:
        with _client() as client:
            resp = client.get(
                f"{_API}/person/{person_id}",
                params={
                    "api_key": key,
                    "language": _LANG,
                    "append_to_response": "combined_credits",
                },
            )
            resp.raise_for_status()
            detail = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("TMDB person %s lookup failed: %s", person_id, exc)
        return None

    combined = detail.get("combined_credits") or {}
    cast = combined.get("cast") or []
    crew = [
        c
        for c in combined.get("crew") or []
        if c.get("job") in ("Director", "Creator") or c.get("department") == "Directing"
    ]
    # One card per title: an actor-director appears once, with both roles noted.
    seen: dict[tuple[str, Any], dict[str, Any]] = {}
    for c in cast + crew:
        media = c.get("media_type")
        if media not in ("movie", "tv"):
            continue
        # Talk-show and documentary appearances as "Self" aren't filmography.
        character = (c.get("character") or "").casefold()
        if character.startswith(("self", "himself", "herself", "themselves")):
            continue
        dedupe_key = (media, c.get("id"))
        card = seen.get(dedupe_key)
        if card is None:
            card = {
                **_light_card(c, media),
                "role": "",
                "popularity": float(c.get("popularity") or 0),
            }
            seen[dedupe_key] = card
        role = c.get("character") or c.get("job") or ""
        if role and role not in card["role"]:
            card["role"] = f"{card['role']} · {role}" if card["role"] else role
    credits = sorted(seen.values(), key=lambda c: c["popularity"], reverse=True)
    for c in credits:
        del c["popularity"]

    return {
        "id": detail.get("id"),
        "name": detail.get("name") or "",
        "biography": detail.get("biography") or "",
        "known_for_department": detail.get("known_for_department") or "",
        "profile_url": _image(detail.get("profile_path"), "w342"),
        "birthday": detail.get("birthday") or "",
        "credits": credits,
    }
