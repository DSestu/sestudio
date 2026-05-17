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

        cards.append(SeasonCard(
            newsid=newsid,
            title=title,
            series_name=series_name,
            season_number=season_number,
            poster_url=poster_url,
            page_url=page_url,
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
