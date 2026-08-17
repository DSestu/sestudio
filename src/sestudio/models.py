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
    # Id of the ContentSite this card came from.
    source: str = "fstream"


@dataclass
class Episode:
    number: int
    title: str
    season: int
    embed_urls: dict[str, str] = field(default_factory=dict)  # provider -> embed url
    # Languages this episode exists in, site-wide — not just the fetched one. A
    # season is rarely uniform: the newest episodes often carry vostfr only.
    # Empty means the site could not say.
    langs: list[str] = field(default_factory=list)

    @property
    def filename(self) -> str:
        safe_title = sanitize_path_component(self.title)
        if self.season == 0:
            return f"{safe_title}.mp4"
        return f"S{self.season:02d}E{self.number:02d} - {safe_title}.mp4"


@dataclass
class Subtitle:
    """A sidecar subtitle track served alongside a stream.

    Hosts that carry soft subs (vidzy, premium) declare them outside the media
    itself — as a `<track>` element or a player `loadTracks([...])` call — so they
    are resolved with the stream and travel next to it rather than inside it.
    """

    url: str
    # BCP-47-ish code as the host wrote it ("fre", "fr", "en"); not normalised,
    # since it is only ever shown and matched loosely.
    lang: str
    label: str
    # The host marked this track as the one to enable on load.
    default: bool = False


@dataclass
class StreamSource:
    url: str
    referer: str
    provider: str
    user_agent: str = (
        BROWSER_UA  # browser UA the CDN expects; some hosts 403 without it
    )
    # Sidecar subtitle tracks, empty when the host serves none (or burns them in).
    subtitles: list[Subtitle] = field(default_factory=list)
