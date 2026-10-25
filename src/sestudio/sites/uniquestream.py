"""UniqueStream (anime.uniquestream.net): an anime catalogue with its own JSON API.

Both a ContentSite and a Catalog. The API is open — no login, no referer — and
serves signed HLS playlists with WebVTT subtitles, so streams need no host
resolver: an episode's single candidate is resolved by asking the API for the
wanted audio version.

Languages map onto the app's: "vf" is the French dub (fr-FR audio), "vostfr"
the original audio (usually Japanese) with French subtitles enabled when the
title has them.

Segments are AES-128 encrypted, and the playlist's key.bin is not the key: it is
the key encrypted again (base64, AES-CBC under SHA-256("key"/"iv" + media id)),
and only the real one when asked with the media id in a header; otherwise it
is a decoy. The site's own player does both. The stream proxy undoes it here, so the
streams are marked to play — and download — only through the proxy.
"""

from __future__ import annotations

import base64
import hashlib
import math
import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from sestudio.catalogs import (
    Catalog,
    FilterField,
    TtlCache,
    card,
    parallel,
    split,
)
from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import Episode, SeasonCard, StreamSource, Subtitle
from sestudio.providers.base import StreamProvider
from sestudio.sites.base import (
    ContentSite,
    PageResult,
    ProxyFix,
    SiteError,
    StreamCandidate,
)

BASE = "https://anime.uniquestream.net"
API = f"{BASE}/api/v1"
PROVIDER = "uniquestream"

# The API refuses episode pages larger than this.
_EPISODES_PER_PAGE = 20
# Search hits whose seasons are expanded into cards: each costs a series fetch.
_SEARCH_SERIES = 12
_SEARCH_MOVIES = 6
# The API caps most lists at 20 per page (it answers 422 above that).
_DISCOVER_PAGE = 20
_SEARCH_PAGE = 40
# shortcut: only French and English sidecars are kept (a title carries up to 16
# languages); widen if another subtitle language is ever wanted.
_SUB_LANGS = {"fr-FR": "Français", "en-US": "English"}
_POSTER_SIZE = re.compile(r"/posters/\d+x\d+/")

_SORTS = [
    ("trending", "Trending"),
    ("popular", "Most popular"),
    ("new", "New episodes"),
    ("highest-rated", "Top rated"),
    # Not premieres: the next episode of each airing show, over the next two weeks.
    ("upcoming", "Airing soon"),
    ("hidden-gems", "Hidden gems"),
]
# Lists the API serves whole: paging them returns the same items again.
_SINGLE_PAGE_SORTS = {"trending": 24, "upcoming": 30}
# The only orders the genre listing accepts as its second category.
_GENRE_SORTS = {"popular", "new"}
_SHELF_GENRES = ["action", "romance", "comedy", "fantasy"]


def _poster(url: str) -> str:
    """Search hands out 60x90 thumbnails; the same image exists at poster size."""
    return _POSTER_SIZE.sub("/posters/480x720/", url or "")


def decode_key(body: bytes, media_id: str) -> bytes:
    """The real 16-byte AES key from the key.bin the CDN serves (see module doc)."""
    key = hashlib.sha256(f"key{media_id}".encode()).digest()[:16]
    iv = hashlib.sha256(f"iv{media_id}".encode()).digest()[:16]
    decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    plain = decryptor.update(base64.b64decode(body)) + decryptor.finalize()
    return plain[:16]  # what follows is PKCS#7 padding


def _langs(audio_locales: list[str]) -> list[str]:
    """The app languages an episode exists in, from its audio versions.

    The original audio is always there; when the API lists no locales at all
    (its Chinese sources do not) that original is the only version.
    """
    langs = []
    if "fr-FR" in audio_locales:
        langs.append("vf")
    if set(audio_locales) != {"fr-FR"}:
        langs.append("vostfr")
    return langs


class UniqueStreamSite(ContentSite, Catalog):
    id = "uniquestream"
    display_name = "UniqueStream"
    home_url = BASE
    label = "UniqueStream"
    description = "Anime · plays directly"
    is_anime = True

    def __init__(self) -> None:
        self._series = TtlCache(600)
        self._shelves = TtlCache(600)
        self._filters = TtlCache(3600)
        # Stream directory -> media id, recorded as streams are resolved: a key
        # URL carries no media id, but always lives under its stream's directory.
        self._media_ids: dict[str, str] = {}

    # --- HTTP ---------------------------------------------------------------

    def _get(self, path: str, **params: Any) -> Any:
        try:
            with new_client(headers={"User-Agent": BROWSER_UA}) as client:
                resp = client.get(f"{API}/{path}", params=params)
                resp.raise_for_status()
                return resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SiteError(f"uniquestream {path}: {exc}") from exc

    def _series_detail(self, series_id: str) -> dict[str, Any]:
        return self._series.get(series_id, lambda: self._get(f"series/{series_id}"))

    # --- ContentSite ----------------------------------------------------------

    def provider_order(self) -> tuple[str, ...]:
        return (PROVIDER,)

    def owns_url(self, url: str) -> bool:
        return urlsplit(url).hostname == urlsplit(BASE).hostname

    @staticmethod
    def series_url(series_id: str, season_id: str = "") -> str:
        """A season's page URL. The first season's carries no season id, so a
        series opened from a catalogue card and from search is the same title."""
        url = f"{BASE}/series/{series_id}"
        return f"{url}?season={season_id}" if season_id else url

    def web_url(self, url: str) -> str:
        # The site's pages need the title's slug, which page_url doesn't carry.
        segments = [s for s in urlsplit(url).path.split("/") if s]
        if len(segments) != 2 or segments[0] not in ("series", "movie"):
            return BASE
        kind, cid = segments
        try:
            detail = (
                self._series_detail(cid)
                if kind == "series"
                else self._get(f"movie/{cid}")
            )
        except SiteError:
            return BASE
        # The site's own makeTitle().
        slug = re.sub(r"[^a-zA-Z0-9]+", "-", detail.get("title") or "") or "title"
        return f"{BASE}/{'series' if kind == 'series' else 'movies'}/{cid}/{slug}"

    def _season_cards(self, series: dict[str, Any]) -> list[SeasonCard]:
        seasons = series.get("seasons") or []
        title = series.get("title") or ""
        poster = next(
            (
                i["url"]
                for i in series.get("images") or []
                if i.get("type") == "poster_tall"
            ),
            "",
        )
        return [
            SeasonCard(
                newsid=season["content_id"],
                # Numbered by position: the API's own numbers repeat when a
                # series lists a dub or a part as a season of its own.
                title=title
                if len(seasons) == 1
                else f"{title} - {season.get('title') or f'Season {n}'}",
                series_name=title,
                season_number=n,
                poster_url=poster,
                page_url=self.series_url(
                    series["content_id"], "" if n == 1 else season["content_id"]
                ),
                is_anime=True,
                source=self.id,
            )
            for n, season in enumerate(seasons, start=1)
        ]

    def _movie_card(self, movie: dict[str, Any]) -> SeasonCard:
        return SeasonCard(
            newsid=movie["content_id"],
            title=movie.get("title") or "",
            series_name=movie.get("title") or "",
            season_number=0,
            poster_url=_poster(movie.get("image") or ""),
            page_url=f"{BASE}/movie/{movie['content_id']}",
            is_film=True,
            is_anime=True,
            year=int(movie.get("year") or 0),
            source=self.id,
        )

    def search(self, query: str) -> list[SeasonCard]:
        found = self._get("search", query=query, t="all", limit=_SEARCH_SERIES)
        series_ids = [s["content_id"] for s in found.get("series") or []][
            :_SEARCH_SERIES
        ]
        details = parallel(
            [lambda sid=sid: self._series_detail(sid) for sid in series_ids]
        )
        cards = [c for d in details if d for c in self._season_cards(d)]
        cards += [
            self._movie_card(m) for m in (found.get("movies") or [])[:_SEARCH_MOVIES]
        ]
        return cards

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        parts = urlsplit(url)
        segments = [s for s in parts.path.split("/") if s]
        if len(segments) == 2 and segments[0] == "movie":
            return self._fetch_movie(segments[1], lang)
        if len(segments) != 2 or segments[0] != "series":
            raise SiteError(f"Not a UniqueStream title URL: {url}")
        series = self._series_detail(segments[1])
        seasons = series.get("seasons") or []
        if not seasons:
            raise SiteError(f"{series.get('title')} has no seasons")
        wanted = parse_qs(parts.query).get("season", [""])[0]
        number, season = next(
            (
                (n, s)
                for n, s in enumerate(seasons, start=1)
                if s["content_id"] == wanted
            ),
            (1, seasons[0]),
        )
        listed = self._season_episodes(season)
        want = "vf" if lang == "vf" else "vostfr"
        episodes = []
        for ep in listed:
            langs = _langs(ep.get("audio_locales") or [])
            episodes.append(
                Episode(
                    number=len(episodes) + 1,
                    title=ep.get("title") or f"Episode {len(episodes) + 1}",
                    season=number,
                    embed_urls=(
                        {PROVIDER: f"episode/{ep['content_id']}#{want}"}
                        if want in langs
                        else {}
                    ),
                    langs=langs,
                )
            )
        available = sorted(
            {lg for ep in episodes for lg in ep.langs}, key=["vf", "vostfr"].index
        )
        return PageResult(
            season=number, episodes=episodes, is_film=False, available_langs=available
        )

    def _season_episodes(self, season: dict[str, Any]) -> list[dict[str, Any]]:
        sid = season["content_id"]

        def page(n: int) -> list[dict[str, Any]]:
            got = self._get(
                f"season/{sid}/episodes",
                page=n,
                limit=_EPISODES_PER_PAGE,
                order_by="asc",
            )
            return got if isinstance(got, list) else []

        count = int(season.get("episode_count") or 0)
        if count:
            pages = parallel(
                [
                    lambda n=n: page(n)
                    for n in range(1, math.ceil(count / _EPISODES_PER_PAGE) + 1)
                ]
            )
            if any(p is None for p in pages):
                raise SiteError(f"Could not list the episodes of season {sid}")
            listed = [ep for p in pages for ep in p or []]
        else:
            listed, n = [], 1
            while batch := page(n):
                listed += batch
                if len(batch) < _EPISODES_PER_PAGE:
                    break
                n += 1
        # Recaps and trailers are listed among the episodes; they are not part
        # of the season.
        return [ep for ep in listed if not ep.get("is_clip")]

    def _fetch_movie(self, movie_id: str, lang: str) -> PageResult:
        detail = self._get(f"movie/{movie_id}")
        media = self._get(f"movie/{movie_id}/media/hls/ja-JP")
        versions = [media.get("hls") or {}] + list(
            (media.get("versions") or {}).get("hls") or []
        )
        langs = _langs([v.get("locale") or "" for v in versions if v])
        want = "vf" if lang == "vf" else "vostfr"
        episode = Episode(
            number=1,
            title=detail.get("title") or movie_id,
            season=0,
            embed_urls={PROVIDER: f"movie/{movie_id}#{want}"} if want in langs else {},
            langs=langs,
        )
        return PageResult(
            season=0, episodes=[episode], is_film=True, available_langs=langs
        )

    def resolve_candidate(
        self,
        candidate: StreamCandidate,
        host_resolvers: dict[str, StreamProvider],
    ) -> StreamSource:
        if candidate.provider != PROVIDER:
            raise SiteError(f"No resolver for provider {candidate.provider!r}")
        path, _, lang = candidate.embed_url.partition("#")
        dub = lang == "vf"
        media = self._get(f"{path}/media/hls/{'fr-FR' if dub else 'ja-JP'}")
        versions = [
            v
            for v in [media.get("hls")]
            + list((media.get("versions") or {}).get("hls") or [])
            if v
        ]
        if dub:
            picked = next((v for v in versions if v.get("locale") == "fr-FR"), None)
        else:
            picked = (
                next((v for v in versions if v.get("original")), None)
                or next((v for v in versions if v.get("locale") == "ja-JP"), None)
                or next((v for v in versions if v.get("locale") != "fr-FR"), None)
            )
        if not picked or not picked.get("playlist"):
            raise SiteError(f"No {'French' if dub else 'original'} audio for {path}")
        if media.get("media_id"):
            stream_dir = picked["playlist"].split("?")[0].rsplit("/", 1)[0] + "/"
            self._media_ids[stream_dir] = str(media["media_id"])
        subs = [s for s in picked.get("subtitles") or [] if s.get("url")]
        kept = [s for s in subs if s.get("language") in _SUB_LANGS] or subs
        kept.sort(key=lambda s: s.get("language") != "fr-FR")
        return StreamSource(
            url=picked["playlist"],
            referer=f"{BASE}/",
            provider=PROVIDER,
            via_proxy=True,
            subtitles=[
                Subtitle(
                    url=s["url"],
                    lang=s.get("language") or "",
                    label=_SUB_LANGS.get(
                        s.get("language") or "", s.get("language") or ""
                    ),
                    # The original audio needs the French track on; the dub
                    # plays without one.
                    default=not dub and s.get("language") == "fr-FR",
                )
                for s in kept
            ],
        )

    def proxy_fix(self, url: str) -> ProxyFix | None:
        path = url.split("?")[0]
        if not path.endswith("/key.bin"):
            return None
        media_id = next(
            (
                mid
                for stream_dir, mid in self._media_ids.items()
                if path.startswith(stream_dir)
            ),
            None,
        )
        if media_id is None:
            return None
        # Without the media id header the CDN answers with a decoy key.
        return ProxyFix(
            headers={"x-am-media-id": media_id},
            transform=lambda body: decode_key(body, media_id),
        )

    # --- Catalog --------------------------------------------------------------

    def _filter_lists(self) -> dict[str, Any]:
        return self._filters.get("filters", lambda: self._get("search/filters"))

    def schema(self, values: dict[str, str]) -> list[FilterField]:
        lists = self._filter_lists()
        years = sorted((int(y) for y in lists.get("years") or []), reverse=True)
        return [
            FilterField(
                "sort",
                "Sort",
                "select",
                [{"value": v, "label": label} for v, label in _SORTS],
                default="trending",
            ),
            FilterField(
                "type",
                "Type",
                "select",
                [
                    {"value": "all", "label": "All"},
                    {"value": "series", "label": "Series"},
                    {"value": "movies", "label": "Movies"},
                ],
                default="all",
            ),
            FilterField(
                "genres",
                "Genres",
                "multi",
                [
                    {"value": g["name"], "label": g["title"]}
                    for g in lists.get("genres") or []
                ],
                max_selected=2,
                quick=True,
            ),
            FilterField(
                "audio",
                "Audio",
                "select",
                [
                    {"value": "", "label": "Any"},
                    {"value": "sub", "label": "Subtitled"},
                    {"value": "dub", "label": "Dubbed"},
                    {"value": "both", "label": "Both"},
                ],
            ),
            FilterField(
                "status",
                "Status",
                "select",
                [
                    {"value": "", "label": "Any"},
                    {"value": "ongoing", "label": "Airing"},
                    {"value": "completed", "label": "Finished"},
                ],
            ),
            FilterField(
                "year",
                "Year",
                "select",
                [{"value": "", "label": "Any"}]
                + [{"value": str(y), "label": str(y)} for y in years],
            ),
        ]

    def _catalog_card(self, item: dict[str, Any]) -> dict[str, Any]:
        cid = item["content_id"]
        title = item.get("title") or ""
        is_movie = item.get("type") == "movie"
        season_card = (
            self._movie_card(item)
            if is_movie
            else SeasonCard(
                newsid=cid,
                title=title,
                series_name=title,
                season_number=1,
                poster_url=_poster(item.get("image") or ""),
                page_url=self.series_url(cid),
                is_anime=True,
                year=int(item.get("year") or 0),
                source=self.id,
            )
        )
        # The full timestamp: most of the schedule airs within days, so the hour matters.
        airing = item.get("next_airing_at") or ""
        return card(
            f"{'m' if is_movie else 's'}-{cid}",
            title,
            _poster(item.get("image") or ""),
            {"card": vars(season_card)},
            year=int(item.get("year") or 0),
            # Scored out of 100; the app shows ratings out of 10.
            rating=round(float(item.get("score") or 0) / 10, 1),
            overview=item.get("description") or "",
            badge=airing,
        )

    def _list(
        self, sort: str, kind: str, page: int, limit: int
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if sort not in _SINGLE_PAGE_SORTS:
            params["page"] = page
        if kind != "all":
            params["type"] = kind
        got = self._get(f"videos/{sort}", **params)
        items = got.get("data") if isinstance(got, dict) else got
        return items or []

    def discover(self, values: dict[str, str], page: int) -> dict[str, Any]:
        sort = values.get("sort") or "trending"
        kind = (
            values.get("type") if values.get("type") in ("series", "movies") else "all"
        )
        genres = split(values.get("genres", ""))[:2]
        narrowing = {k: values[k] for k in ("audio", "status", "year") if values.get(k)}
        note = ""
        if narrowing:
            # Only the A–Z search takes these filters, and it takes one genre.
            params: dict[str, Any] = {**narrowing, "page": page, "limit": _SEARCH_PAGE}
            params["t"] = kind
            if genres:
                params["genre"] = genres[0]
            got = self._get("search", **params)
            series, movies = got.get("series") or [], got.get("movies") or []
            items = series + movies
            note = (
                "Sorted A–Z: UniqueStream can only list these filters alphabetically."
            )
            if len(genres) > 1:
                note = "Sorted A–Z, first genre only: UniqueStream combines these filters with one genre."
            # The page size applies to each kind on its own.
            has_more = max(len(series), len(movies)) >= _SEARCH_PAGE
        elif genres:
            second = (
                genres[1]
                if len(genres) > 1
                else (sort if sort in _GENRE_SORTS else "popular")
            )
            got = self._get(
                "browse",
                categories=f"{genres[0]},{second}",
                type=kind,
                page=page,
                limit=_DISCOVER_PAGE,
            )
            items = got if isinstance(got, list) else []
            if len(genres) == 1 and sort not in _GENRE_SORTS:
                note = "Sorted by popularity: a genre can only be listed by popularity or newest."
            has_more = len(items) >= _DISCOVER_PAGE
        else:
            items = self._list(
                sort, kind, page, _SINGLE_PAGE_SORTS.get(sort, _DISCOVER_PAGE)
            )
            has_more = sort not in _SINGLE_PAGE_SORTS and len(items) >= _DISCOVER_PAGE
        if kind != "all":
            # Some lists ignore the type parameter; the cards say what they are.
            want = "movie" if kind == "movies" else "show"
            items = [i for i in items if i.get("type", want) == want]
        return {
            "cards": [self._catalog_card(i) for i in items if i.get("content_id")],
            "page": page,
            "has_more": has_more,
            "note": note,
        }

    def shelves(self) -> list[dict[str, Any]]:
        return self._shelves.get("all", self._fetch_shelves)

    def _fetch_shelves(self) -> list[dict[str, Any]]:
        titles = dict(_SORTS)
        lists = [
            ("trending", "Trending this week"),
            ("upcoming", titles["upcoming"]),
            ("popular", titles["popular"]),
            ("new", titles["new"]),
            ("highest-rated", titles["highest-rated"]),
        ]
        genre_names = {
            g["name"]: g["title"] for g in self._filter_lists().get("genres") or []
        }
        genres = [g for g in _SHELF_GENRES if g in genre_names]
        fetched = parallel(
            [lambda s=s: self._list(s, "all", 1, 18) for s, _ in lists]
            + [
                lambda g=g: self._get(
                    "browse", categories=f"{g},popular", type="all", limit=18
                )
                for g in genres
            ]
        )
        specs = [(s, title, {"sort": s}) for s, title in lists] + [
            (f"genre-{g}", genre_names[g], {"genres": g, "sort": "popular"})
            for g in genres
        ]
        shelves = []
        for (sid, title, values), items in zip(specs, fetched):
            cards = [self._catalog_card(i) for i in items or [] if i.get("content_id")]
            if cards:
                shelves.append(
                    {"id": sid, "title": title, "cards": cards, "values": values}
                )
        return shelves
