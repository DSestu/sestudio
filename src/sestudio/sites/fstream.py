from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from sestudio import scraper
from sestudio.catalogs import Catalog, FilterField, TtlCache, parallel
from sestudio.catalogs import card as catalog_card
from sestudio.http_client import new_client
from sestudio.models import SeasonCard
from sestudio.sites.base import ContentSite, PageResult, SiteError

# DLE's own list orders; a title sort reads A–Z only ascending.
_SORTS = [
    ("date", "Newest"),
    ("rating", "Top rated"),
    ("news_read", "Most viewed"),
    ("comm_num", "Most commented"),
    ("title", "Title A–Z"),
]


@dataclass(frozen=True)
class Kind:
    """One kind of title a DLE site lists (films, series), as category paths."""

    label: str
    path: str
    genres: list[tuple[str, str]] = field(default_factory=list)
    # Other lists of the same kind: by version, platform, status, year.
    collections: list[tuple[str, str]] = field(default_factory=list)
    series_only: bool = False


@dataclass(frozen=True)
class Listings:
    description: str
    kinds: dict[str, Kind]
    # Home rows: (title, filter values).
    shelves: list[tuple[str, dict[str, str]]]


class FstreamSite(ContentSite, Catalog):
    """DLE-CMS site adapter covering fstream and its anime sibling french-manga."""

    def __init__(
        self,
        site_id: str,
        display_name: str,
        base_url: str,
        *,
        is_anime: bool = False,
        listings: Listings | None = None,
    ) -> None:
        self.id = site_id
        self.display_name = display_name
        self.label = display_name
        self.base_url = base_url
        self.home_url = base_url
        self.is_anime = is_anime
        self.listings = listings
        self.description = listings.description if listings else ""
        self._origin = TtlCache(3600)
        self._shelves = TtlCache(600)

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

    # --- Catalog --------------------------------------------------------------

    def available(self) -> bool:
        return self.listings is not None

    def _kind(self, values: dict[str, str]) -> tuple[str, Kind]:
        assert self.listings
        kinds = self.listings.kinds
        kid = values.get("kind", "")
        kid = kid if kid in kinds else next(iter(kinds))
        return kid, kinds[kid]

    def schema(self, values: dict[str, str]) -> list[FilterField]:
        assert self.listings
        kid, kind = self._kind(values)
        fields: list[FilterField] = []
        if len(self.listings.kinds) > 1:
            fields.append(
                FilterField(
                    "kind",
                    "Type",
                    "select",
                    [
                        {"value": k, "label": v.label}
                        for k, v in self.listings.kinds.items()
                    ],
                    default=next(iter(self.listings.kinds)),
                    reload=True,
                )
            )
        fields.append(
            FilterField(
                "sort",
                "Sort",
                "select",
                [{"value": v, "label": label} for v, label in _SORTS],
                default="date",
            )
        )
        if kind.genres:
            fields.append(
                FilterField(
                    "genre",
                    "Genre",
                    "select",
                    [{"value": "", "label": "All"}]
                    + [{"value": p, "label": label} for label, p in kind.genres],
                    quick=True,
                )
            )
        if kind.collections:
            fields.append(
                FilterField(
                    "list",
                    "List",
                    "select",
                    [{"value": "", "label": f"All {kind.label.lower()}"}]
                    + [{"value": p, "label": label} for label, p in kind.collections],
                )
            )
        return fields

    def _resolve_origin(self) -> str:
        # Some domains redirect to a versioned subdomain, as search does.
        with new_client(headers=scraper.HEADERS) as client:
            resp = client.get(self.base_url)
        return "/".join(str(resp.url).split("/")[:3])

    def discover(self, values: dict[str, str], page: int) -> dict[str, Any]:
        _, kind = self._kind(values)
        known = lambda pairs, v: v if v in {p for _, p in pairs} else ""  # noqa: E731
        genre = known(kind.genres, values.get("genre", ""))
        listed = known(kind.collections, values.get("list", ""))
        # A DLE page is one category: a genre and a list can't be combined.
        path = (genre or listed or kind.path).rstrip("/") + "/"
        note = (
            f"Genre only: {self.display_name} can't list a genre within another list."
            if genre and listed
            else ""
        )
        sort = values.get("sort", "date")
        sort = sort if sort in dict(_SORTS) else "date"
        try:
            origin = self._origin.get("origin", self._resolve_origin)
            url = f"{origin}{path}" + (f"page/{page}/" if page > 1 else "")
            with new_client(headers=scraper.HEADERS) as client:
                if sort == "date":
                    resp = client.get(url)
                else:
                    # DLE sorts a list from a form post, not a query string.
                    scope = "xfsearch" if "/xfsearch/" in path else "cat"
                    resp = client.post(
                        url,
                        data={
                            "dlenewssortby": sort,
                            "dledirection": "asc" if sort == "title" else "desc",
                            "set_new_sort": f"dle_sort_{scope}",
                            "set_direction_sort": f"dle_direction_{scope}",
                        },
                    )
            # Past the last page DLE answers 404.
            if resp.status_code == 404 and page > 1:
                return {"cards": [], "page": page, "has_more": False, "note": note}
            resp.raise_for_status()
        except Exception as exc:
            raise SiteError(f"{self.id} listing failed: {exc}") from exc
        found = scraper.parse_listing(
            resp.text, origin, is_anime=self.is_anime, series_only=kind.series_only
        )
        cards = []
        for season_card, blurb in found:
            season_card.source = self.id
            cards.append(
                catalog_card(
                    season_card.newsid,
                    season_card.title,
                    season_card.poster_url,
                    {"card": vars(season_card)},
                    year=season_card.year,
                    overview=blurb,
                )
            )
        return {
            "cards": cards,
            "page": page,
            # The "next" arrow is a link until the last page.
            "has_more": 'class="pnext"><a ' in resp.text,
            "note": note,
        }

    def shelves(self) -> list[dict[str, Any]]:
        return self._shelves.get("all", self._fetch_shelves)

    def _fetch_shelves(self) -> list[dict[str, Any]]:
        assert self.listings
        specs = self.listings.shelves
        pages = parallel([lambda v=v: self.discover(v, 1) for _, v in specs])
        return [
            {
                "id": f"shelf-{i}",
                "title": title,
                "cards": got["cards"][:18],
                "values": values,
            }
            for i, ((title, values), got) in enumerate(zip(specs, pages))
            if got and got["cards"]
        ]


FSTREAM_LISTINGS = Listings(
    description="Films & series · French audio",
    kinds={
        "films": Kind(
            "Films",
            "/films/",
            genres=[
                ("Action", "/films/actions/"),
                ("Animation", "/films/animations/"),
                ("Arts martiaux", "/art-martiaux/"),
                ("Aventure", "/films/aventures/"),
                ("Biopic", "/films/biopics/"),
                ("Comédie", "/films/comedies/"),
                ("Documentaire", "/films/documentaires/"),
                ("Drame", "/films/drames/"),
                ("Espionnage", "/films/espionnages/"),
                ("Famille", "/films/familles/"),
                ("Fantastique", "/films/fantastiques/"),
                ("Guerre", "/films/guerres/"),
                ("Historique", "/films/historiques/"),
                ("Horreur", "/films/epouvante-horreurs/"),
                ("Policier", "/films/policiers/"),
                ("Romance", "/films/romances/"),
                ("Science-fiction", "/films/science-fictions/"),
                ("Thriller", "/films/thrillers/"),
                ("Western", "/films/westerns/"),
            ],
            collections=[
                ("Films du moment", "/films/top-film/"),
                ("Notre sélection", "/films/cultes/"),
                ("Avec VF", "/films/vf/"),
                ("Avec VOSTFR", "/xfsearch/version-film/VOSTFR/"),
                ("Sortis en 2026", "/xfsearch/date-de-sortie/2026/"),
                ("Sortis en 2025", "/xfsearch/date-de-sortie/2025/"),
                ("Sortis en 2024", "/xfsearch/date-de-sortie/2024/"),
            ],
        ),
        "series": Kind(
            "Series",
            "/s-tv/",
            genres=[
                ("Action", "/action-serie-/"),
                ("Animation", "/animation-serie-/"),
                ("Aventure", "/aventure-series-/"),
                ("Biopic", "/serie-biopic-/"),
                ("Comédie", "/comedie-serie-/"),
                ("Documentaire", "/documentaire-serie-/"),
                ("Drame", "/drame-serie-/"),
                ("Famille", "/familles-series-/"),
                ("Fantastique", "/fantastique-series-/"),
                ("Historique", "/serie-historiques-/"),
                ("Horreur", "/horreur-serie-/"),
                ("Judiciaire", "/judiciare-series-/"),
                ("K-drama", "/k-drama-/"),
                ("Médical", "/medical-series-/"),
                ("Policier", "/policier-series-/"),
                ("Romance", "/romance-series-/"),
                ("Science-fiction", "/science-fiction-series-/"),
                ("Télé-réalité", "/streaming-tv-realits/"),
                ("Thriller", "/thriller-series-/"),
                ("Western", "/western-series-/"),
            ],
            collections=[
                ("Séries du moment", "/s-tv/sries-du-moment/"),
                ("Avec VF", "/s-tv/s-vf/"),
                ("VOSTFR", "/s-tv/s-vostfr/"),
                ("VOSTENG", "/s-tv/s-vo/"),
                ("Netflix", "/s-tv/netflix-series-/"),
                ("Prime Video", "/s-tv/serie-amazon-prime-videos/"),
                ("Disney+", "/s-tv/series-disney-plus/"),
                ("Apple TV+", "/s-tv/series-apple-tv/"),
                ("En cours", "/series/en-cours/"),
                ("Terminées", "/series/terminees/"),
                ("Annulées", "/series/annulees/"),
            ],
            series_only=True,
        ),
    },
    shelves=[
        ("Films du moment", {"kind": "films", "list": "/films/top-film/"}),
        ("Séries du moment", {"kind": "series", "list": "/s-tv/sries-du-moment/"}),
        ("Nouveaux films", {"kind": "films"}),
        ("Nouvelles séries", {"kind": "series"}),
        ("Films · Action", {"kind": "films", "genre": "/films/actions/"}),
        ("Films · Comédie", {"kind": "films", "genre": "/films/comedies/"}),
    ],
)

FRENCH_MANGA_LISTINGS = Listings(
    description="Anime · French dubs & subtitles",
    kinds={
        "anime": Kind(
            "Anime",
            "/manga-streaming-1/",
            genres=[
                ("Action", "/xfsearch/manga_genre/Action/"),
                ("Action & aventure", "/xfsearch/manga_genre/Action+%26+Adventure/"),
                ("Aventure", "/xfsearch/manga_genre/Aventure/"),
                ("Comédie", "/xfsearch/manga_genre/Com%C3%A9die/"),
                ("Crime", "/xfsearch/manga_genre/Crime/"),
                ("Drame", "/xfsearch/manga_genre/Drame/"),
                ("Fantastique", "/xfsearch/manga_genre/Fantastique/"),
                ("Guerre & politique", "/xfsearch/manga_genre/War+%26+Politics/"),
                ("Mystère", "/xfsearch/manga_genre/Myst%C3%A8re/"),
                ("Romance", "/xfsearch/manga_genre/Romance/"),
                ("Science-fiction", "/xfsearch/manga_genre/Science-Fiction/"),
                (
                    "SF & fantastique",
                    "/xfsearch/manga_genre/Science-Fiction+%26+Fantastique/",
                ),
                ("Thriller", "/xfsearch/manga_genre/Thriller/"),
            ],
            collections=[
                ("VF", "/mangas-vf/"),
                ("VOSTFR", "/mangas-vostfr/"),
                ("VF + VOSTFR", "/xfsearch/version-serie/VF+VOSTFR/"),
                ("VOSTENG", "/xfsearch/version-serie/VOSTENG/"),
                ("En cours", "/xfsearch/serie-statut/En+cours/"),
                ("Terminés", "/xfsearch/serie-statut/Termin%C3%A9/"),
                ("Films", "/xfsearch/serie-statut/Film/"),
                ("Films d'animation", "/manga-streaming-1/film-danimation/"),
                ("Coups de cœur", "/manga-streaming-1/coups-de-cur/"),
            ],
        ),
    },
    shelves=[
        ("Récemment mis à jour", {}),
        ("Coups de cœur", {"list": "/manga-streaming-1/coups-de-cur/"}),
        ("En VF", {"list": "/mangas-vf/"}),
        ("Films d'animation", {"list": "/manga-streaming-1/film-danimation/"}),
        ("Action", {"genre": "/xfsearch/manga_genre/Action/"}),
        ("Romance", {"genre": "/xfsearch/manga_genre/Romance/"}),
    ],
)
