from __future__ import annotations

from urllib.parse import urlsplit

from sestudio.models import Episode

# Item keys identify a found item *within one watcher* — they are always stored
# alongside a watcher_id, so they only need to be unique per watcher.
#
# The rule that makes them work: a key never contains a URL. Senpai rotates its
# domain every few days, and a hostname in the key would make every item look new
# after each move, re-notifying the entire back catalogue.

_SEP = "|"


def episode_lang_key(season: int, number: int, lang: str) -> str:
    """Key for "episode N is playable in language L".

    Language is part of the key, so a VF episode arriving on a title that already
    had VOSTFR is a genuinely new item rather than a duplicate of the VOSTFR one.
    The zero-padding keeps keys sorting naturally when read by hand.
    """
    return _SEP.join(("eplang", f"{season:02d}", f"{number:04d}", lang.casefold()))


def title_lang_key(lang: str) -> str:
    """Key for "this title now offers language L at all"."""
    return _SEP.join(("titlelang", lang.casefold()))


def film_key(lang: str) -> str:
    """Key for "this film is playable in language L"."""
    return _SEP.join(("film", lang.casefold()))


def card_key(source: str, page_url: str) -> str:
    """Key for a search result. Path-only, so a domain move is not a new item."""
    return _SEP.join(("card", source.casefold(), url_identity(page_url)))


def tmdb_item_key(media_kind: str, tmdb_id: int | str) -> str:
    """Key for a metadata match. Named to stay clear of config.tmdb_key(), which
    returns the API key rather than an item key."""
    return _SEP.join(("tmdb", media_kind.casefold(), str(tmdb_id)))


def url_identity(url: str) -> str:
    """The part of a URL that identifies the title rather than the host.

    Scheme, host and port are dropped because they rotate. Senpai's season
    parameters are kept: ``?sn=`` and ``?sid=`` are what distinguish one season's
    page from another on the same path.
    """
    parts = urlsplit(url)
    path = parts.path.rstrip("/").casefold()
    kept = []
    for chunk in parts.query.split("&"):
        name, _, value = chunk.partition("=")
        if name in ("sn", "sid") and value:
            kept.append(f"{name}={value}")
    if kept:
        return f"{path}?{'&'.join(sorted(kept))}"
    return path


def playable_langs(episode: Episode, fetched_lang: str) -> set[str]:
    """The languages this episode can actually be played in.

    ``Episode.langs`` is authoritative when the site filled it in — both fstream
    and senpai report every language an episode exists in, not just the fetched
    one, which is what lets a single fetch see the whole (episode, language)
    matrix.

    Empty ``langs`` means "the site could not say", not "none": falling back to
    the fetched language keeps a failed probe from looking like a language that
    was never there. Because seen-state is never retracted, a language that
    momentarily vanishes from a probe cannot be rediscovered and re-fired later.
    """
    if episode.langs:
        return {code.strip().casefold() for code in episode.langs if code.strip()}
    return {fetched_lang.casefold()} if episode.embed_urls else set()
