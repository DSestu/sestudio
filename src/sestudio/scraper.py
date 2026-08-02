from __future__ import annotations

import logging
import re

import httpx
from bs4 import BeautifulSoup

from sestudio.http_client import new_client
from sestudio.models import Episode, SeasonCard

logger = logging.getLogger(__name__)

HEADERS: dict[str, str] = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
    # fstream fronts every page with a JS "Verification..." interstitial that just
    # sets this cookie client-side and reloads; sending it up front skips the
    # challenge and returns the real content. (Harmless to the anime domain.)
    "Cookie": "fsschal=1",
}

SEASON_RE = re.compile(r"[Ss]aison\s+(\d+)", re.IGNORECASE)


_ONCLICK_RE = re.compile(r"location\.href='([^']+)'")
_NEWSID_RE = re.compile(r"/(\d+)-")
_YEAR_RE = re.compile(r"\s*\((\d{4})\)\s*$")


def _search_one(
    query: str, base_url: str, *, is_anime: bool = False
) -> list[SeasonCard]:
    """Search a single domain and return SeasonCard list."""
    with new_client(headers=HEADERS) as client:
        # Resolve the final URL (some domains redirect to a versioned subdomain)
        head = client.get(base_url)
        resolved_origin = "/".join(str(head.url).split("/")[:3])

        search_url = f"{resolved_origin}/engine/ajax/search.php"
        logger.debug("Searching: POST %s query=%r", search_url, query)
        resp = client.post(
            search_url,
            data={
                "query": query,
                "search_start": "0",
                "full_search": "0",
                "result_from": "1",
            },
            headers={
                "Referer": f"{resolved_origin}/",
                "Origin": resolved_origin,
                "X-Requested-With": "XMLHttpRequest",
            },
        )
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    cards: list[SeasonCard] = []

    for item in soup.find_all("div", class_="search-item"):
        onclick: str = item.get("onclick", "")
        m_url = _ONCLICK_RE.search(onclick)
        if not m_url:
            continue
        rel_url = m_url.group(1)
        if rel_url.startswith("http"):
            page_url = rel_url
        else:
            page_url = f"{resolved_origin}{rel_url}"

        m_id = _NEWSID_RE.search(rel_url)
        newsid = m_id.group(1) if m_id else ""

        img = item.find("img")
        poster_url: str = img["src"] if img else ""  # type: ignore[index]

        title_el = item.find("div", class_="search-title")
        raw_title: str = title_el.get_text(strip=True) if title_el else ""
        # The trailing "(2019)" is stripped from the display title, but kept —
        # it disambiguates remakes when matching against metadata providers.
        m_year = _YEAR_RE.search(raw_title)
        year = int(m_year.group(1)) if m_year else 0
        title = _YEAR_RE.sub("", raw_title).strip()

        m_season = SEASON_RE.search(title)
        season_number = int(m_season.group(1)) if m_season else 0
        series_name = (
            SEASON_RE.split(title)[0].rstrip(" -").strip() if m_season else title
        )
        is_film = not bool(m_season) and not is_anime

        cards.append(
            SeasonCard(
                newsid=newsid,
                title=title,
                series_name=series_name,
                season_number=season_number,
                poster_url=poster_url,
                page_url=page_url,
                is_film=is_film,
                is_anime=is_anime,
                year=year,
            )
        )

    logger.debug(
        "Search returned %d cards for %r (anime=%s)", len(cards), query, is_anime
    )
    return cards


def search_seasons(
    query: str, base_url: str, anime_domain: str | None = None
) -> list[SeasonCard]:
    """Search fstream (and optionally the anime domain) for content matching *query*."""
    cards = _search_one(query, base_url, is_anime=False)
    if anime_domain:
        try:
            cards += _search_one(query, anime_domain, is_anime=True)
        except Exception as exc:
            logger.warning("Anime search failed for %r: %s", query, exc)
    return cards


def fetch_season(url: str, lang: str = "vf") -> tuple[int, list[Episode]]:
    """Fetch a season page and return (season_number, episodes) for the given language."""
    logger.debug("Fetching season page: %s (lang=%s)", url, lang)
    with new_client(headers=HEADERS) as client:
        page_resp = client.get(url)
        page_resp.raise_for_status()

        soup = BeautifulSoup(page_resp.text, "html.parser")
        # Parse the news ID first: its absence (no #serie-config) is what marks a
        # film. The season number is optional — some series (e.g. sketch shows)
        # have no "Saison N" in their title yet still expose full episode data.
        news_id = _parse_news_id(soup)
        season = _parse_season_number(soup)

        base_url = str(page_resp.url)
        base_origin = "/".join(base_url.split("/")[:3])
        eps_url = f"{base_origin}/data/eps_{news_id}.txt"

        logger.debug("Fetching episode data: %s", eps_url)
        eps_resp = client.get(eps_url, headers={"Referer": url})
        if eps_resp.status_code == 404:
            manga_url = f"{base_origin}/engine/ajax/manga_episodes_api.php?id={news_id}"
            logger.debug("eps txt 404, trying manga API: %s", manga_url)
            eps_resp = client.get(
                manga_url,
                headers={"Referer": url, "X-Requested-With": "XMLHttpRequest"},
            )
        eps_resp.raise_for_status()

    data: dict[str, dict[str, object]] = eps_resp.json()
    lang_data: dict[str, dict[str, str]] = data.get(lang, {})  # type: ignore[assignment]
    info_data: dict[str, object] = data.get("info", {})  # type: ignore[assignment]

    episodes: list[Episode] = []
    for key, providers in lang_data.items():
        num = int(key)
        info = info_data.get(str(key), {})
        title: str | None = info.get("title") if isinstance(info, dict) else None  # type: ignore[union-attr]
        title = title or f"Episode {num}"
        ep = Episode(
            number=num,
            title=title,
            season=season,
            embed_urls={k: v for k, v in providers.items() if v},
        )
        episodes.append(ep)

    episodes.sort(key=lambda e: e.number)
    logger.debug("Found %d episodes for season %d (%s)", len(episodes), season, lang)
    return season, episodes


_EMBED_PROVIDERS_RE = re.compile(
    r"uqload|vidzy|netu|byse|luluvid|premium|voe", re.IGNORECASE
)
_TITLE_SUFFIX_RE = re.compile(
    r"\s+[-–|]\s+.*$"
)  # space-dash-space avoids breaking hyphenated titles
_FILM_PREFIX_RE = re.compile(r"^(?:Film|Movie)\s+", re.IGNORECASE)

# Supported providers and their lang key in the film API response
_FILM_PROVIDERS = ("uqload", "vidzy", "premium", "netu", "luluvid")
_FILM_LANG_KEY: dict[str, str] = {
    "vf": "vfq",
    "vfq": "vfq",
    "vostfr": "vostfr",
    "vo": "vostfr",
}


def _fetch_film_api(
    client: httpx.Client, base_origin: str, news_id: str, referer: str, lang: str
) -> tuple[dict[str, str], list[str]]:
    """Call /engine/ajax/film_api.php and return (embed_urls, available_langs)."""
    api_url = f"{base_origin}/engine/ajax/film_api.php?id={news_id}"
    logger.debug("Fetching film API: %s", api_url)
    resp = client.get(
        api_url, headers={"Referer": referer, "X-Requested-With": "XMLHttpRequest"}
    )
    resp.raise_for_status()
    data: dict[str, object] = resp.json()
    if data.get("error"):
        raise ValueError(f"Film API error: {data['error']}")

    players: dict[str, dict[str, str]] = data.get("players", {})  # type: ignore[assignment]
    lang_key = _FILM_LANG_KEY.get(lang.lower(), "vfq")

    embed_urls: dict[str, str] = {}
    for provider in _FILM_PROVIDERS:
        variants = players.get(provider, {})
        url = variants.get(lang_key) or variants.get("default") or ""
        if url:
            embed_urls[provider] = url

    # Detect available languages from which lang_keys are non-empty across all providers
    available: set[str] = set()
    for variants in players.values():
        if variants.get("vfq") or variants.get("vff"):
            available.add("vf")
        if variants.get("vostfr"):
            available.add("vostfr")
    if not available and players:
        available.add("vf")

    logger.debug(
        "Film API embed_urls: %s, langs: %s", list(embed_urls), sorted(available)
    )
    return embed_urls, sorted(available)


def fetch_page(url: str, lang: str = "vf") -> tuple[int, list[Episode], bool]:
    """Fetch either a series season or a film page. Returns (season, episodes, is_film)."""
    try:
        season, episodes = fetch_season(url, lang)
        return season, episodes, False
    except ValueError:
        film_title, episodes = fetch_film(url, lang)
        return 0, episodes, True


def fetch_film(url: str, lang: str = "vf") -> tuple[str, list[Episode]]:
    """Fetch a film page (no #serie-config). Returns (film_title, [single Episode])."""
    logger.debug("Fetching film page: %s (lang=%s)", url, lang)

    m_id = _NEWSID_RE.search(url)
    if not m_id:
        raise ValueError(f"Cannot extract news ID from film URL: {url}")
    news_id = m_id.group(1)

    with new_client(headers=HEADERS) as client:
        page_resp = client.get(url)
        page_resp.raise_for_status()
        soup = BeautifulSoup(page_resp.text, "html.parser")

        # Extract title from <title> tag, stripping site suffix
        raw_page_title = soup.title.string if soup.title else ""
        film_title = _TITLE_SUFFIX_RE.sub("", raw_page_title).strip()
        film_title = _FILM_PREFIX_RE.sub("", film_title).strip() or f"film_{news_id}"

        base_origin = "/".join(str(page_resp.url).split("/")[:3])

        # Primary: call the film API endpoint
        embed_urls: dict[str, str] = {}
        available_langs: list[str] = []
        try:
            embed_urls, available_langs = _fetch_film_api(
                client, base_origin, news_id, url, lang
            )
        except Exception as exc:
            logger.warning(
                "Film API unavailable for %s: %s — trying fallbacks", news_id, exc
            )

        # Fallback: scrape iframes (src and data-src)
        if not embed_urls:
            logger.debug("Falling back to iframe scraping for film %s", url)
            for iframe in soup.find_all("iframe"):
                src: str = iframe.get("src") or iframe.get("data-src") or ""
                if src and _EMBED_PROVIDERS_RE.search(src):
                    pname = next(
                        (
                            p
                            for p in ("uqload", "vidzy", "netu", "luluvid")
                            if p in src.lower()
                        ),
                        "unknown",
                    )
                    embed_urls[pname] = src

        if not embed_urls:
            logger.warning("No embed URLs found for film %s", url)

    episode = Episode(
        number=1,
        title=film_title,
        season=0,
        embed_urls=embed_urls,
    )
    return film_title, [episode]


def _fetch_film_available_langs(url: str) -> list[str]:
    """Return language keys for a film page."""
    m_id = _NEWSID_RE.search(url)
    if not m_id:
        return []
    news_id = m_id.group(1)
    with new_client(headers=HEADERS) as client:
        resp = client.get(url, follow_redirects=True)
        base_origin = "/".join(str(resp.url).split("/")[:3])
        try:
            _, available = _fetch_film_api(client, base_origin, news_id, url, "vf")
            return available
        except Exception:
            return []


def _parse_season_number(soup: BeautifulSoup) -> int:
    """Return the season number, or 0 when the page carries no "Saison N" label.

    A series without a season number (e.g. a sketch show) is still a valid
    series; only a missing #serie-config (handled by _parse_news_id) marks a film.
    """
    config = soup.find(id="serie-config")
    if config:
        title: str = config.get("data-title", "")  # type: ignore[assignment]
        m = SEASON_RE.search(title)
        if m:
            return int(m.group(1))

    page_title = soup.title.string if soup.title else ""
    m = SEASON_RE.search(page_title or "")
    if m:
        return int(m.group(1))

    return 0


def _parse_news_id(soup: BeautifulSoup) -> str:
    config = soup.find(id="serie-config")
    if config:
        news_id: str | None = config.get("data-news-id")  # type: ignore[assignment]
        if news_id:
            return news_id
    raise ValueError("Could not find news ID in page (missing #serie-config)")
