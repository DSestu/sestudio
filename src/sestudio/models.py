import re
from dataclasses import dataclass, field

from sestudio.http_client import BROWSER_UA

_UNSAFE_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MULTI_DASH_RE = re.compile(r"-{2,}")


def sanitize_path_component(name: str) -> str:
    """Replace path-unsafe characters with dashes, collapse runs, strip edges."""
    name = _UNSAFE_RE.sub("-", name)
    name = _MULTI_DASH_RE.sub("-", name)
    return name.strip("-. ")


@dataclass
class SeasonCard:
    newsid: str
    title: str
    series_name: str
    season_number: int
    poster_url: str
    page_url: str
    is_film: bool = False
    is_anime: bool = False
    # Release year from the search title, 0 when absent. Used to disambiguate
    # remakes when matching against a metadata provider.
    year: int = 0


@dataclass
class Episode:
    number: int
    title: str
    season: int
    embed_urls: dict[str, str] = field(default_factory=dict)  # provider -> embed url

    @property
    def filename(self) -> str:
        safe_title = sanitize_path_component(self.title)
        if self.season == 0:
            return f"{safe_title}.mp4"
        return f"S{self.season:02d}E{self.number:02d} - {safe_title}.mp4"


@dataclass
class StreamSource:
    url: str
    referer: str
    provider: str
    user_agent: str = (
        BROWSER_UA  # browser UA the CDN expects; some hosts 403 without it
    )
