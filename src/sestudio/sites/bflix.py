"""BFlix (bflixs.cx): films and series by TMDB id, streamed through vidnest.

bflixs.cx is only a TMDB front end: its player iframes third-party embeds keyed
by TMDB id. Of those, vidnest (vidnest.fun) is the one that resolves without a
browser, so titles come from TMDB and streams from vidnest's own API:
``GET new.vidnest.fun/<server>/movie/<id>`` (or ``/tv/<id>/<s>/<e>``) with a
random ``_n`` nonce answers ``{"v": 2, "n", "d"}``, where ``d`` is AES-GCM under
SHA-256(n + "|" + a constant from vidnest's JS bundle). refresh() re-reads that
constant, so a redeploy that rotates it heals on its own.

Every server carries the original audio only (English for most titles), so the
site is VOSTFR at best: French subtitles come from two aggregators, and many
titles have none.

Its catalogue is TMDB's, the same filters and shelves, but its cards open on
BFlix itself and only list titles already out.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from datetime import date
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from sestudio.catalogs import FilterField, TmdbCatalog, parallel
from sestudio.config import tmdb_key
from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import Episode, SeasonCard, StreamSource, Subtitle
from sestudio.providers.base import StreamProvider
from sestudio.sites.base import ContentSite, PageResult, SiteError, StreamCandidate

BASE = "https://bflixs.cx"
VIDNEST = "https://vidnest.fun"
API = "https://new.vidnest.fun"
TMDB = "https://api.themoviedb.org/3"
# The constant vidnest's bundle shipped when this was written; refresh() keeps it current.
DEFAULT_SECRET = "K3p8vQ2mX9rL5wZ0fN7bG1sH4tJ6dC9_y8S3wM1nQ5pL2"
# vidnest's backends that play without a browser, best first: flixhq goes up
# to 2160p. Its others are left out: Hindi audio (allmovies), Hindi-first MKV
# (vidzee), a nonce-gated relative URL (onehd), or a CDN that was dead when
# tested (yflix, rogflix, klikxxi, vidlink).
SERVERS = ("flixhq", "nextgencloudfabric", "rpmvid", "ophim")
# shortcut: only French and English subtitles are kept; widen if another
# language is ever wanted.
_SUB_LANGS = {"fr": "Français", "en": "English"}
_VDRK_LABELS = {"French": "fr", "English": "en"}
_SEARCH_SERIES = 8
_SEARCH_MOVIES = 10
_SECRET_RE = re.compile(r'"([A-Za-z0-9_-]{32,})",\w+="https://new\.vidnest\.fun"')
_CHUNK_RE = re.compile(r"/_next/static/chunks/[\w.-]+\.js")


def _nonce() -> str:
    return base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")


def _b64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def decrypt(payload: dict[str, Any], secret: str) -> Any:
    """The plaintext of a v2 vidnest answer; any other answer is already plain."""
    if payload.get("v") != 2 or not payload.get("d"):
        return payload
    blob = _b64(payload["d"])
    key = hashlib.sha256(f"{payload['n']}|{secret}".encode()).digest()
    text = AESGCM(key).decrypt(blob[:12], blob[12:], None).decode()
    try:
        return json.loads(text)
    except ValueError:
        return text


def _year(day: str | None) -> int:
    return int(day[:4]) if day and day[:4].isdigit() else 0


def _aired(day: str | None) -> bool:
    return bool(day) and day <= date.today().isoformat()


def _poster(path: str | None) -> str:
    return f"https://image.tmdb.org/t/p/w342{path}" if path else ""


def title_url(tmdb_id: int | str, kind: str, season: int = 0) -> str:
    url = f"{BASE}/details.html?id={tmdb_id}&type={kind}"
    return f"{url}&season={season}" if season else url


class BflixSite(ContentSite, TmdbCatalog):
    id = "bflix"
    display_name = "BFlix"
    home_url = f"{BASE}/home"
    label = "BFlix"
    description = "Films & series · original audio, French subtitles"

    def __init__(self) -> None:
        super().__init__()
        self._secret = DEFAULT_SECRET

    # --- Catalog --------------------------------------------------------------

    def schema(self, values: dict[str, str]) -> list[FilterField]:
        # Nothing unreleased plays, so there is no release filter to offer.
        return [f for f in super().schema(values) if f.key != "release"]

    def discover(self, values: dict[str, str], page: int) -> dict[str, Any]:
        return super().discover({**values, "release": "out"}, page)

    def _cards(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out = [r for r in results if _aired(r["release_date"])]
        cards = super()._cards(out)
        for c, r in zip(cards, out):
            film = r["kind"] == "movie"
            season = 0 if film else 1
            c["open"] = {
                "card": vars(
                    SeasonCard(
                        newsid=f"m{r['tmdb_id']}" if film else f"t{r['tmdb_id']}-1",
                        title=r["title"],
                        series_name=r["title"],
                        season_number=season,
                        poster_url=r["poster_url"],
                        page_url=title_url(r["tmdb_id"], r["kind"], season),
                        is_film=film,
                        year=r["year"],
                        source=self.id,
                    )
                )
            }
        return cards

    # --- HTTP ---------------------------------------------------------------

    def _tmdb(self, path: str, **params: Any) -> dict[str, Any]:
        if not tmdb_key():
            raise SiteError(
                "BFlix lists titles from TMDB: set a TMDB API key in Settings"
            )
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{TMDB}/{path}",
                    params={"api_key": tmdb_key(), "language": "fr-FR", **params},
                )
                resp.raise_for_status()
                return resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SiteError(f"bflix tmdb {path}: {exc}") from exc

    def _vidnest(self, path: str) -> Any:
        headers = {
            "User-Agent": BROWSER_UA,
            "Referer": f"{VIDNEST}/",
            "Origin": VIDNEST,
        }
        try:
            with new_client(headers=headers, timeout=25) as client:
                resp = client.get(f"{API}/{path}", params={"_n": _nonce()})
                resp.raise_for_status()
                payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SiteError(f"vidnest {path}: {exc}") from exc
        try:
            return decrypt(payload, self._secret)
        except InvalidTag:
            # The bundle's constant rotated: pick up the new one and retry once.
            self.refresh()
            try:
                return decrypt(payload, self._secret)
            except InvalidTag as exc:
                raise SiteError(f"vidnest {path}: cannot decrypt") from exc

    def refresh(self) -> None:
        with new_client(headers={"User-Agent": BROWSER_UA}) as client:
            page = client.get(f"{VIDNEST}/movie/550").text
            for chunk in dict.fromkeys(_CHUNK_RE.findall(page)):
                found = _SECRET_RE.search(client.get(f"{VIDNEST}{chunk}").text)
                if found:
                    self._secret = found.group(1)
                    return
        raise SiteError("vidnest: decryption constant not found in its bundle")

    # --- ContentSite ----------------------------------------------------------

    def provider_order(self) -> tuple[str, ...]:
        return SERVERS

    def owns_url(self, url: str) -> bool:
        return urlsplit(url).hostname == urlsplit(BASE).hostname

    def web_url(self, url: str) -> str:
        query = parse_qs(urlsplit(url).query)
        return title_url(query.get("id", [""])[0], query.get("type", ["movie"])[0])

    def _movie_card(self, r: dict[str, Any]) -> SeasonCard:
        title = r.get("title") or r.get("original_title") or ""
        return SeasonCard(
            newsid=f"m{r['id']}",
            title=title,
            series_name=title,
            season_number=0,
            poster_url=_poster(r.get("poster_path")),
            page_url=title_url(r["id"], "movie"),
            is_film=True,
            year=_year(r.get("release_date")),
            source=self.id,
        )

    def _season_cards(self, show: dict[str, Any]) -> list[SeasonCard]:
        name = show.get("name") or show.get("original_name") or ""
        seasons = [
            s
            for s in show.get("seasons") or []
            if s.get("season_number")
            and s.get("episode_count")
            and _aired(s.get("air_date"))
        ]
        return [
            SeasonCard(
                newsid=f"t{show['id']}-{s['season_number']}",
                title=name
                if len(seasons) == 1
                else f"{name} - Saison {s['season_number']}",
                series_name=name,
                season_number=s["season_number"],
                poster_url=_poster(s.get("poster_path") or show.get("poster_path")),
                page_url=title_url(show["id"], "tv", s["season_number"]),
                year=_year(show.get("first_air_date")),
                source=self.id,
            )
            for s in seasons
        ]

    def search(self, query: str) -> list[SeasonCard]:
        results = self._tmdb("search/multi", query=query).get("results") or []
        movies = [r for r in results if r.get("media_type") == "movie"][:_SEARCH_MOVIES]
        shows = [r for r in results if r.get("media_type") == "tv"][:_SEARCH_SERIES]
        # A show's seasons are only in its detail; TMDB's relevance order is kept.
        details = parallel([lambda i=s["id"]: self._tmdb(f"tv/{i}") for s in shows])
        seasons = {s["id"]: d for s, d in zip(shows, details) if d}
        cards: list[SeasonCard] = []
        for r in results:
            if r in movies and _aired(r.get("release_date")):
                cards.append(self._movie_card(r))
            elif r.get("id") in seasons and r.get("media_type") == "tv":
                cards += self._season_cards(seasons[r["id"]])
        return cards

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        query = parse_qs(urlsplit(url).query)
        tmdb_id = query.get("id", [""])[0]
        kind = query.get("type", [""])[0]
        if not tmdb_id.isdigit() or kind not in ("movie", "tv"):
            raise SiteError(f"Not a BFlix title URL: {url}")
        if kind == "movie":
            detail = self._tmdb(f"movie/{tmdb_id}")
            episode = Episode(
                number=1,
                title=detail.get("title") or tmdb_id,
                season=0,
                embed_urls={s: f"movie/{tmdb_id}" for s in SERVERS},
                # One version: the original audio, with French subtitles when found.
                langs=["vostfr"],
            )
            return PageResult(
                season=0, episodes=[episode], is_film=True, available_langs=["vostfr"]
            )
        season = int(query.get("season", ["1"])[0])
        listed = self._tmdb(f"tv/{tmdb_id}/season/{season}").get("episodes") or []
        episodes = [
            Episode(
                number=ep["episode_number"],
                title=ep.get("name") or f"Episode {ep['episode_number']}",
                season=season,
                embed_urls={
                    s: f"tv/{tmdb_id}/{season}/{ep['episode_number']}" for s in SERVERS
                },
                langs=["vostfr"],
            )
            for ep in listed
            if _aired(ep.get("air_date"))
        ]
        return PageResult(
            season=season, episodes=episodes, is_film=False, available_langs=["vostfr"]
        )

    def resolve_candidate(
        self,
        candidate: StreamCandidate,
        host_resolvers: dict[str, StreamProvider],
    ) -> StreamSource:
        if candidate.provider not in SERVERS:
            raise SiteError(f"No resolver for provider {candidate.provider!r}")
        got = self._vidnest(f"{candidate.provider}/{candidate.embed_url}")
        if not isinstance(got, dict):
            raise SiteError(f"{candidate.provider}: unexpected answer")
        streams = got.get("streams") if isinstance(got.get("streams"), list) else [got]
        # Relative URLs point back at vidnest's own proxy, which wants a nonce per request.
        stream = next(
            (s for s in streams if str(s.get("url") or "").startswith("http")), None
        )
        if stream is None:
            raise SiteError(
                f"{candidate.provider}: no stream for {candidate.embed_url}"
            )
        headers = stream.get("headers") or got.get("headers") or {}
        return StreamSource(
            url=stream["url"],
            referer=headers.get("Referer") or f"{VIDNEST}/",
            provider=candidate.provider,
            subtitles=self._subtitles(candidate.embed_url),
        )

    def _subtitles(self, path: str) -> list[Subtitle]:
        """French then English sidecars: vdrk's WebVTT first, then wyzie's
        SubRip for a language vdrk lacks. Best effort: none is not an error."""
        parts = path.split("/")
        wyzie_params = {"id": parts[1]}
        if parts[0] == "tv":
            wyzie_params.update(season=parts[2], episode=parts[3])

        def vdrk() -> list[Subtitle]:
            with new_client(headers={"User-Agent": BROWSER_UA}) as client:
                listed = client.get(f"https://sub.vdrk.site/v2/{path}").json()
            return [
                Subtitle(url=s["file"], lang=code, label=_SUB_LANGS[code])
                for s in listed
                if (code := _VDRK_LABELS.get(s.get("label") or "")) and s.get("file")
            ]

        def wyzie() -> list[Subtitle]:
            with new_client(headers={"User-Agent": BROWSER_UA}) as client:
                listed = client.get(
                    "https://vidcore.io/wyzie", params=wyzie_params
                ).json()
            # The same order vidcore's player uses: hearing-impaired tracks last.
            listed.sort(key=lambda s: bool(s.get("isHearingImpaired")))
            return [
                Subtitle(
                    url=f"{s['url']}#srt",
                    lang=s["language"],
                    label=_SUB_LANGS[s["language"]],
                )
                for s in listed
                if s.get("language") in _SUB_LANGS and s.get("url")
            ]

        found = [s for got in parallel([vdrk, wyzie]) for s in got or []]
        kept = list({s.lang: s for s in reversed(found)}.values())  # first per language
        kept.sort(key=lambda s: s.lang != "fr")
        for sub in kept:
            # The original audio needs the French track on.
            sub.default = sub.lang == "fr"
        return kept
