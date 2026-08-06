from __future__ import annotations

from urllib.parse import urlsplit

from sestudio import scraper
from sestudio.models import SeasonCard
from sestudio.sites.base import ContentSite, PageResult, SiteError


class FstreamSite(ContentSite):
    """DLE-CMS site adapter covering fstream and its anime sibling french-manga."""

    def __init__(
        self,
        site_id: str,
        display_name: str,
        base_url: str,
        *,
        is_anime: bool = False,
    ) -> None:
        self.id = site_id
        self.display_name = display_name
        self.base_url = base_url
        self.is_anime = is_anime

    def search(self, query: str) -> list[SeasonCard]:
        try:
            cards = scraper.search_one(query, self.base_url, is_anime=self.is_anime)
        except Exception as exc:
            raise SiteError(f"{self.id} search failed: {exc}") from exc
        for card in cards:
            card.source = self.id
        return cards

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        season, episodes, is_film, available_langs = scraper.fetch_page(url, lang)
        return PageResult(
            season=season,
            episodes=episodes,
            is_film=is_film,
            available_langs=available_langs,
        )

    def owns_url(self, url: str) -> bool:
        host = urlsplit(url).hostname or ""
        own = urlsplit(self.base_url).hostname or ""
        return bool(host) and host == own
