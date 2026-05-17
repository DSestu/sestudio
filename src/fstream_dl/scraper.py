from __future__ import annotations

import logging
import re

import httpx
from bs4 import BeautifulSoup

from fstream_dl.models import Episode, SeasonCard

logger = logging.getLogger(__name__)

HEADERS: dict[str, str] = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

SEASON_RE = re.compile(r"[Ss]aison\s+(\d+)", re.IGNORECASE)


_ONCLICK_RE = re.compile(r"location\.href='([^']+)'")
_NEWSID_RE = re.compile(r"/(\d+)-")
_YEAR_RE = re.compile(r"\s*\(\d{4}\)\s*$")


def search_seasons(query: str, base_url: str) -> list[SeasonCard]:
    """Search fstream for content matching *query* via the AJAX endpoint."""
    search_url = f"{base_url}/engine/ajax/search.php"
    logger.debug("Searching: POST %s query=%r", search_url, query)
    with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        resp = client.post(
            search_url,
            data={"query": query, "search_start": "0", "full_search": "0", "result_from": "1"},
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
        page_url = f"{base_url}{rel_url}"

        m_id = _NEWSID_RE.search(rel_url)
        newsid = m_id.group(1) if m_id else ""

        img = item.find("img")
        poster_url: str = img["src"] if img else ""  # type: ignore[index]

        title_el = item.find("div", class_="search-title")
        raw_title: str = title_el.get_text(strip=True) if title_el else ""
        title = _YEAR_RE.sub("", raw_title).strip()

        m_season = SEASON_RE.search(title)
        season_number = int(m_season.group(1)) if m_season else 0
        series_name = SEASON_RE.split(title)[0].rstrip(" -").strip() if m_season else title
        is_film = not bool(m_season)

        cards.append(SeasonCard(
            newsid=newsid,
            title=title,
            series_name=series_name,
            season_number=season_number,
            poster_url=poster_url,
            page_url=page_url,
            is_film=is_film,
        ))

    logger.debug("Search returned %d cards for %r", len(cards), query)
    return cards


def fetch_season(url: str, lang: str = "vf") -> tuple[int, list[Episode]]:
    """Fetch a season page and return (season_number, episodes) for the given language."""
    logger.debug("Fetching season page: %s (lang=%s)", url, lang)
    with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        page_resp = client.get(url)
        page_resp.raise_for_status()

        soup = BeautifulSoup(page_resp.text, "html.parser")
        season = _parse_season_number(soup)
        news_id = _parse_news_id(soup)

        base_url = str(page_resp.url)
        base_origin = "/".join(base_url.split("/")[:3])
        eps_url = f"{base_origin}/data/eps_{news_id}.txt"

        logger.debug("Fetching episode data: %s", eps_url)
        eps_resp = client.get(eps_url, headers={"Referer": url})
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


_EMBED_PROVIDERS_RE = re.compile(r"uqload|vidzy|netu|byse", re.IGNORECASE)
_TITLE_SUFFIX_RE = re.compile(r"\s+[-–|]\s+.*$")  # space-dash-space avoids breaking hyphenated titles
_FILM_PREFIX_RE = re.compile(r"^(?:Film|Movie)\s+", re.IGNORECASE)


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

    with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        page_resp = client.get(url)
        page_resp.raise_for_status()
        soup = BeautifulSoup(page_resp.text, "html.parser")

        # Extract title from <title> tag, stripping site suffix
        raw_page_title = soup.title.string if soup.title else ""
        film_title = _TITLE_SUFFIX_RE.sub("", raw_page_title).strip()
        film_title = _FILM_PREFIX_RE.sub("", film_title).strip() or f"film_{news_id}"

        base_origin = "/".join(str(page_resp.url).split("/")[:3])

        # Try film-specific JSON endpoint first, then series endpoint
        embed_urls: dict[str, str] = {}
        available_langs: list[str] = []
        for endpoint in (f"/data/film_{news_id}.txt", f"/data/eps_{news_id}.txt"):
            try:
                eps_resp = client.get(f"{base_origin}{endpoint}", headers={"Referer": url})
                eps_resp.raise_for_status()
                data: dict[str, object] = eps_resp.json()
                available_langs = [k for k in data if k != "info" and isinstance(data[k], dict)]
                # Try requested lang first, then any available lang
                for candidate_lang in ([lang] + [l for l in available_langs if l != lang]):
                    lang_data = data.get(candidate_lang, {})
                    if isinstance(lang_data, dict) and lang_data:
                        first_ep = next(iter(lang_data.values()), {})
                        if isinstance(first_ep, dict):
                            embed_urls = {k: v for k, v in first_ep.items() if v}
                        if embed_urls:
                            break
                if embed_urls:
                    logger.debug("Film embed URLs from %s: %s", endpoint, list(embed_urls))
                    break
            except Exception as exc:
                logger.debug("Film endpoint %s unavailable: %s", endpoint, exc)
                continue

        # Fallback: scrape iframes from the page (try src and data-src)
        if not embed_urls:
            logger.debug("Falling back to iframe scraping for film %s", url)
            for iframe in soup.find_all("iframe"):
                src: str = iframe.get("src") or iframe.get("data-src") or ""
                if not src:
                    continue
                if _EMBED_PROVIDERS_RE.search(src):
                    pname = next((p for p in ("uqload", "vidzy", "netu") if p in src.lower()), "unknown")
                    embed_urls[pname] = src
            logger.debug("Iframe scraped embed URLs: %s", list(embed_urls))

        if not embed_urls:
            logger.warning("No embed URLs found for film %s — page may use dynamic loading", url)

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
    with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        page_resp = client.get(url)
        page_resp.raise_for_status()
        base_origin = "/".join(str(page_resp.url).split("/")[:3])
        for endpoint in (f"/data/film_{news_id}.txt", f"/data/eps_{news_id}.txt"):
            try:
                resp = client.get(f"{base_origin}{endpoint}", headers={"Referer": url})
                resp.raise_for_status()
                data: dict[str, object] = resp.json()
                return sorted(k for k in data if k != "info" and isinstance(data[k], dict))
            except Exception:
                continue
    return []


def _parse_season_number(soup: BeautifulSoup) -> int:
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

    raise ValueError("Could not determine season number from page")


def _parse_news_id(soup: BeautifulSoup) -> str:
    config = soup.find(id="serie-config")
    if config:
        news_id: str | None = config.get("data-news-id")  # type: ignore[assignment]
        if news_id:
            return news_id
    raise ValueError("Could not find news ID in page (missing #serie-config)")
