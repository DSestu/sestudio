from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio.models import Episode, SeasonCard, StreamSource
from sestudio.sites import ContentSite, PageResult, StreamCandidate
from sestudio.web.app import create_app


class FakeSite(ContentSite):
    """Canned in-memory site for exercising source routing without HTTP mocks."""

    id = "fake"
    display_name = "Fake"
    films_dirname = "fake_films"

    def search(self, query: str) -> list[SeasonCard]:
        return [
            SeasonCard(
                newsid="1",
                title=f"{query} Saison 1",
                series_name=query,
                season_number=1,
                poster_url="https://fake.example/p.jpg",
                page_url="https://fake.example/1-title.html",
                source=self.id,
            )
        ]

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        return PageResult(
            season=1,
            episodes=[
                Episode(
                    number=1,
                    title="Ep 1",
                    season=1,
                    embed_urls={"direct": "https://fake.example/e1"},
                )
            ],
            is_film=False,
            available_langs=["vf"],
        )

    def owns_url(self, url: str) -> bool:
        return url.startswith("https://fake.example/")

    def resolve_candidate(self, candidate: StreamCandidate, host_resolvers):
        # Direct-stream site: no shared host resolver involved.
        return StreamSource(
            url=candidate.embed_url + ".mp4",
            referer="https://fake.example/",
            provider=candidate.provider,
        )


@pytest.fixture()
def fake_site_client() -> TestClient:
    app = create_app(live_domain="https://fs03.lol")
    app.state.sites["fake"] = FakeSite()
    return TestClient(app)
