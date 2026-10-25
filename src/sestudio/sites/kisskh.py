"""kisskh — an Angular app over an open JSON API that hosts its own video files.

Catalogue, search and title pages are plain JSON. Only the two playback calls
(episode stream, subtitle list) are gated: each needs a ``kkey`` computed in the
browser by an obfuscated global from the site's ``common.js``. Rather than
reimplement it, the script is run in the sandboxed JS engine (jsdecode), fed the
same inputs the player passes — inputs that live in one of the app's lazy
chunks and are re-read from there, since a redeploy can change them.

Streams are the site's own files (mp4 for dramas, HLS for anime), so this site
overrides ``resolve_candidate`` and never touches the shared host resolvers.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlsplit

from sestudio.http_client import new_client
from sestudio.models import Episode, SeasonCard, StreamSource, Subtitle
from sestudio.providers import jsdecode
from sestudio.providers.base import StreamProvider
from sestudio.sites.base import (
    BrowseRow,
    ContentSite,
    PageResult,
    SiteError,
    StreamCandidate,
)

logger = logging.getLogger(__name__)

BASE = "https://kisskh.do"
API = f"{BASE}/api"
PROVIDER = "kisskh"

# The app's catalogue types; 0 is not "all" (it answers like 1).
_DRAMA, _MOVIE, _ANIME, _HOLLYWOOD = 1, 2, 3, 4
_SOUTH_KOREA = 2
# List orders, read off the live site: 1 popular, 2 last updated.
_POPULAR, _UPDATED = 1, 2

# Search fans out per type; each answers up to ~100 hits, more than a results
# page (and its per-card TMDB lookups) should carry.
_SEARCH_PER_TYPE = 20
_ROW_SIZE = 20

# How long the scraped key inputs are trusted before the next use re-reads them.
_CONFIG_TTL = 6 * 3600.0

_EPISODE_ID_RE = re.compile(r"/DramaList/Episode/(\d+)\.png")
_YEAR_RE = re.compile(r"\((\d{4})\)\s*$")
_SEASON_RE = re.compile(r"\s*[-:]?\s*Season\s+(\d+)\b", re.IGNORECASE)
_SLUG_RE = re.compile(r"[^A-Za-z0-9]+")
_COMMON_JS_RE = re.compile(r'src="(common\.js[^"]*)"')
_RUNTIME_JS_RE = re.compile(r'src="(runtime\.[0-9a-f]+\.js)"')
_CHUNK_MAP_RE = re.compile(r'\{((?:\d+:"[0-9a-f]{16}",?)+)\}')
_KEY_FN_RE = re.compile(r'key:"key",value:function\([^)]*\)\{return\s*(_0x[0-9a-f]+)\(')
_STR_FIELD = r'this\.{}="([^"]+)"'


@dataclass(frozen=True)
class _KeyConfig:
    """Everything the ``kkey`` signer needs besides the episode id."""

    script: str
    function: str
    app_ver: str
    platform_ver: int
    video_guid: str
    sub_guid: str


# Values as of 2026-10-25, used when the live chunks cannot be read.
_FALLBACK = {
    "function": "_0x54b991",
    "app_ver": "2.8.10",
    "platform_ver": 4830201,
    "video_guid": "62f176f3bb1b5b8e70e39932ad34a0c7",
    "sub_guid": "VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp",
    "script": "common.js?v=9082123",
}


def _year(title: str) -> int:
    m = _YEAR_RE.search(title)
    return int(m.group(1)) if m else 0


def _season(title: str) -> tuple[str, int]:
    """Split ``"Show Season 2"`` into its series name and season number.

    kisskh lists each season as its own title; splitting keeps a multi-season
    show in one folder and its episodes numbered S02Exx on disk.
    """
    m = _SEASON_RE.search(title)
    if not m:
        return title, 1
    return (title[: m.start()] + title[m.end() :]).strip(" -:") or title, int(
        m.group(1)
    )


def page_url(drama_id: int, title: str) -> str:
    slug = _SLUG_RE.sub("-", title).strip("-") or "drama"
    return f"{BASE}/Drama/{slug}?id={drama_id}"


def _drama_id(url: str) -> int:
    ids = parse_qs(urlsplit(url).query).get("id", [""])
    if not ids[0].isdigit():
        raise SiteError(f"Not a kisskh title URL: {url}")
    return int(ids[0])


class KisskhSite(ContentSite):
    id = "kisskh"
    display_name = "KissKH"

    def __init__(self) -> None:
        self._config: _KeyConfig | None = None
        self._config_at = 0.0
        self._lock = threading.Lock()

    def owns_url(self, url: str) -> bool:
        return urlsplit(url).hostname == urlsplit(BASE).hostname

    def provider_order(self) -> tuple[str, ...]:
        return (PROVIDER,)

    # --- catalogue ---------------------------------------------------------

    def _get_json(self, path: str, **params: Any) -> Any:
        try:
            with new_client(headers={"Referer": f"{BASE}/"}) as client:
                resp = client.get(f"{API}/{path}", params=params or None)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            raise SiteError(f"kisskh {path} failed: {exc}") from exc

    def _card(self, item: dict[str, Any], kind: int) -> SeasonCard:
        title = str(item.get("title") or "")
        series, season = _season(title)
        is_film = kind == _MOVIE and int(item.get("episodesCount") or 0) <= 1
        return SeasonCard(
            newsid=str(item["id"]),
            title=title,
            series_name=series,
            season_number=0 if is_film else season,
            poster_url=str(item.get("thumbnail") or ""),
            page_url=page_url(int(item["id"]), title),
            is_film=is_film,
            is_anime=kind == _ANIME,
            year=_year(title),
            source=self.id,
        )

    def search(self, query: str) -> list[SeasonCard]:
        kinds = (_DRAMA, _MOVIE, _ANIME, _HOLLYWOOD)

        def one(kind: int) -> list[SeasonCard]:
            hits = self._get_json("DramaList/Search", q=query, type=kind)
            return [self._card(h, kind) for h in hits[:_SEARCH_PER_TYPE]]

        with ThreadPoolExecutor(max_workers=len(kinds)) as pool:
            results = list(pool.map(one, kinds))
        cards: list[SeasonCard] = []
        seen: set[str] = set()
        for card in (c for batch in results for c in batch):
            if card.newsid not in seen:
                seen.add(card.newsid)
                cards.append(card)
        return cards

    def browse(self) -> list[BrowseRow]:
        rows = [
            ("KissKH · Popular K-dramas", _DRAMA, _SOUTH_KOREA, _POPULAR),
            ("KissKH · Popular anime", _ANIME, 0, _POPULAR),
            ("KissKH · Just updated", _DRAMA, 0, _UPDATED),
        ]

        def one(spec: tuple[str, int, int, int]) -> BrowseRow:
            title, kind, country, order = spec
            data = self._get_json(
                "DramaList/List",
                page=1,
                type=kind,
                sub=0,
                country=country,
                status=0,
                order=order,
                pageSize=_ROW_SIZE,
            )
            return BrowseRow(title, [self._card(i, kind) for i in data.get("data", [])])

        with ThreadPoolExecutor(max_workers=len(rows)) as pool:
            return [r for r in pool.map(one, rows) if r.cards]

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        drama = self._get_json(f"DramaList/Drama/{_drama_id(url)}", isq="false")
        title = str(drama.get("title") or "")
        series, season = _season(title)
        raw = sorted(drama.get("episodes") or [], key=lambda e: float(e["number"]))
        is_film = drama.get("type") == "Movie" and len(raw) <= 1
        season = 0 if is_film else season

        episodes: list[Episode] = []
        taken: set[int] = set()
        # Specials come as fractional numbers (12.5); they go after the season
        # so no regular episode loses its number.
        regular = [e for e in raw if float(e["number"]).is_integer()]
        specials = [e for e in raw if not float(e["number"]).is_integer()]
        next_free = max((int(e["number"]) for e in regular), default=0) + 1
        for ep in regular + specials:
            number = float(ep["number"])
            if number.is_integer() and int(number) not in taken:
                n = int(number)
            else:
                n, next_free = next_free, next_free + 1
            taken.add(n)
            label = f"{number:g}"
            episodes.append(
                Episode(
                    number=n,
                    title=series if is_film else f"Episode {label}",
                    season=season,
                    embed_urls={PROVIDER: f"{API}/DramaList/Episode/{ep['id']}.png"},
                    # One version per episode: original audio, subtitled.
                    langs=["vostfr"],
                )
            )
        return PageResult(
            season=season,
            episodes=episodes,
            is_film=is_film,
            available_langs=["vostfr"],
        )

    # --- playback ----------------------------------------------------------

    def refresh(self) -> None:
        with self._lock:
            self._config = self._load_config()
            self._config_at = time.monotonic()

    def _key_config(self) -> _KeyConfig:
        with self._lock:
            if self._config is None or time.monotonic() - self._config_at > _CONFIG_TTL:
                self._config = self._load_config()
                self._config_at = time.monotonic()
            return self._config

    def _load_config(self) -> _KeyConfig:
        """Read the signer script and its inputs off the live app.

        Each value falls back to the last known one on its own, so a site
        redeploy that moves one regex target only costs that one value.
        """
        found: dict[str, Any] = {}
        script = ""
        try:
            with new_client(headers={"Referer": f"{BASE}/"}) as client:
                home = client.get(f"{BASE}/").text
                m = _COMMON_JS_RE.search(home)
                found["script"] = m.group(1) if m else _FALLBACK["script"]
                script = client.get(f"{BASE}/{found['script']}").text
                runtime = _RUNTIME_JS_RE.search(home)
                chunk_map = _CHUNK_MAP_RE.search(
                    client.get(f"{BASE}/{runtime.group(1)}").text if runtime else ""
                )
                pairs = chunk_map.group(1).split(",") if chunk_map else []
                for pair in pairs:
                    chunk_id, digest = pair.split(":")
                    text = client.get(
                        f"{BASE}/{chunk_id}.{digest.strip(chr(34))}.js"
                    ).text
                    _scan_chunk(text, found)
                    if len(found) == len(_FALLBACK):
                        break
        except Exception as exc:  # noqa: BLE001 — fall back to known values below
            logger.warning("kisskh key config refresh failed: %s", exc)
        missing = sorted(k for k in _FALLBACK if k not in found)
        if missing:
            logger.warning("kisskh: using last known %s", ", ".join(missing))
        values = {**_FALLBACK, **found}
        if not script:
            raise SiteError("kisskh signer script unreachable")
        values["script"] = script
        return _KeyConfig(**values)

    def _kkey(self, episode_id: int, guid: str, cfg: _KeyConfig) -> str:
        app = "kisskh"
        args = [episode_id, None, cfg.app_ver, guid, cfg.platform_ver] + [app] * 6
        key = jsdecode.call_script_function(
            cfg.script, cfg.function, args, urlsplit(BASE).hostname or ""
        )
        if not key:
            raise SiteError("kisskh key could not be computed (no JS engine?)")
        return key

    def resolve_candidate(
        self,
        candidate: StreamCandidate,
        host_resolvers: dict[str, StreamProvider],
    ) -> StreamSource:
        m = _EPISODE_ID_RE.search(candidate.embed_url)
        if candidate.provider != PROVIDER or not m:
            raise SiteError(f"Not a kisskh episode: {candidate.embed_url}")
        episode_id = int(m.group(1))
        cfg = self._key_config()

        video = self._get_json(
            f"DramaList/Episode/{episode_id}.png",
            err="false",
            ts="null",
            time="null",
            kkey=self._kkey(episode_id, cfg.video_guid, cfg),
        )
        url = str(video.get("Video") or "")
        if not url:
            raise SiteError(f"kisskh has no stream for episode {episode_id}")

        try:
            subs = self._get_json(
                f"Sub/{episode_id}", kkey=self._kkey(episode_id, cfg.sub_guid, cfg)
            )
        except SiteError as exc:
            # The video is the point; a title without subtitles still plays.
            logger.warning("kisskh subtitles unavailable for %s: %s", episode_id, exc)
            subs = []
        return StreamSource(
            url=url,
            referer=f"{BASE}/",
            provider=PROVIDER,
            subtitles=_subtitles(subs),
        )


def _scan_chunk(text: str, found: dict[str, Any]) -> None:
    for key, field in (
        ("video_guid", "viGuid"),
        ("sub_guid", "subGuid"),
        ("app_ver", "appVer"),
    ):
        m = re.search(_STR_FIELD.format(field), text)
        if m:
            found.setdefault(key, m.group(1))
    m = re.search(r"this\.platformVer=(\d+)", text)
    if m:
        found.setdefault("platform_ver", int(m.group(1)))
    m = _KEY_FN_RE.search(text)
    if m:
        found.setdefault("function", m.group(1))


def _subtitles(items: list[dict[str, Any]]) -> list[Subtitle]:
    """The site's subtitle list, French on by default when it has one.

    ``.txt``/``.txt1`` tracks carry per-cue ciphertext only the site's player
    decrypts; they are dropped rather than shown as gibberish.
    """
    tracks = [
        Subtitle(
            url=str(i["src"]),
            lang=str(i.get("land") or ""),
            label=str(i.get("label") or i.get("land") or ""),
            default=bool(i.get("default")),
        )
        for i in items
        if urlsplit(str(i.get("src") or "")).path.lower().endswith((".srt", ".vtt"))
    ]
    if any(t.lang == "fr" for t in tracks):
        for t in tracks:
            t.default = t.lang == "fr"
    return tracks
