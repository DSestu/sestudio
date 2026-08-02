from __future__ import annotations

import json
import logging
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
_CAST_LIMIT = 8


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
    """Drop the in-memory cache (used by tests)."""
    global _memory
    with _lock:
        _memory = None


def _client() -> httpx.Client:
    """A TLS-verifying client — unlike the scraper's, this one carries a key."""
    return httpx.Client(timeout=_TIMEOUT, follow_redirects=True)


def _image(path: str | None, size: str) -> str:
    return f"{_IMG}/{size}{path}" if path else ""


def _normalise(detail: dict[str, Any], kind: str) -> dict[str, Any]:
    """Reduce a TMDB payload to the fields the UI actually renders."""
    date = detail.get("release_date") or detail.get("first_air_date") or ""
    credits = detail.get("credits") or {}
    videos = (detail.get("videos") or {}).get("results") or []
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
        "poster_url": _image(detail.get("poster_path"), "w342"),
        "backdrop_url": _image(detail.get("backdrop_path"), "w1280"),
        "genres": [g["name"] for g in detail.get("genres") or [] if g.get("name")],
        "cast": [
            {
                "name": c.get("name", ""),
                "character": c.get("character", ""),
                "profile_url": _image(c.get("profile_path"), "w185"),
            }
            for c in (credits.get("cast") or [])[:_CAST_LIMIT]
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
    cache_key = f"{kind}:{title.casefold()}:{year}"
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
                        "append_to_response": "credits,videos",
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

    cards = []
    for r in results:
        media = r.get("media_type")
        if media not in ("movie", "tv"):
            continue
        date = r.get("release_date") or r.get("first_air_date") or ""
        cards.append(
            {
                "tmdb_id": r.get("id"),
                "kind": media,
                "title": r.get("title") or r.get("name") or "",
                "year": int(date[:4]) if date[:4].isdigit() else 0,
                "rating": round(float(r.get("vote_average") or 0), 1),
                "poster_url": _image(r.get("poster_path"), "w342"),
            }
        )
    return cards
