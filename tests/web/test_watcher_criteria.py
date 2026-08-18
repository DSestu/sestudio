from __future__ import annotations

from datetime import date

import pytest

from sestudio import library
from sestudio.models import SeasonCard
from sestudio.sites import ContentSite, PageResult
from sestudio.tmdb import TmdbDisabled
from sestudio.watchers import criteria, poller
from sestudio.watchers.engine import poll_once
from sestudio.watchers.models import Watcher, validate_config


class CatalogueSite(ContentSite):
    """A site that carries exactly the titles put in `titles`."""

    id = "catalogue"
    display_name = "Catalogue"

    def __init__(self) -> None:
        self.titles: dict[str, int] = {}  # title -> year
        self.searches: list[str] = []
        self.error: Exception | None = None

    def search(self, query: str) -> list[SeasonCard]:
        self.searches.append(query)
        if self.error is not None:
            raise self.error
        out = []
        for title, year in self.titles.items():
            if title.casefold() == query.casefold():
                out.append(
                    SeasonCard(
                        newsid="1",
                        title=title,
                        series_name=title,
                        season_number=0,
                        poster_url="",
                        page_url=f"https://catalogue.example/{title.replace(' ', '-')}",
                        is_film=True,
                        year=year,
                        source=self.id,
                    )
                )
        return out

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        return PageResult(season=0, episodes=[], is_film=True, available_langs=["vf"])


@pytest.fixture()
def site(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    library.reset_connection()
    yield CatalogueSite()
    library.reset_connection()


@pytest.fixture()
def sites(site):
    return {"catalogue": site}


@pytest.fixture()
def discover(monkeypatch):
    """Stand-in for TMDB discover, scriptable per test."""

    state: dict[str, object] = {"cards": [], "calls": []}

    def fake(**kwargs):
        state["calls"].append(kwargs)
        # One page only, so the collector stops after the first call.
        return {"page": 1, "total_pages": 1, "results": list(state["cards"])}

    monkeypatch.setattr(criteria.tmdb, "discover", fake)
    return state


def _card(tmdb_id: int, title: str, year: int = 2026, rating: float = 7.5) -> dict:
    return {
        "tmdb_id": tmdb_id,
        "kind": "movie",
        "title": title,
        "year": year,
        "release_date": f"{year}-01-01",
        "rating": rating,
        "poster_url": "",
        "overview": "",
        "genre_ids": [53],
    }


def _age_pending(watcher: Watcher) -> None:
    """Make parked candidates due for re-check, without waiting a day."""
    conn = library._connect()
    conn.execute(
        "UPDATE watcher_seen SET checked_at = checked_at - ? WHERE watcher_id = ?",
        (criteria._RECHECK_SECONDS + 60, watcher.id),
    )
    conn.commit()


def _watcher(**overrides) -> Watcher:
    config = validate_config(
        "tmdb_criteria",
        {
            "kind": "movie",
            "genres": "53",
            "min_score": 7,
            "min_votes": 100,
            **overrides,
        },
    )
    return Watcher.from_row(library.watcher_create("tmdb_criteria", config))


# --- the metadata gate ------------------------------------------------------- #


def test_filters_are_passed_to_discover_and_sorted_by_date(site, sites, discover):
    """Not popularity: it reshuffles daily, so unseen ids drift onto page 1 forever
    while a real release that never charts is never seen."""
    poll_once(_watcher(), sites)
    call = discover["calls"][0]
    assert call["sort_by"] == "primary_release_date.desc"
    assert call["genres"] == "53"
    assert call["min_score"] == 7
    assert call["min_votes"] == 100


def test_the_date_window_is_materialised_at_poll_time(site, sites, discover):
    """Stored as a relative offset — absolute dates frozen at creation would make
    the watcher stop finding anything a few months on."""
    poll_once(_watcher(window_days=30), sites)
    call = discover["calls"][0]
    assert call["to_date"] == date.today().isoformat()
    start = date.fromisoformat(call["from_date"])
    assert (date.today() - start).days == 30


def test_a_non_numeric_genre_filter_is_dropped(site, sites):
    """TMDB answers a malformed filter with an unfiltered page, which would look
    like a filter that silently does nothing."""
    config = validate_config(
        "tmdb_criteria", {"kind": "movie", "genres": "53,horror,28"}
    )
    assert config["genres"] == "53,28"


def test_score_and_votes_are_clamped(site, sites):
    config = validate_config(
        "tmdb_criteria",
        {"kind": "movie", "min_score": -5, "max_score": 99, "min_votes": -1},
    )
    assert (config["min_score"], config["max_score"], config["min_votes"]) == (
        0.0,
        10.0,
        0,
    )


def test_an_unknown_media_kind_is_rejected(site):
    with pytest.raises(ValueError):
        validate_config("tmdb_criteria", {"kind": "podcast"})


# --- the availability gate --------------------------------------------------- #


def test_nothing_fires_until_a_site_carries_the_title(site, sites, discover):
    """The chosen semantics: a match nothing can be downloaded from is not news."""
    discover["cards"] = [_card(1, "Deep Cover")]
    watcher = _watcher()

    # First poll baselines. Nothing carries it, so it is parked, not reported.
    assert poll_once(watcher, sites) == []
    assert library.watcher_seen_keys(watcher.id, "pending") == {"tmdb|movie|1"}
    assert library.watcher_seen_keys(watcher.id, "seen") == set()

    # A site picks it up. Parked candidates are only re-checked once a day, so
    # this is noticed on the next due re-check rather than the next poll.
    site.titles["Deep Cover"] = 2026
    _age_pending(watcher)
    events = poll_once(watcher, sites)
    assert [e["item_key"] for e in events] == ["tmdb|movie|1"]
    assert library.watcher_seen_keys(watcher.id, "seen") == {"tmdb|movie|1"}

    # And never again.
    assert poll_once(watcher, sites) == []


def test_the_first_poll_never_fires_even_when_available(site, sites, discover):
    discover["cards"] = [_card(1, "Deep Cover")]
    site.titles["Deep Cover"] = 2026
    watcher = _watcher()

    assert poll_once(watcher, sites) == []
    assert library.watcher_get(watcher.id)["baselined_at"] is not None

    # A genuinely new match after the baseline does fire.
    discover["cards"].append(_card(2, "Night Shift"))
    site.titles["Night Shift"] = 2026
    assert [e["item_key"] for e in poll_once(watcher, sites)] == ["tmdb|movie|2"]


def test_event_carries_what_is_needed_to_open_the_title(site, sites, discover):
    discover["cards"] = [_card(1, "Deep Cover", rating=8.1)]
    watcher = _watcher()
    poll_once(watcher, sites)
    site.titles["Deep Cover"] = 2026
    _age_pending(watcher)

    event = poll_once(watcher, sites)[0]
    assert event["data"]["source"] == "catalogue"
    assert event["data"]["page_url"] == "https://catalogue.example/Deep-Cover"
    assert event["data"]["tmdb_id"] == 1
    assert "8.1" in event["subtitle"]
    # Not "episode": a discover card has no episode number, so auto-download
    # must leave these alone rather than guess.
    assert event["data"]["kind"] == "card"


def test_a_year_mismatch_is_not_the_same_title(site, sites, discover):
    """Titles are matched on text, so the year is the only guard against a remake
    decades apart being reported as the new release."""
    discover["cards"] = [_card(1, "The Thing", year=2026)]
    site.titles["The Thing"] = 1982
    watcher = _watcher()
    poll_once(watcher, sites)
    assert poll_once(watcher, sites) == []
    assert library.watcher_seen_keys(watcher.id, "pending") == {"tmdb|movie|1"}


# --- bounding the work ------------------------------------------------------- #


def test_confirmations_are_capped_per_poll(site, sites, discover, caplog):
    """Uncapped, one watcher scrapes every site for every new release each tick."""
    discover["cards"] = [_card(i, f"Film {i}") for i in range(1, 26)]
    watcher = _watcher()
    with caplog.at_level("INFO"):
        poll_once(watcher, sites)

    assert len(site.searches) == criteria._MAX_CONFIRMATIONS
    # The cap is logged rather than silent, so "covered everything" is never implied.
    assert any("candidates to confirm" in r.message for r in caplog.records)


def test_a_parked_candidate_is_not_rechecked_every_poll(site, sites, discover):
    discover["cards"] = [_card(1, "Deep Cover")]
    watcher = _watcher()
    poll_once(watcher, sites)
    assert len(site.searches) == 1

    # Second poll the same day: left alone.
    poll_once(watcher, sites)
    assert len(site.searches) == 1


def test_a_parked_candidate_is_rechecked_once_stale(site, sites, discover):
    discover["cards"] = [_card(1, "Deep Cover")]
    watcher = _watcher()
    poll_once(watcher, sites)

    _age_pending(watcher)
    site.titles["Deep Cover"] = 2026
    assert [e["item_key"] for e in poll_once(watcher, sites)] == ["tmdb|movie|1"]


def test_stale_candidates_age_out(site, sites, discover):
    """Pending rows are the only ones ever deleted — safe precisely because they
    never fired."""
    discover["cards"] = [_card(1, "Deep Cover")]
    watcher = _watcher()
    poll_once(watcher, sites)
    assert library.watcher_seen_keys(watcher.id, "pending")

    conn = library._connect()
    conn.execute(
        "UPDATE watcher_seen SET first_seen_at = first_seen_at - ? WHERE watcher_id = ?",
        (criteria._PENDING_TTL_SECONDS + 60, watcher.id),
    )
    conn.commit()

    discover["cards"] = []
    poll_once(watcher, sites)
    assert library.watcher_seen_keys(watcher.id, "pending") == set()


def test_a_quiet_poll_is_not_treated_as_a_failure(site, sites, discover):
    """Unlike a season page, a criteria collector returning nothing is the normal
    steady state — guarding on it would disable a healthy watcher within a day."""
    discover["cards"] = [_card(1, "Deep Cover")]
    site.titles["Deep Cover"] = 2026
    watcher = _watcher()
    poll_once(watcher, sites)

    for _ in range(3):
        outcome = poller.run_watcher(_reload(watcher), sites)
        assert outcome.error is None
    assert library.watcher_get(watcher.id)["consecutive_failures"] == 0
    assert library.watcher_get(watcher.id)["enabled"] is True


def test_no_api_key_leaves_the_watcher_idle_not_broken(site, sites, monkeypatch):
    """Otherwise clearing the key auto-disables every criteria watcher in a day."""

    def no_key(**kwargs):
        raise TmdbDisabled("No TMDB API key configured")

    monkeypatch.setattr(criteria.tmdb, "discover", no_key)
    watcher = _watcher()
    outcome = poller.run_watcher(watcher, sites)

    assert outcome.error is None
    row = library.watcher_get(watcher.id)
    assert row["consecutive_failures"] == 0
    assert row["enabled"] is True
    assert row["next_poll_at"] > 0


def test_a_failing_site_does_not_hide_the_others(site, sites, discover):
    discover["cards"] = [_card(1, "Deep Cover")]
    other = CatalogueSite()
    other.id = "other"
    other.titles["Deep Cover"] = 2026
    site.error = RuntimeError("down")
    watcher = _watcher()
    poll_once(watcher, {"catalogue": site, "other": other})

    assert [
        e["item_key"] for e in poll_once(watcher, {"catalogue": site, "other": other})
    ] == []
    # Baseline consumed the first sighting; the second poll is where it would fire,
    # and it did not, because the baseline already recorded it as available.
    assert library.watcher_seen_keys(watcher.id, "seen") == {"tmdb|movie|1"}


def _reload(watcher: Watcher) -> Watcher:
    row = library.watcher_get(watcher.id)
    assert row is not None
    return Watcher.from_row(row)
