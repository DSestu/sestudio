from __future__ import annotations

import json

import pytest
from pytest_httpx import HTTPXMock

from sestudio.sites import SiteError, StreamCandidate
from sestudio.sites import senpai
from sestudio.sites.senpai import (
    ENTRYPOINT,
    SenpaiSite,
    _lang_index,
    _lang_of_label,
    _parse_seasons,
    _unwrap,
)
from tests.conftest import load_fixture
from tests.sites.contract import SiteContractMixin

BASE = "https://senpai-stream.live"
SHOW = f"{BASE}/tv-show/test-show"
MOVIE = f"{BASE}/movie/test-film"
LIVEWIRE = f"{BASE}/livewire/update"
EMBED = f"{BASE}/embed/ENCRYPTEDBLOB"
MEDIA = "https://cdn.example.r2.cloudflarestorage.com/box/MOVIES/1/VF/01.mp4"


def _site() -> SenpaiSite:
    """A site pinned to a domain, so tests never hit the entrypoint."""
    return SenpaiSite(BASE)


def _livewire_reply(*, returns=None, html: str = "") -> dict:
    return {
        "components": [
            {"snapshot": "{}", "effects": {"returns": returns or [], "html": html}}
        ]
    }


def _mock_search(httpx_mock: HTTPXMock, query: str = "test") -> None:
    httpx_mock.add_response(
        url=f"{BASE}/search/{query}", text=load_fixture("senpai_search.html")
    )
    # The series hit is expanded into per-season cards from its show page.
    httpx_mock.add_response(
        url=SHOW, text=load_fixture("senpai_show.html"), is_reusable=True
    )


class TestSenpaiContract(SiteContractMixin):
    @pytest.fixture()
    def site(self) -> SenpaiSite:
        return _site()

    @pytest.fixture()
    def searchable_query(self, httpx_mock: HTTPXMock) -> str:
        _mock_search(httpx_mock)
        return "test"


# --- domain -----------------------------------------------------------------


def test_resolves_live_domain_from_entrypoint(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=ENTRYPOINT,
        text=(
            '<a href="/dmca">DMCA</a>'
            '<a class="url-value" href="https://senpai-stream.live/?utm_source=wiki">go</a>'
        ),
    )
    assert SenpaiSite().base_url() == BASE


def test_domain_is_resolved_once_and_cached(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=ENTRYPOINT, text=f'<a href="{BASE}/">go</a>')
    site = SenpaiSite()
    assert site.base_url() == site.base_url() == BASE  # one mocked response suffices


def test_entrypoint_without_a_live_link_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=ENTRYPOINT, text="<a href='/cgu'>CGU</a>")
    with pytest.raises(SiteError):
        SenpaiSite().base_url()


def test_owns_url_follows_the_brand_not_the_tld():
    site = _site()
    assert site.owns_url(f"{BASE}/movie/x")
    assert site.owns_url("https://senpai-stream.someothertld/movie/x")
    assert not site.owns_url("https://fs03.lol/16676-x.html")


# --- search -----------------------------------------------------------------


def test_search_returns_a_film_card(httpx_mock: HTTPXMock):
    _mock_search(httpx_mock)
    films = [c for c in _site().search("test") if c.is_film]
    assert len(films) == 1
    card = films[0]
    assert card.source == "senpai"
    assert card.title == "Test Film"
    assert card.season_number == 0
    assert card.year == 2010
    assert card.page_url == MOVIE
    assert card.poster_url == "https://image.tmdb.org/t/p/w300/film.jpg"


def test_search_emits_one_card_per_season(httpx_mock: HTTPXMock):
    _mock_search(httpx_mock)
    seasons = [c for c in _site().search("test") if not c.is_film]
    assert [c.season_number for c in seasons] == [1, 2]
    assert [c.newsid for c in seasons] == ["test-show-s1", "test-show-s2"]
    assert seasons[1].title == "Test Show - Saison 2"
    assert seasons[1].series_name == "Test Show"
    # The season id travels in the URL so fetch_page can ask for it directly.
    assert seasons[1].page_url == f"{SHOW}?sn=2&sid=901"


def test_search_marks_animation_as_anime(httpx_mock: HTTPXMock):
    _mock_search(httpx_mock)
    cards = {c.title: c for c in _site().search("test")}
    assert cards["Test Show - Saison 1"].is_anime
    assert not cards["Test Film"].is_anime


def test_series_page_failure_still_yields_one_card(httpx_mock: HTTPXMock):
    """A dead series page must not drop the title from the results."""
    httpx_mock.add_response(
        url=f"{BASE}/search/test", text=load_fixture("senpai_search.html")
    )
    httpx_mock.add_response(url=SHOW, status_code=503)
    seasons = [c for c in _site().search("test") if not c.is_film]
    assert [c.season_number for c in seasons] == [1]


# --- title pages ------------------------------------------------------------


def test_fetch_movie_lists_both_versions(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=MOVIE, text=load_fixture("senpai_movie.html"))
    page = _site().fetch_page(MOVIE, "vf")
    assert page.is_film and page.season == 0
    assert page.available_langs == ["vf", "vostfr"]
    assert len(page.episodes) == 1
    assert page.episodes[0].title == "Test Film"
    assert page.episodes[0].embed_urls == {"senpai": f"{MOVIE}#lang=vf"}


def test_fetch_inline_season_needs_no_livewire_call(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=SHOW, text=load_fixture("senpai_show.html"))
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-1", text=load_fixture("senpai_episode.html")
    )
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-2", text=load_fixture("senpai_episode.html")
    )
    page = _site().fetch_page(f"{SHOW}?sn=1&sid=900", "vf")
    assert page.season == 1 and not page.is_film
    assert [e.number for e in page.episodes] == [1, 2]
    assert page.episodes[0].title == "Premier épisode"
    assert page.episodes[0].embed_urls == {
        "senpai": f"{BASE}/episode/test-show/1-1#lang=vf"
    }


def test_fetch_other_season_goes_through_livewire(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=SHOW, text=load_fixture("senpai_show.html"))
    httpx_mock.add_response(
        url=LIVEWIRE,
        method="POST",
        json=_livewire_reply(html=load_fixture("senpai_season2.html")),
    )
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/2-3", text=load_fixture("senpai_episode.html")
    )
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/2-4", text=load_fixture("senpai_episode.html")
    )
    page = _site().fetch_page(f"{SHOW}?sn=2&sid=901", "vf")
    assert page.season == 2
    assert [e.number for e in page.episodes] == [3, 4]
    assert page.episodes[0].season == 2
    assert page.episodes[0].filename == "S02E03 - Troisième épisode.mp4"

    sent = json.loads(httpx_mock.get_requests(url=LIVEWIRE)[0].content)
    call = sent["components"][0]["calls"][0]
    assert (call["method"], call["params"]) == ("updateSeason", ["901"])
    assert sent["_token"] == "TESTCSRF123"
    # The snapshot carries a server-side checksum: it must go back untouched.
    assert json.loads(sent["components"][0]["snapshot"])["checksum"] == "0" * 64


def test_requested_language_falls_back_to_one_the_title_has(httpx_mock: HTTPXMock):
    """The season is VF-only, so asking for VOSTFR must retarget the embeds."""
    httpx_mock.add_response(url=SHOW, text=load_fixture("senpai_show.html"))
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-1", text=load_fixture("senpai_episode.html")
    )
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-2", text=load_fixture("senpai_episode.html")
    )
    page = _site().fetch_page(f"{SHOW}?sn=1", "vostfr")
    assert page.available_langs == ["vf"]
    assert page.episodes[0].embed_urls["senpai"].endswith("#lang=vf")


def test_languages_are_read_per_episode_not_from_the_first(httpx_mock: HTTPXMock):
    """Episode 2 also carries VOSTFR; probing only episode 1 used to hide it."""
    httpx_mock.add_response(url=SHOW, text=load_fixture("senpai_show.html"))
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-1", text=load_fixture("senpai_episode.html")
    )
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-2", text=load_fixture("senpai_movie.html")
    )
    page = _site().fetch_page(f"{SHOW}?sn=1", "vostfr")

    assert page.available_langs == ["vf", "vostfr"]
    assert [e.langs for e in page.episodes] == [["vf"], ["vf", "vostfr"]]
    # VOSTFR was asked for: the episode that lacks it is listed without an
    # embed, the one that has it plays in it.
    assert page.episodes[0].embed_urls == {}
    assert page.episodes[1].embed_urls["senpai"].endswith("#lang=vostfr")


def test_unsupported_page_raises():
    with pytest.raises(SiteError):
        _site().fetch_page(f"{BASE}/peoples/someone", "vf")


# --- stream resolution ------------------------------------------------------


def _mock_resolution(httpx_mock: HTTPXMock, embed_fixture: str = "senpai_embed.html"):
    httpx_mock.add_response(url=MOVIE, text=load_fixture("senpai_movie.html"))
    httpx_mock.add_response(
        url=LIVEWIRE, method="POST", json=_livewire_reply(returns=[EMBED])
    )
    httpx_mock.add_response(url=EMBED, text=load_fixture(embed_fixture))


def test_resolve_returns_the_sites_own_media_url(httpx_mock: HTTPXMock):
    _mock_resolution(httpx_mock)
    source = _site().resolve_candidate(
        StreamCandidate("senpai", f"{MOVIE}#lang=vf"), {}
    )
    assert source.provider == "senpai"
    assert source.referer == f"{BASE}/"
    assert source.url.startswith(MEDIA)
    # HTML-escaped in the page; the query must survive unescaped or it 403s.
    assert "&amp;" not in source.url
    assert "X-Amz-Signature=abc123" in source.url


def test_resolve_picks_the_index_matching_the_language(httpx_mock: HTTPXMock):
    _mock_resolution(httpx_mock)
    _site().resolve_candidate(StreamCandidate("senpai", f"{MOVIE}#lang=vostfr"), {})
    call = json.loads(httpx_mock.get_requests(url=LIVEWIRE)[0].content)
    assert call["components"][0]["calls"][0] == {
        "path": "",
        "method": "getVideoLink",
        "params": [1],  # VOSTFR is the second version on this page
    }


def test_resolve_ignores_the_shared_host_resolvers(httpx_mock: HTTPXMock):
    """Senpai self-hosts, so no third-party provider should be consulted."""

    class Boom:
        def get_stream_url(self, embed_url):  # pragma: no cover - must not run
            raise AssertionError("host resolver must not be used")

    _mock_resolution(httpx_mock)
    source = _site().resolve_candidate(
        StreamCandidate("senpai", f"{MOVIE}#lang=vf"), {"senpai": Boom()}
    )
    assert source.url.startswith(MEDIA)


def test_resolve_without_that_language_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-1", text=load_fixture("senpai_episode.html")
    )
    with pytest.raises(SiteError, match="no vostfr"):
        _site().resolve_candidate(
            StreamCandidate("senpai", f"{BASE}/episode/test-show/1-1#lang=vostfr"), {}
        )


def test_resolve_raises_when_the_site_declines_to_hand_out_a_link(
    httpx_mock: HTTPXMock,
):
    """What a CAPTCHA challenge looks like: the action returns nothing."""
    httpx_mock.add_response(url=MOVIE, text=load_fixture("senpai_movie.html"))
    httpx_mock.add_response(url=LIVEWIRE, method="POST", json=_livewire_reply())
    with pytest.raises(SiteError, match="no video link"):
        _site().resolve_candidate(StreamCandidate("senpai", f"{MOVIE}#lang=vf"), {})


def test_resolve_raises_when_embed_has_no_media(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=MOVIE, text=load_fixture("senpai_movie.html"))
    httpx_mock.add_response(
        url=LIVEWIRE, method="POST", json=_livewire_reply(returns=[EMBED])
    )
    httpx_mock.add_response(url=EMBED, text="<html><body>nothing here</body></html>")
    with pytest.raises(SiteError, match="No media URL"):
        _site().resolve_candidate(StreamCandidate("senpai", f"{MOVIE}#lang=vf"), {})


# --- pure helpers -----------------------------------------------------------


def test_unwrap_strips_livewire_array_markers():
    wrapped = [[[{"a": 1}, {"s": "arr"}], [{"a": 2}, {"s": "arr"}]], {"s": "arr"}]
    assert _unwrap(wrapped) == [{"a": 1}, {"a": 2}]
    assert _unwrap([[[{"a": 1}, {"s": "arr"}]], {"s": "arr"}]) == [{"a": 1}]


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Version Française", "vf"),
        ("Version Originale Sous-Titrée Français", "vostfr"),
        ("Version Originale", "vo"),
        ("Trailer", None),
    ],
)
def test_lang_of_label(label: str, expected: str | None):
    assert _lang_of_label(label) == expected


def test_lang_index_uses_the_sites_own_index_field():
    videos = [
        {"label": "Version Française", "index": 7},
        {"label": "Version Originale Sous-Titrée Français", "index": 9},
    ]
    assert _lang_index(videos, "vf") == 7
    assert _lang_index(videos, "vostfr") == 9
    # "vo" has no exact entry and falls back to the subtitled version.
    assert _lang_index(videos, "vo") == 9
    assert _lang_index([{"label": "Version Française", "index": 0}], "vostfr") is None


def test_parse_seasons_defaults_to_a_single_season():
    assert _parse_seasons("<html><body>no tabs</body></html>") == [(1, "")]


# --- rotating domain --------------------------------------------------------


def _entrypoint(host: str) -> str:
    return f'<a class="url-value" href="https://{host}/?utm_source=wiki">go</a>'


def test_domain_is_reresolved_once_the_ttl_lapses(httpx_mock: HTTPXMock, monkeypatch):
    """A long-running server must not keep serving a rotated-away domain."""
    httpx_mock.add_response(url=ENTRYPOINT, text=_entrypoint("senpai-stream.live"))
    httpx_mock.add_response(url=ENTRYPOINT, text=_entrypoint("senpai-stream.xyz"))

    clock = {"now": 1000.0}
    monkeypatch.setattr(senpai.time, "monotonic", lambda: clock["now"])

    site = SenpaiSite()
    assert site.base_url() == BASE
    # Still inside the TTL: no second lookup.
    clock["now"] += senpai.DOMAIN_TTL - 1
    assert site.base_url() == BASE
    # Past it: the new domain is picked up.
    clock["now"] += 2
    assert site.base_url() == "https://senpai-stream.xyz"


def test_refresh_reresolves_immediately(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=ENTRYPOINT, text=_entrypoint("senpai-stream.live"))
    httpx_mock.add_response(url=ENTRYPOINT, text=_entrypoint("senpai-stream.xyz"))
    site = SenpaiSite()
    assert site.base_url() == BASE
    site.refresh()
    assert site.base_url() == "https://senpai-stream.xyz"


def test_a_pinned_domain_is_never_reresolved():
    """No mocked entrypoint: any lookup would fail the test."""
    site = SenpaiSite(BASE)
    site.refresh()
    assert site.base_url() == BASE


def test_a_failed_refresh_keeps_the_previous_domain(httpx_mock: HTTPXMock):
    """A stale guess still beats dropping the site entirely."""
    httpx_mock.add_response(url=ENTRYPOINT, text=_entrypoint("senpai-stream.live"))
    httpx_mock.add_response(url=ENTRYPOINT, status_code=503)
    site = SenpaiSite()
    assert site.base_url() == BASE
    site.refresh()
    assert site.base_url() == BASE


def test_first_resolution_failure_still_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=ENTRYPOINT, status_code=503)
    with pytest.raises(SiteError):
        SenpaiSite().refresh()


def test_saved_urls_are_moved_onto_the_live_domain(httpx_mock: HTTPXMock):
    """A library entry saved before a rotation must still resolve."""
    old = "https://senpai-stream.old/movie/test-film"
    httpx_mock.add_response(url=MOVIE, text=load_fixture("senpai_movie.html"))
    page = SenpaiSite(BASE).fetch_page(old, "vf")
    # Fetched from the current host, and the embed points there too.
    assert page.episodes[0].embed_urls["senpai"].startswith(MOVIE)


def test_rebasing_preserves_the_season_query(httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=SHOW, text=load_fixture("senpai_show.html"))
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-1", text=load_fixture("senpai_episode.html")
    )
    httpx_mock.add_response(
        url=f"{BASE}/episode/test-show/1-2", text=load_fixture("senpai_episode.html")
    )
    page = SenpaiSite(BASE).fetch_page(
        "https://senpai-stream.old/tv-show/test-show?sn=1&sid=900", "vf"
    )
    assert page.season == 1
    assert [e.number for e in page.episodes] == [1, 2]


def test_rebasing_leaves_other_sites_alone():
    other = "https://fs03.lol/16676-x.html"
    assert SenpaiSite(BASE)._rebase(other) == other


def test_resolves_when_the_entrypoint_redirects_onto_the_mirror(httpx_mock: HTTPXMock):
    """Since Aug 2026 the .wiki entrypoint redirects straight to the mirror
    instead of linking to it, and the page it lands on is the site itself."""
    httpx_mock.add_response(
        url=ENTRYPOINT,
        status_code=301,
        headers={"Location": "https://senpai-stream.bond/"},
    )
    httpx_mock.add_response(
        url="https://senpai-stream.bond/",
        text='<a href="https://senpai-stream.bond/movies">Films</a>',
    )
    assert SenpaiSite().base_url() == "https://senpai-stream.bond"


def test_a_redirect_to_a_foreign_host_is_not_taken_as_the_mirror(
    httpx_mock: HTTPXMock,
):
    """Only the brand's own hosts count, so an interstitial cannot hijack it."""
    httpx_mock.add_response(
        url=ENTRYPOINT, status_code=302, headers={"Location": "https://ads.example/x"}
    )
    httpx_mock.add_response(
        url="https://ads.example/x", text=_entrypoint("senpai-stream.live")
    )
    assert SenpaiSite().base_url() == BASE
