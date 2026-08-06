from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from sestudio.models import Episode, SeasonCard, StreamSource
from sestudio.providers.base import StreamProvider

# Preferred host-resolver order shared by stream resolution and downloads.
# Single source of truth — sites may override via provider_order().
DEFAULT_PROVIDER_ORDER: tuple[str, ...] = (
    "uqload",
    "vidzy",
    "premium",
    "netu",
    "luluvid",
    "filmoon",
    "voe",
)


@dataclass
class PageResult:
    """Everything a title page yields in one fetch."""

    season: int  # 0 for films
    episodes: list[Episode]
    is_film: bool
    available_langs: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class StreamCandidate:
    """One resolvable playback option for an episode.

    ``provider`` is the label shown in the UI and recorded on download jobs; by
    default it is a key into the shared host-resolver registry, but a site that
    overrides resolve_candidate() may use any scheme it likes.
    """

    provider: str
    embed_url: str


class SiteError(Exception):
    """Raised by a site for scrape/parse failures (routes map it to 502)."""


class ContentSite(ABC):
    """A content catalog website (search + title pages + stream candidates).

    Distinct from StreamProvider: providers resolve a single host's embed to a
    playable URL and are shared across sites; a ContentSite owns everything
    specific to one website, including how its embeds become streams.
    """

    id: str
    display_name: str
    is_anime: bool = False
    # Download folder for standalone films (season == 0).
    films_dirname: str = "fstream_films"

    @abstractmethod
    def search(self, query: str) -> list[SeasonCard]:
        """Return search results; every card must have card.source == self.id."""

    @abstractmethod
    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        """Fetch a title page (series season or film) owned by this site."""

    def owns_url(self, url: str) -> bool:
        """Fallback routing when a request carries no source id."""
        return False

    def provider_order(self) -> tuple[str, ...]:
        return DEFAULT_PROVIDER_ORDER

    def stream_candidates(self, embed_urls: dict[str, str]) -> list[StreamCandidate]:
        """Order an episode's provider→embed map into resolvable candidates."""
        names = [p for p in self.provider_order() if p in embed_urls]
        names += [p for p in embed_urls if p not in names]
        return [StreamCandidate(p, embed_urls[p]) for p in names]

    def resolve_candidate(
        self,
        candidate: StreamCandidate,
        host_resolvers: dict[str, StreamProvider],
    ) -> StreamSource:
        """Resolve one candidate to a playable stream.

        Default: delegate to the shared host-resolver registry. Sites serving
        direct stream URLs override this and ignore host_resolvers.
        """
        handler = host_resolvers.get(candidate.provider)
        if handler is None:
            raise SiteError(f"No resolver for provider {candidate.provider!r}")
        return handler.get_stream_url(candidate.embed_url)
