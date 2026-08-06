from __future__ import annotations

from sestudio.sites.base import (
    DEFAULT_PROVIDER_ORDER,
    ContentSite,
    PageResult,
    SiteError,
    StreamCandidate,
)

__all__ = [
    "DEFAULT_PROVIDER_ORDER",
    "ContentSite",
    "PageResult",
    "SiteError",
    "StreamCandidate",
    "build_sites",
    "site_for",
]

ANIME_DOMAIN = "https://french-manga.net"


def build_sites(fstream_domain: str | None = None) -> dict[str, ContentSite]:
    """Build the registry of content sites, keyed by site id."""
    # Imported here, not at module level: scraper imports sites.base, so a
    # top-level import of fstream (which imports scraper) would be circular.
    from sestudio.sites.fstream import FstreamSite
    from sestudio.sites.senpai import SenpaiSite

    return {
        "fstream": FstreamSite(
            "fstream", "FStream", fstream_domain or "https://fstream.top"
        ),
        "french-manga": FstreamSite(
            "french-manga", "French-Manga", ANIME_DOMAIN, is_anime=True
        ),
        "senpai": SenpaiSite(),
    }


def site_for(
    sites: dict[str, ContentSite], source: str | None, url: str = ""
) -> ContentSite:
    """Pick the site owning a request.

    Explicit unknown source raises KeyError (routes map it to 400); an absent
    source falls back to owns_url() and finally to "fstream" so pre-multi-site
    deep links, library entries and API callers keep working.
    """
    if source:
        return sites[source]
    if url:
        for site in sites.values():
            if site.owns_url(url):
                return site
    return sites["fstream"]
