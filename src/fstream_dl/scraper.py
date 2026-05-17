import re
import logging

import httpx
from bs4 import BeautifulSoup

from fstream_dl.models import Episode

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

SEASON_RE = re.compile(r"[Ss]aison\s+(\d+)", re.IGNORECASE)


def fetch_season(url: str, lang: str = "vf") -> tuple[int, list[Episode]]:
    """Fetch a season page and return (season_number, episodes) for the given language."""
    with httpx.Client(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        page_resp = client.get(url)
        page_resp.raise_for_status()

        soup = BeautifulSoup(page_resp.text, "html.parser")
        season = _parse_season_number(soup)
        news_id = _parse_news_id(soup)

        base_url = str(page_resp.url)
        base_origin = "/".join(base_url.split("/")[:3])
        eps_url = f"{base_origin}/data/eps_{news_id}.txt"

        eps_resp = client.get(eps_url, headers={"Referer": url})
        eps_resp.raise_for_status()

    data = eps_resp.json()
    lang_data: dict = data.get(lang, {})
    info_data: dict = data.get("info", {})

    episodes = []
    for key, providers in lang_data.items():
        num = int(key)
        info = info_data.get(str(key), {})
        title = info.get("title") if isinstance(info, dict) else None
        title = title or f"Episode {num}"
        ep = Episode(
            number=num,
            title=title,
            season=season,
            embed_urls={k: v for k, v in providers.items() if v},
        )
        episodes.append(ep)

    episodes.sort(key=lambda e: e.number)
    return season, episodes


def _parse_season_number(soup: BeautifulSoup) -> int:
    config = soup.find(id="serie-config")
    if config:
        title = config.get("data-title", "")
        m = SEASON_RE.search(title)
        if m:
            return int(m.group(1))

    page_title = soup.title.string if soup.title else ""
    m = SEASON_RE.search(page_title)
    if m:
        return int(m.group(1))

    raise ValueError("Could not determine season number from page")


def _parse_news_id(soup: BeautifulSoup) -> str:
    config = soup.find(id="serie-config")
    if config:
        news_id = config.get("data-news-id")
        if news_id:
            return news_id
    raise ValueError("Could not find news ID in page (missing #serie-config)")
