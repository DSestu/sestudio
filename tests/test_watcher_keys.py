from __future__ import annotations

import pytest

from sestudio.models import Episode
from sestudio.watchers.keys import (
    episode_lang_key,
    playable_langs,
    url_identity,
)


def test_language_is_part_of_the_episode_key():
    """The load-bearing property: VF landing on an episode that already had
    VOSTFR must look like a new item, not a duplicate of the VOSTFR one."""
    before = Episode(
        number=5, title="E5", season=1, embed_urls={"x": "u"}, langs=["vostfr"]
    )
    after = Episode(
        number=5, title="E5", season=1, embed_urls={"x": "u"}, langs=["vostfr", "vf"]
    )

    keys_before = {
        episode_lang_key(1, 5, lang) for lang in playable_langs(before, "vf")
    }
    keys_after = {episode_lang_key(1, 5, lang) for lang in playable_langs(after, "vf")}

    assert keys_after - keys_before == {"eplang|01|0005|vf"}


@pytest.mark.parametrize(
    "url",
    [
        "https://senpai-stream.wiki/tv-show/naruto?sn=2&sid=9",
        "https://senpai-stream.xyz/tv-show/naruto?sn=2&sid=9",
        "http://senpai-stream.top:8080/tv-show/naruto/?sid=9&sn=2",
    ],
)
def test_url_identity_survives_domain_rotation(url):
    """Senpai moves TLD every few days; a hostname in the key would make every
    item look new after each move."""
    assert url_identity(url) == "/tv-show/naruto?sid=9&sn=2"


def test_url_identity_keeps_seasons_distinct():
    one = url_identity("https://s.example/tv-show/naruto?sn=1&sid=4")
    two = url_identity("https://s.example/tv-show/naruto?sn=2&sid=9")
    assert one != two


def test_url_identity_drops_unrelated_query_params():
    assert url_identity("https://s.example/movie/x?utm=abc") == "/movie/x"


def test_episode_key_is_zero_padded_and_lowercased():
    assert episode_lang_key(1, 5, "VF") == "eplang|01|0005|vf"
    assert episode_lang_key(12, 340, "vostfr") == "eplang|12|0340|vostfr"


def test_playable_langs_uses_the_sites_own_language_list():
    episode = Episode(
        number=1, title="E1", season=1, embed_urls={}, langs=["VF", " vostfr "]
    )
    # Reported languages win even when this fetch returned no embeds: an episode
    # listed in another language is still real, just not playable in this one.
    assert playable_langs(episode, "vf") == {"vf", "vostfr"}


def test_playable_langs_falls_back_to_the_fetched_language():
    """Empty langs means "the site could not say", not "no languages"."""
    with_embeds = Episode(
        number=1, title="E1", season=1, embed_urls={"x": "u"}, langs=[]
    )
    assert playable_langs(with_embeds, "vostfr") == {"vostfr"}

    without = Episode(number=1, title="E1", season=1, embed_urls={}, langs=[])
    assert playable_langs(without, "vostfr") == set()
