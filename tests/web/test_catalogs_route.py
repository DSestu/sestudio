from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from sestudio.catalogs import Catalog, FilterField, parse_range
from sestudio.web.app import create_app


class FakeCatalog(Catalog):
    id = "fake"
    label = "Fake"

    def __init__(self) -> None:
        self.seen: list[tuple[dict[str, str], int]] = []

    def schema(self, values: dict[str, str]) -> list[FilterField]:
        return [
            FilterField(
                "sort", "Sort", "select", [{"value": "a", "label": "A"}], default="a"
            )
        ]

    def shelves(self) -> list[dict[str, Any]]:
        return [{"id": "s", "title": "Shelf", "cards": [], "values": {}}]

    def discover(self, values: dict[str, str], page: int) -> dict[str, Any]:
        self.seen.append((values, page))
        return {"cards": [], "page": page, "has_more": False, "note": ""}


@pytest.fixture()
def app():
    app = create_app(live_domain="https://fs03.lol")
    app.state.catalogs = {"fake": FakeCatalog()}
    return app


def test_lists_and_serves_a_catalogue(app):
    client = TestClient(app)
    assert client.get("/api/catalogs").json() == [
        {"id": "fake", "label": "Fake", "description": ""}
    ]
    assert client.get("/api/catalogs/fake/schema").json()[0]["key"] == "sort"
    assert client.get("/api/catalogs/fake/shelves").json()[0]["title"] == "Shelf"
    resp = client.get("/api/catalogs/fake/discover?page=2&sort=a&genres=x,y")
    assert resp.status_code == 200
    # The page is not a filter; every other parameter reaches the catalogue.
    assert app.state.catalogs["fake"].seen == [({"sort": "a", "genres": "x,y"}, 2)]


def test_unknown_or_disabled_catalogue_is_404(app, monkeypatch):
    client = TestClient(app)
    assert client.get("/api/catalogs/nope/shelves").status_code == 404

    class Cfg:
        disabled_sites = ["fake"]

    monkeypatch.setattr("sestudio.web.routes.catalogs.load_config", lambda: Cfg())
    assert client.get("/api/catalogs").json() == []
    assert client.get("/api/catalogs/fake/shelves").status_code == 404


def test_parse_range_clamps_and_tolerates_garbage():
    assert parse_range("1990,2100", 1900, 2030) == (1990, 2030)
    assert parse_range("nope", 0, 10) == (0, 10)
