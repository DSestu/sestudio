from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from sestudio.web.app import create_app

FIXTURES = Path(__file__).parent.parent / "fixtures"


@pytest.fixture()
def client():
    app = create_app(live_domain="https://fs03.lol")
    return TestClient(app)


def test_get_season_returns_episodes(client, httpx_mock: HTTPXMock):
    season_html = (FIXTURES / "season_page.html").read_text(encoding="utf-8")
    eps_json = (FIXTURES / "eps_16676.json").read_text(encoding="utf-8")

    # available_langs comes from the same fetch — no second round trip.
    httpx_mock.add_response(url="https://fs03.lol/season1", text=season_html)
    httpx_mock.add_response(
        url="https://fs03.lol/data/eps_16676.txt",
        text=eps_json,
        headers={"Content-Type": "application/json"},
    )

    resp = client.get("/api/season?url=https://fs03.lol/season1&lang=vf")
    assert resp.status_code == 200
    data = resp.json()
    assert data["season"] == 1
    assert len(data["episodes"]) == 22
    assert "vf" in data["available_langs"]
    assert data["source"] == "fstream"
    assert "uqload" in data["provider_order"]
    ep1 = data["episodes"][0]
    assert ep1["number"] == 1
    assert "uqload" in ep1["providers"]


def test_get_season_unknown_source_is_400(client):
    resp = client.get("/api/season?url=https://fs03.lol/season1&source=nope")
    assert resp.status_code == 400
