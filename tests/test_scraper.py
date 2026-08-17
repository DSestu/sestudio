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

    season, episodes, _ = fetch_season(SEASON_URL, lang="vf")

    assert season == 1


def test_fetch_season_returns_22_episodes(httpx_mock: HTTPXMock, season_html, eps_json):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    season, episodes, _ = fetch_season(SEASON_URL, lang="vf")

    assert len(episodes) == 22


def test_fetch_season_episodes_have_uqload_url(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes, _ = fetch_season(SEASON_URL, lang="vf")

    ep1 = episodes[0]
    assert ep1.number == 1
    assert ep1.embed_urls.get("uqload") == "https://uqload.is/embed-czbs41i6g7nb.html"


def test_fetch_season_episode_title_from_info(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes, _ = fetch_season(SEASON_URL, lang="vf")

    assert episodes[0].title == "Enfants des dieux (1/2)"


def test_fetch_season_episode_filename(httpx_mock: HTTPXMock, season_html, eps_json):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes, _ = fetch_season(SEASON_URL, lang="vf")

    assert episodes[0].filename == "S01E01 - Enfants des dieux (1-2).mp4"


def test_fetch_season_vostfr_lang(httpx_mock: HTTPXMock, season_html, eps_json):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    season, episodes, _ = fetch_season(SEASON_URL, lang="vostfr")

    data = json.loads(eps_json)
    vostfr_count = len(data.get("vostfr", {}))
    playable = [ep for ep in episodes if ep.embed_urls]
    assert len(playable) == vostfr_count
    # The others are still listed, without embeds, saying where they do exist —
    # so the UI can show a VF-only episode instead of hiding it.
    for ep in episodes:
        if not ep.embed_urls:
            assert ep.langs and "vostfr" not in ep.langs


def test_fetch_season_episodes_sorted_by_number(
    httpx_mock: HTTPXMock, season_html, eps_json
):
    httpx_mock.add_response(url=SEASON_URL, text=season_html)
    httpx_mock.add_response(url=httpx.URL(EPS_URL), text=eps_json)

    _, episodes, _ = fetch_season(SEASON_URL, lang="vf")

    numbers = [ep.number for ep in episodes]
    assert numbers == sorted(numbers)


# The iframe fallback used to name providers by looking for the provider's own
# name in the URL, which almost never appears: premium is served from fsvid.lol
# and luluvid from rotating aliases, so those embeds were labelled "unknown" and
# silently dropped (no registered provider can resolve "unknown").
@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://uqload.is/embed-n5ye6ojzr4tt.html", "uqload"),
        ("https://vidzy.org/embed-unx6mbq6elxm.html", "vidzy"),
        ("https://fsvid.lol/embed-587o524garwv.html", "premium"),
        ("https://luluvdo.com/e/x4eyb8np2x91", "luluvid"),
        ("https://vidhsareup.io/embed-wd05jb8ookxk.html", "luluvid"),
        ("https://voe.sx/e/hjfbl844ghl0", "voe"),
        ("https://kakaflix.lol/voe1/newPlayer.php?id=abc", "voe"),
        ("https://kakaflix.lol/moon2/newPlayer.php?id=abc", "netu"),
        ("https://example.com/some/unrelated/iframe.html", None),
    ],
)
def test_provider_from_embed_url(url: str, expected: str | None):
    from sestudio.scraper import _provider_from_embed_url

    assert _provider_from_embed_url(url) == expected


# The film API carries two French dubs, vff (France) and vfq (Québec). Mapping
# "vf" to vfq alone picked the Québec entry even when vff existed — the wrong dub,
# and on some providers a wrapper URL that cannot be resolved while vff works.
_PLAYERS_BOTH_DUBS = {
    "players": {
        "filmoon": {
            "default": "https://vidaraa.cc/e/FRANCE",
            "vff": "https://vidaraa.cc/e/FRANCE",
            "vfq": "https://kokoflix.lol/chamber_go.php?id=QUEBEC",
            "vostfr": "https://fr.kakaflix.lol/viper/newplayer.php?id=SUBS",
        }
    }
}


def _film_api_embeds(httpx_mock: HTTPXMock, payload: dict, lang: str) -> dict[str, str]:
    from sestudio.http_client import new_client
    from sestudio.scraper import _fetch_film_api

    httpx_mock.add_response(
        url="https://fs.example/engine/ajax/film_api.php?id=1",
        method="GET",
        json=payload,
    )
    with new_client() as client:
        embeds, _ = _fetch_film_api(
            client, "https://fs.example", "1", "https://fs.example/x.html", lang
        )
    return embeds


@pytest.mark.parametrize(
    "lang,expected",
    [
        ("vf", "https://vidaraa.cc/e/FRANCE"),
        ("vff", "https://vidaraa.cc/e/FRANCE"),
        ("vfq", "https://kokoflix.lol/chamber_go.php?id=QUEBEC"),
        ("vostfr", "https://fr.kakaflix.lol/viper/newplayer.php?id=SUBS"),
    ],
)
def test_film_api_prefers_correct_french_dub(
    httpx_mock: HTTPXMock, lang: str, expected: str
):
    embeds = _film_api_embeds(httpx_mock, _PLAYERS_BOTH_DUBS, lang)
    assert embeds["filmoon"] == expected


def test_film_api_falls_back_across_dubs_when_one_is_missing(httpx_mock: HTTPXMock):
    """A title with only the Québec dub still resolves when "vf" is requested."""
    payload = {"players": {"filmoon": {"vfq": "https://vidaraa.cc/e/ONLYQUEBEC"}}}
    embeds = _film_api_embeds(httpx_mock, payload, "vf")
    assert embeds["filmoon"] == "https://vidaraa.cc/e/ONLYQUEBEC"
