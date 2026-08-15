"""Senpai Stream — a Laravel/Livewire site that hosts its own video files.

Unlike the DLE sites, senpai embeds no third-party host: a title's stream is a
pre-signed mp4 on its own object storage, obtained by calling the page's
Livewire ``getVideoLink`` action. So this site overrides ``resolve_candidate``
and never touches the shared host-resolver registry.
"""

from __future__ import annotations

import html as html_mod
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

from sestudio.http_client import new_client
from sestudio.models import Episode, SeasonCard, StreamSource
from sestudio.providers.base import StreamProvider
from sestudio.sites.base import ContentSite, PageResult, SiteError, StreamCandidate

logger = logging.getLogger(__name__)

ENTRYPOINT = "https://senpai-stream.wiki"

# How long a resolved domain is trusted before the next use re-checks it. The
# app's periodic refresh normally gets there first; this is the backstop for
# the CLI and for gaps between ticks.
DOMAIN_TTL = 900.0

# The site rotates its TLD (.live today), so anything under the brand is ours.
_BRAND = "senpai-stream"

_SEASON_BTN_RE = re.compile(r"updateSeason\(\s*'(\d+)'\s*\)")
_SAISON_RE = re.compile(r"Saison\s+(\d+)", re.IGNORECASE)
_EPISODE_PATH_RE = re.compile(r"/episode/([^/]+)/(\d+)-(\d+)")
_YEAR_RE = re.compile(r"^\s*(\d{4})\s*$")
# The embed page carries the signed file URL; it is HTML-escaped in the markup.
_MP4_RE = re.compile(r"https?://[^\"'\s]+\.mp4[^\"'\s]*")

# How many series pages to expand concurrently during a search. Bounded so a
# broad query cannot fan out into dozens of simultaneous requests.
_SEASON_WORKERS = 5


def _unwrap(value: Any) -> Any:
    """Strip Livewire's ``[payload, {"s": "arr"}]`` array wrappers."""
    if (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[1], dict)
        and "s" in value[1]
    ):
        return _unwrap(value[0])
    if isinstance(value, list):
        return [_unwrap(v) for v in value]
    return value


def _lang_of_label(label: str) -> str | None:
    """Map a site version label onto the app's language codes."""
    low = label.casefold()
    if "sous-titr" in low:
        return "vostfr"
    if "française" in low or "francaise" in low:
        return "vf"
    if "originale" in low:
        return "vo"
    return None


# A requested language maps to an ordered list of acceptable site versions, so a
# title carrying only VOSTFR still plays when "vo" was asked for.
_LANG_FALLBACKS: dict[str, tuple[str, ...]] = {
    "vf": ("vf",),
    "vostfr": ("vostfr", "vo"),
    "vo": ("vo", "vostfr"),
}


class SenpaiSite(ContentSite):
    id = "senpai"
    display_name = "Senpai Stream"

    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = base_url.rstrip("/") if base_url else None
        # An explicitly given domain is the caller's choice to keep.
        self._pinned = self._base_url is not None
        self._resolved_at = 0.0
        self._lock = threading.Lock()

    # --- domain ------------------------------------------------------------

    def base_url(self) -> str:
        """The live domain, re-resolved from the entrypoint when it goes stale.

        The site moves to a new TLD often enough that a value cached for the
        life of the process goes wrong on a long-running server. The app also
        refreshes this on startup and on a timer (see web/app.py); the TTL here
        is what covers the CLI and any window between those ticks.

        A pinned domain (passed to the constructor, as tests do) is never
        re-resolved.
        """
        with self._lock:
            if self._base_url and (self._pinned or not self._is_stale()):
                return self._base_url
            try:
                resolved = self._resolve_domain()
            except SiteError:
                # Keep serving the previous domain if the entrypoint is down —
                # a stale guess beats no site at all.
                if self._base_url:
                    logger.warning(
                        "senpai domain refresh failed; keeping %s", self._base_url
                    )
                    self._resolved_at = time.monotonic()
                    return self._base_url
                raise
            if resolved != self._base_url:
                logger.info("senpai domain is now %s", resolved)
            self._base_url = resolved
            self._resolved_at = time.monotonic()
            return self._base_url

    def _is_stale(self) -> bool:
        return time.monotonic() - self._resolved_at >= DOMAIN_TTL

    def refresh(self) -> None:
        """Force a re-resolve now, regardless of the TTL."""
        if self._pinned:
            return
        with self._lock:
            # -inf, not 0.0: time.monotonic() starts near zero on a freshly
            # booted host, where "resolved at 0.0" would still be within the
            # TTL and the forced refresh would silently do nothing.
            self._resolved_at = float("-inf")
        self.base_url()

    def _resolve_domain(self) -> str:
        """Find the live mirror behind the entrypoint.

        The entrypoint has taken two shapes: a small landing page linking to
        the current mirror, and (since Aug 2026) a straight redirect onto the
        mirror itself. Both are handled — a redirect away from the entrypoint
        host is the answer, otherwise the page is scanned for the link.
        """
        try:
            with new_client() as client:
                resp = client.get(ENTRYPOINT)
                resp.raise_for_status()
        except Exception as exc:
            raise SiteError(f"senpai entrypoint unreachable: {exc}") from exc

        entry_host = urlsplit(ENTRYPOINT).hostname or ""
        final_host = urlsplit(str(resp.url)).hostname or ""
        if final_host and final_host != entry_host and _BRAND in final_host:
            return f"https://{final_host}"

        soup = BeautifulSoup(resp.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = str(anchor["href"])
            if not href.startswith("https://"):
                continue
            host = urlsplit(href).hostname or ""
            if host and host not in (entry_host, final_host) and _BRAND in host:
                return f"https://{host}"
        raise SiteError("senpai entrypoint carried no live domain link")

    def owns_url(self, url: str) -> bool:
        return _BRAND in (urlsplit(url).hostname or "")

    def _rebase(self, url: str) -> str:
        """Move a senpai URL onto the domain that is live right now.

        Library entries, deep links and download jobs keep whatever domain was
        current when they were stored. Once the site rotates, that host is
        dead, so re-hosting every senpai URL before use is what keeps saved
        titles playable across a rotation — the paths themselves are stable.
        """
        split = urlsplit(url)
        if not split.hostname or _BRAND not in split.hostname:
            return url
        base = urlsplit(self.base_url())
        if split.netloc == base.netloc:
            return url
        logger.debug("Rebasing senpai URL from %s to %s", split.netloc, base.netloc)
        return urlunsplit(
            (base.scheme, base.netloc, split.path, split.query, split.fragment)
        )

    def provider_order(self) -> tuple[str, ...]:
        return (self.id,)

    # --- search ------------------------------------------------------------

    def search(self, query: str) -> list[SeasonCard]:
        base = self.base_url()
        url = f"{base}/search/{quote(query)}"
        try:
            with new_client() as client:
                resp = client.get(url)
                resp.raise_for_status()
                page = resp.text
        except Exception as exc:
            raise SiteError(f"senpai search failed: {exc}") from exc

        films: list[SeasonCard] = []
        shows: list[dict[str, Any]] = []
        for hit in self._parse_cards(page, base):
            if hit["is_film"]:
                films.append(self._film_card(hit))
            else:
                shows.append(hit)

        # One card per season, so multi-season series are fully reachable. Each
        # needs its series page for the season tabs; fetched concurrently.
        cards = list(films)
        if shows:
            with ThreadPoolExecutor(max_workers=_SEASON_WORKERS) as pool:
                for season_cards in pool.map(self._season_cards, shows):
                    cards.extend(season_cards)
        return cards

    def _parse_cards(self, page: str, base: str) -> list[dict[str, Any]]:
        """Extract one entry per result card on a search page."""
        soup = BeautifulSoup(page, "html.parser")
        seen: set[str] = set()
        hits: list[dict[str, Any]] = []

        for anchor in soup.find_all("a", href=True):
            href = str(anchor["href"])
            path = urlsplit(href).path
            parts = [p for p in path.split("/") if p]
            if len(parts) != 2 or parts[0] not in ("movie", "tv-show"):
                continue
            if href in seen:
                continue
            seen.add(href)

            card = anchor.find_parent("div")
            title = ""
            year = 0
            genres: list[str] = []
            if card is not None:
                heading = card.find("h3")
                if heading:
                    title = heading.get_text(strip=True)
                for span in card.find_all("span"):
                    text = span.get_text(strip=True)
                    m_year = _YEAR_RE.match(text)
                    if m_year and not year:
                        year = int(m_year.group(1))
                    elif text and not m_year and " " not in text.strip():
                        genres.append(text)
            img = anchor.find("img")
            if not title and img:
                title = str(img.get("alt") or "")
            poster = ""
            if img:
                poster = str(img.get("data-src") or img.get("src") or "")
                if poster.startswith("data:"):
                    poster = ""

            slug = parts[1]
            hits.append(
                {
                    "url": href if href.startswith("http") else f"{base}{path}",
                    "slug": slug,
                    "title": _clean_text(title) or slug.replace("-", " "),
                    "year": year,
                    "poster": poster,
                    "is_film": parts[0] == "movie",
                    "is_anime": any(g.casefold() == "animation" for g in genres),
                }
            )
        return hits

    def _film_card(self, hit: dict[str, Any]) -> SeasonCard:
        return SeasonCard(
            newsid=hit["slug"],
            title=hit["title"],
            series_name=hit["title"],
            season_number=0,
            poster_url=hit["poster"],
            page_url=hit["url"],
            is_film=True,
            is_anime=hit["is_anime"],
            year=hit["year"],
            source=self.id,
        )

    def _season_cards(self, hit: dict[str, Any]) -> list[SeasonCard]:
        """Expand a series hit into one card per season."""
        try:
            with new_client() as client:
                resp = client.get(hit["url"])
                resp.raise_for_status()
            seasons = _parse_seasons(resp.text)
        except Exception as exc:
            # A series whose page failed still deserves to appear; fall back to
            # a single season-1 card rather than dropping the title entirely.
            logger.warning("senpai season lookup failed for %s: %s", hit["url"], exc)
            seasons = [(1, "")]

        cards: list[SeasonCard] = []
        for number, season_id in seasons:
            params = f"?sn={number}" + (f"&sid={season_id}" if season_id else "")
            cards.append(
                SeasonCard(
                    newsid=f"{hit['slug']}-s{number}",
                    title=f"{hit['title']} - Saison {number}",
                    series_name=hit["title"],
                    season_number=number,
                    poster_url=hit["poster"],
                    page_url=f"{hit['url']}{params}",
                    is_film=False,
                    is_anime=hit["is_anime"],
                    year=hit["year"],
                    source=self.id,
                )
            )
        return cards

    # --- title pages -------------------------------------------------------

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        url = self._rebase(url)
        split = urlsplit(url)
        parts = [p for p in split.path.split("/") if p]
        kind = parts[0] if parts else ""
        if kind == "movie":
            return self._fetch_movie(url, lang)
        if kind == "tv-show":
            return self._fetch_season(url, lang)
        raise SiteError(f"Unsupported senpai page: {url}")

    def _fetch_movie(self, url: str, lang: str) -> PageResult:
        page = self._get(url)
        _, data = _watch_snapshot(page)
        videos = _unwrap(data.get("videos") or [])
        soup = BeautifulSoup(page, "html.parser")
        heading = soup.find("h1")
        title = heading.get_text(strip=True) if heading else ""
        if not title:
            og = soup.find("meta", property="og:title")
            title = str(og.get("content", "")) if og else ""
        title = title or url.rstrip("/").split("/")[-1].replace("-", " ")

        langs = _available_langs(videos)
        episode = Episode(
            number=1,
            title=_clean_text(title),
            season=0,
            embed_urls={self.id: f"{url}#lang={lang}"},
        )
        _retarget_lang([episode], self.id, lang, langs)
        return PageResult(
            season=0,
            episodes=[episode],
            is_film=True,
            available_langs=langs,
        )

    def _fetch_season(self, url: str, lang: str) -> PageResult:
        split = urlsplit(url)
        params = parse_qs(split.query)
        season = int(params.get("sn", ["1"])[0] or 1)
        season_id = (params.get("sid", [""])[0] or "").strip()
        show_url = f"{split.scheme}://{split.netloc}{split.path}"
        slug = [p for p in split.path.split("/") if p][-1]

        with new_client() as client:
            page = self._get(show_url, client=client)
            markup = page
            # Season 1 is rendered inline; any other season is behind a
            # Livewire action on the season component.
            if season_id and not _has_season(page, season):
                raw, _ = _snapshot_named(page, "season-component")
                effects = self._livewire(
                    client,
                    show_url,
                    raw,
                    "updateSeason",
                    [season_id],
                    _csrf_token(page),
                )
                markup = effects.get("html", "") or page

        episodes = _parse_episodes(markup, slug, season, self.id, lang)
        if not episodes:
            raise SiteError(f"No episodes found for senpai season {season} of {slug}")

        # Versions are per-episode on this site; probe the first one and treat
        # the season as uniform rather than fetching every episode page.
        langs: list[str] = []
        try:
            first = episodes[0].embed_urls[self.id].split("#")[0]
            _, data = _watch_snapshot(self._get(first))
            langs = _available_langs(_unwrap(data.get("videos") or []))
        except Exception as exc:
            logger.warning("senpai language probe failed for %s: %s", slug, exc)

        _retarget_lang(episodes, self.id, lang, langs)
        return PageResult(
            season=season,
            episodes=episodes,
            is_film=False,
            available_langs=langs,
        )

    # --- stream resolution -------------------------------------------------

    def resolve_candidate(
        self,
        candidate: StreamCandidate,
        host_resolvers: dict[str, StreamProvider],
    ) -> StreamSource:
        """Turn a page URL into the site's own pre-signed mp4.

        ``host_resolvers`` is unused: senpai serves its own files, so there is
        no third-party embed to hand off to a shared provider.
        """
        if candidate.provider != self.id:
            raise SiteError(f"senpai cannot resolve provider {candidate.provider!r}")

        page_url, _, fragment = candidate.embed_url.partition("#")
        page_url = self._rebase(page_url)
        lang = parse_qs(fragment).get("lang", ["vf"])[0]

        with new_client() as client:
            page = self._get(page_url, client=client)
            raw, data = _watch_snapshot(page)
            videos = _unwrap(data.get("videos") or [])
            index = _lang_index(videos, lang)
            if index is None:
                raise SiteError(f"senpai has no {lang} version of {page_url}")

            effects = self._livewire(
                client, page_url, raw, "getVideoLink", [index], _csrf_token(page)
            )
            returns = effects.get("returns") or []
            embed_url = returns[0] if returns else None
            if not embed_url:
                # The site gates this action behind a CAPTCHA for some titles;
                # there is nothing to fall back to when it declines.
                raise SiteError(f"senpai returned no video link for {page_url}")

            embed = self._get(str(embed_url), client=client, referer=page_url)

        match = _MP4_RE.search(embed)
        if not match:
            raise SiteError(f"No media URL in senpai embed for {page_url}")

        base = self.base_url()
        return StreamSource(
            url=html_mod.unescape(match.group(0)),
            referer=f"{base}/",
            provider=self.id,
        )

    # --- http helpers ------------------------------------------------------

    def _get(
        self, url: str, *, client: httpx.Client | None = None, referer: str = ""
    ) -> str:
        headers = {"Referer": referer} if referer else {}
        try:
            if client is not None:
                resp = client.get(url, headers=headers)
            else:
                with new_client() as own:
                    resp = own.get(url, headers=headers)
            resp.raise_for_status()
            return resp.text
        except Exception as exc:
            raise SiteError(f"senpai request failed ({url}): {exc}") from exc

    def _livewire(
        self,
        client: httpx.Client,
        page_url: str,
        snapshot: str,
        method: str,
        params: list[Any],
        token: str,
    ) -> dict[str, Any]:
        """Call a Livewire component action and return its effects.

        The snapshot is echoed back verbatim: it carries a server-side checksum
        that any reserialisation risks invalidating. ``client`` must already
        have loaded the page, so it holds the session cookie the token is
        bound to — posting without it is rejected with HTTP 419.
        """
        split = urlsplit(page_url)
        origin = f"{split.scheme}://{split.netloc}"
        body = {
            "_token": token,
            "components": [
                {
                    "snapshot": snapshot,
                    "updates": {},
                    "calls": [{"path": "", "method": method, "params": params}],
                }
            ],
        }
        try:
            resp = client.post(
                f"{origin}/livewire/update",
                json=body,
                headers={
                    "X-Livewire": "1",
                    "X-CSRF-TOKEN": token,
                    "Referer": page_url,
                    "Origin": origin,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            raise SiteError(f"senpai {method} call failed: {exc}") from exc

        components = payload.get("components") or []
        if not components:
            raise SiteError(f"senpai {method} returned no component")
        return components[0].get("effects") or {}


# --- module-level parsing helpers (pure, so they are cheap to test) ---------


def _clean_text(text: str) -> str:
    """Collapse the non-breaking spaces the site's titles are littered with."""
    return " ".join(text.replace("\xa0", " ").split())


def _retarget_lang(
    episodes: list[Episode], provider: str, lang: str, available: list[str]
) -> None:
    """Point embeds at a language the title actually has.

    ``fetch_page`` is asked for a language before the versions are known; when
    the answer comes back and the request is unsatisfiable, fall back rather
    than handing out embeds that can only fail at resolve time.
    """
    if not available or lang.casefold() in available:
        return
    for candidate in _LANG_FALLBACKS.get(lang.casefold(), ()):
        if candidate in available:
            replacement = candidate
            break
    else:
        replacement = available[0]
    for episode in episodes:
        url = episode.embed_urls.get(provider)
        if url:
            episode.embed_urls[provider] = f"{url.split('#')[0]}#lang={replacement}"


def _csrf_token(page: str) -> str:
    match = re.search(r'name="csrf-token"\s+content="([^"]+)"', page)
    if not match:
        raise SiteError("No CSRF token on senpai page")
    return match.group(1)


def _snapshot_named(page: str, name: str) -> tuple[str, dict[str, Any]]:
    """Return (raw snapshot string, parsed) for the named Livewire component."""
    for match in re.finditer(r'wire:snapshot="([^"]*)"', page):
        raw = html_mod.unescape(match.group(1))
        try:
            parsed = json.loads(raw)
        except ValueError:
            continue
        if parsed.get("memo", {}).get("name") == name:
            return raw, parsed
    raise SiteError(f"No {name} on senpai page")


def _watch_snapshot(page: str) -> tuple[str, dict[str, Any]]:
    raw, parsed = _snapshot_named(page, "watch-component")
    return raw, parsed.get("data", {})


def _available_langs(videos: list[dict[str, Any]]) -> list[str]:
    langs = {
        lang
        for video in videos
        if (lang := _lang_of_label(str(video.get("label", ""))))
    }
    return sorted(langs)


def _lang_index(videos: list[dict[str, Any]], lang: str) -> int | None:
    """Index into the site's version list for a requested language."""
    by_lang: dict[str, int] = {}
    for position, video in enumerate(videos):
        code = _lang_of_label(str(video.get("label", "")))
        if code and code not in by_lang:
            index = video.get("index")
            by_lang[code] = int(index) if isinstance(index, int) else position
    for candidate in _LANG_FALLBACKS.get(lang.casefold(), (lang.casefold(),)):
        if candidate in by_lang:
            return by_lang[candidate]
    return None


def _parse_seasons(page: str) -> list[tuple[int, str]]:
    """Season tabs as (season number, season id), in page order."""
    soup = BeautifulSoup(page, "html.parser")
    seasons: list[tuple[int, str]] = []
    seen: set[int] = set()
    for button in soup.find_all(attrs={"wire:click": True}):
        match = _SEASON_BTN_RE.search(str(button["wire:click"]))
        if not match:
            continue
        label = button.get_text(strip=True)
        m_num = _SAISON_RE.search(label)
        number = int(m_num.group(1)) if m_num else len(seasons) + 1
        if number in seen:
            continue
        seen.add(number)
        seasons.append((number, match.group(1)))
    return seasons or [(1, "")]


def _has_season(page: str, season: int) -> bool:
    """Whether the markup already lists episodes for this season."""
    return any(int(m.group(2)) == season for m in _EPISODE_PATH_RE.finditer(page))


def _parse_episodes(
    markup: str, slug: str, season: int, provider: str, lang: str
) -> list[Episode]:
    soup = BeautifulSoup(markup, "html.parser")
    episodes: list[Episode] = []
    seen: set[int] = set()

    for anchor in soup.find_all("a", href=True):
        match = _EPISODE_PATH_RE.search(str(anchor["href"]))
        if not match or match.group(1) != slug or int(match.group(2)) != season:
            continue
        number = int(match.group(3))
        if number in seen:
            continue
        seen.add(number)

        title = ""
        card = anchor.find_parent("div")
        if card is not None:
            heading = card.find("h3")
            if heading:
                title = heading.get_text(strip=True)
        episodes.append(
            Episode(
                number=number,
                title=_clean_text(title) or f"Episode {number}",
                season=season,
                embed_urls={provider: f"{str(anchor['href'])}#lang={lang}"},
            )
        )

    episodes.sort(key=lambda e: e.number)
    return episodes
