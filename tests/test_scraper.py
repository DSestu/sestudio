import json
import pytest
import httpx
from pytest_httpx import HTTPXMock

from sestudio.scraper import fetch_season
from tests.conftest import load_fixture


SEASON_URL = (
    "https://fs03.lol/16676-stargate-sg-1-saison-1-streaming-complet-vf-vostfr.html"
)
EPS_URL = "https://fs03.lol/data/eps_16676.txt"


@pytest.fixture
def season_html() -> str:
    return load_fixture("season_page.html")


@pytest.fixture
def eps_json() -> str:
    return load_fixture("eps_16676.json")


def test_fetch_season_returns_correct_season_number(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    season, episodes = fetch_season(SEASON_URL, lang="vf")

    assert season == 1


def test_fetch_season_returns_22_episodes(httpx_mock: HTTPXMock, season_html, eps_json):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    season, episodes = fetch_season(SEASON_URL, lang="vf")

    assert len(episodes) == 22


def test_fetch_season_episodes_have_uqload_url(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes = fetch_season(SEASON_URL, lang="vf")

    ep1 = episodes[0]
    assert ep1.number == 1
    assert ep1.embed_urls.get("uqload") == "https://uqload.is/embed-czbs41i6g7nb.html"


def test_fetch_season_episode_title_from_info(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes = fetch_season(SEASON_URL, lang="vf")

    assert episodes[0].title == "Enfants des dieux (1/2)"


def test_fetch_season_episode_filename(httpx_mock: HTTPXMock, season_html, eps_json):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes = fetch_season(SEASON_URL, lang="vf")

    assert episodes[0].filename == "S01E01 - Enfants des dieux (1-2).mp4"


def test_fetch_season_vostfr_lang(httpx_mock: HTTPXMock, season_html, eps_json):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    season, episodes = fetch_season(SEASON_URL, lang="vostfr")

    data = json.loads(eps_json)
    vostfr_count = len(data.get("vostfr", {}))
    assert len(episodes) == vostfr_count


def test_fetch_season_episodes_sorted_by_number(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes = fetch_season(SEASON_URL, lang="vf")

    numbers = [ep.number for ep in episodes]
    assert numbers == sorted(numbers)
