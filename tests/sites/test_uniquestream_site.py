from __future__ import annotations

import re

import pytest
from pytest_httpx import HTTPXMock

from sestudio.sites import SiteError, StreamCandidate
from sestudio.sites.uniquestream import API, BASE, UniqueStreamSite
from tests.sites.contract import SiteContractMixin

SERIES = {
    "content_id": "S1",
    "title": "Frieren",
    "images": [{"url": "https://img/poster.webp", "type": "poster_tall"}],
    "seasons": [
        {"content_id": "A", "title": "Season 1", "episode_count": 2},
        {"content_id": "B", "title": "Season 2", "episode_count": 1},
    ],
}


def _url(path: str) -> re.Pattern[str]:
    return re.compile(re.escape(f"{API}/{path}") + r"(\?.*)?$")


@pytest.fixture()
def site() -> UniqueStreamSite:
    return UniqueStreamSite()


class TestUniqueStreamContract(SiteContractMixin):
    @pytest.fixture()
    def searchable_query(self, httpx_mock: HTTPXMock) -> str:
        httpx_mock.add_response(
            url=_url("search"),
            json={
                "series": [{"content_id": "S1"}],
                "movies": [{"content_id": "M1", "title": "Suzume", "image": "x"}],
            },
        )
        httpx_mock.add_response(url=_url("series/S1"), json=SERIES)
        return "frieren"


def test_search_expands_seasons_and_keeps_movies(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=_url("search"),
        json={
            "series": [{"content_id": "S1"}],
            "movies": [
                {
                    "content_id": "M1",
                    "title": "Suzume",
                    "image": "https://m/posters/60x90/a.webp",
                }
            ],
        },
    )
    httpx_mock.add_response(url=_url("series/S1"), json=SERIES)
    cards = site.search("frieren")
    assert [(c.season_number, c.is_film) for c in cards] == [
        (1, False),
        (2, False),
        (0, True),
    ]
    # The first season has no season id, so a catalogue card opens the same page.
    assert cards[0].page_url == site.series_url("S1")
    assert cards[1].page_url == site.series_url("S1", "B")
    assert cards[0].series_name == cards[1].series_name == "Frieren"
    assert cards[2].poster_url == "https://m/posters/480x720/a.webp"


def test_fetch_page_lists_langs_and_embeds_wanted_one(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=_url("series/S1"), json=SERIES)
    httpx_mock.add_response(
        url=_url("season/A/episodes"),
        json=[
            {"content_id": "e1", "title": "One", "audio_locales": ["ja-JP", "fr-FR"]},
            {"content_id": "clip", "title": "Recap", "is_clip": True},
            {"content_id": "e2", "title": "Two", "audio_locales": ["ja-JP"]},
        ],
    )
    page = site.fetch_page(site.series_url("S1"), "vf")
    assert page.season == 1
    assert [e.number for e in page.episodes] == [1, 2]
    assert page.episodes[0].embed_urls == {"uniquestream": "episode/e1#vf"}
    # Not dubbed: listed, but nothing to play in VF.
    assert page.episodes[1].embed_urls == {}
    assert page.episodes[1].langs == ["vostfr"]
    assert page.available_langs == ["vf", "vostfr"]


def test_fetch_page_picks_season_from_url(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url=_url("series/S1"), json=SERIES)
    httpx_mock.add_response(
        url=_url("season/B/episodes"),
        json=[{"content_id": "b1", "title": "B one", "audio_locales": []}],
    )
    page = site.fetch_page(site.series_url("S1", "B"), "vostfr")
    assert page.season == 2
    # No locales listed: the original audio is the only version.
    assert page.episodes[0].embed_urls == {"uniquestream": "episode/b1#vostfr"}


def _media(*versions):
    first, *rest = versions
    return {"hls": first, "versions": {"hls": rest}}


def _version(locale, original=False):
    return {
        "locale": locale,
        "original": original,
        "playlist": f"https://cdn/{locale}.m3u8",
        "subtitles": [
            {"language": lang, "url": f"https://subs/{lang}.vtt"}
            for lang in ("en-US", "fr-FR", "de-DE")
        ],
    }


def test_resolve_original_audio_turns_french_subs_on(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=_url("episode/e1/media/hls/ja-JP"),
        json=_media(
            _version("hi-IN"), _version("ja-JP", original=True), _version("fr-FR")
        ),
    )
    src = site.resolve_candidate(
        StreamCandidate("uniquestream", "episode/e1#vostfr"), {}
    )
    assert src.url == "https://cdn/ja-JP.m3u8"
    assert [(s.lang, s.default) for s in src.subtitles] == [
        ("fr-FR", True),
        ("en-US", False),
    ]


def test_resolve_dub_plays_french_audio_without_subs_on(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=_url("episode/e1/media/hls/fr-FR"),
        json=_media(_version("ja-JP", original=True), _version("fr-FR")),
    )
    src = site.resolve_candidate(StreamCandidate("uniquestream", "episode/e1#vf"), {})
    assert src.url == "https://cdn/fr-FR.m3u8"
    assert not any(s.default for s in src.subtitles)


def test_resolve_dub_missing_raises(site, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url=_url("episode/e1/media/hls/fr-FR"),
        json=_media(_version("ja-JP", original=True)),
    )
    with pytest.raises(SiteError):
        site.resolve_candidate(StreamCandidate("uniquestream", "episode/e1#vf"), {})


def test_discover_routes_filters_to_the_endpoint_that_takes_them(
    site, httpx_mock: HTTPXMock
):
    item = {"content_id": "S1", "title": "Frieren", "type": "show", "image": "i"}
    httpx_mock.add_response(url=_url("videos/popular"), json=[item])
    httpx_mock.add_response(url=_url("browse"), json=[item])
    httpx_mock.add_response(url=_url("search"), json={"series": [item], "movies": []})

    plain = site.discover({"sort": "popular"}, 1)
    genre = site.discover({"genres": "romance", "sort": "trending"}, 1)
    narrowed = site.discover({"genres": "romance,comedy", "year": "2023"}, 1)

    browse = [r for r in httpx_mock.get_requests() if "/browse" in str(r.url)][0]
    assert browse.url.params["categories"] == "romance,popular"
    search = [r for r in httpx_mock.get_requests() if "/search" in str(r.url)][0]
    assert (
        search.url.params["genre"] == "romance" and search.url.params["year"] == "2023"
    )
    assert (
        plain["note"] == ""
        and "popularity" in genre["note"]
        and "A–Z" in narrowed["note"]
    )
    opened = plain["cards"][0]["open"]["card"]
    assert (
        opened["page_url"] == site.series_url("S1")
        and opened["source"] == "uniquestream"
    )


def _obfuscate(key: bytes, media_id: str) -> bytes:
    """What the CDN serves as key.bin: the key, padded, AES-CBC'd, base64'd."""
    import base64
    import hashlib

    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    k = hashlib.sha256(f"key{media_id}".encode()).digest()[:16]
    iv = hashlib.sha256(f"iv{media_id}".encode()).digest()[:16]
    enc = Cipher(algorithms.AES(k), modes.CBC(iv)).encryptor()
    return base64.b64encode(enc.update(key + bytes([16]) * 16) + enc.finalize())


def test_key_bin_is_decoded_for_streams_it_resolved(site, httpx_mock: HTTPXMock):
    playlist = "https://cdn/episode/S/A/e1/mid_fr-FR/master.m3u8?sign=x"
    httpx_mock.add_response(
        url=_url("episode/e1/media/hls/fr-FR"),
        json={"media_id": "mid", **_media({**_version("fr-FR"), "playlist": playlist})},
    )
    src = site.resolve_candidate(StreamCandidate("uniquestream", "episode/e1#vf"), {})
    assert src.via_proxy

    key = bytes(range(16))
    fix = site.proxy_fix("https://cdn/episode/S/A/e1/mid_fr-FR/keys/key.bin?sign=y")
    assert fix is not None
    # Asked without the media id, the CDN serves a decoy key.
    assert fix.headers == {"x-am-media-id": "mid"}
    assert fix.transform(_obfuscate(key, "mid")) == key
    # Segments stream through untouched, and so does a key of an unknown stream.
    assert site.proxy_fix("https://cdn/episode/S/A/e1/mid_fr-FR/v/seg-0.png") is None
    assert site.proxy_fix("https://cdn/other/keys/key.bin") is None


def test_web_url_adds_the_slug_the_sites_pages_need(monkeypatch):
    site = UniqueStreamSite()
    monkeypatch.setattr(site, "_series_detail", lambda cid: {"title": "Kaiju No. 8"})
    monkeypatch.setattr(site, "_get", lambda path: {"title": "Suzume"})
    assert site.web_url(f"{BASE}/series/Nz?season=s2") == f"{BASE}/series/Nz/Kaiju-No-8"
    assert site.web_url(f"{BASE}/movie/nf_1") == f"{BASE}/movies/nf_1/Suzume"
    assert site.web_url(f"{BASE}/other") == BASE
