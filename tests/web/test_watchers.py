from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from sestudio import library
from sestudio.config import AppConfig
from sestudio.models import Episode, SeasonCard, StreamSource
from sestudio.sites import ContentSite, PageResult
from sestudio.sites.base import SiteError
from sestudio.watchers import poller
from sestudio.watchers.autodownload import auto_download
from sestudio.web.worker import JobStore
from sestudio.watchers.engine import TransientEmptyResult, UnsupportedKind, poll_once
from sestudio.watchers.models import Watcher
from sestudio.web.app import create_app


class ScriptedSite(ContentSite):
    """A site whose page can be rewritten between polls, so a test can script
    "episode 2 appeared" or "VF landed" as a sequence."""

    id = "scripted"
    display_name = "Scripted"

    def __init__(self) -> None:
        self.page = PageResult(season=1, episodes=[], is_film=False, available_langs=[])
        self.error: Exception | None = None
        self.cards: list[SeasonCard] = []
        self.fetches = 0

    def set_episodes(self, spec: dict[int, list[str]], langs: list[str] | None = None):
        """spec maps episode number -> the languages the site reports for it."""
        self.page = PageResult(
            season=1,
            episodes=[
                Episode(
                    number=number,
                    title=f"Ep {number}",
                    season=1,
                    embed_urls={"direct": f"https://scripted.example/e{number}"},
                    langs=list(codes),
                )
                for number, codes in sorted(spec.items())
            ],
            is_film=False,
            available_langs=langs
            if langs is not None
            else sorted({c for codes in spec.values() for c in codes}),
        )

    def search(self, query: str) -> list[SeasonCard]:
        if self.error is not None:
            raise self.error
        return self.cards

    def fetch_page(self, url: str, lang: str = "vf") -> PageResult:
        self.fetches += 1
        if self.error is not None:
            raise self.error
        return self.page

    def owns_url(self, url: str) -> bool:
        return url.startswith("https://scripted.example/")

    def resolve_candidate(self, candidate, host_resolvers):
        # Direct-stream site: no shared host resolver involved.
        return StreamSource(
            url=candidate.embed_url + ".mp4",
            referer="https://scripted.example/",
            provider=candidate.provider,
        )


@pytest.fixture()
def site(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    library.reset_connection()
    yield ScriptedSite()
    library.reset_connection()


@pytest.fixture()
def sites(site):
    return {"scripted": site}


def _make_watcher(kind: str = "title_lang", **config) -> Watcher:
    row = library.watcher_create(
        kind,
        {
            "page_url": "https://scripted.example/naruto",
            "source": "scripted",
            "langs": config.pop("langs", []),
            "fetch_lang": config.pop("fetch_lang", "vf"),
            "series_name": "Naruto",
            "poster_url": "",
            **config,
        },
        label="Naruto",
    )
    return Watcher.from_row(row)


def _reload(watcher: Watcher) -> Watcher:
    """Re-read the row, so failure counts and schedules are current."""
    row = library.watcher_get(watcher.id)
    assert row is not None
    return Watcher.from_row(row)


# --- the diff ---------------------------------------------------------------- #


def test_first_poll_fires_nothing(site, sites):
    watcher = _make_watcher()
    site.set_episodes({1: ["vostfr"]})
    assert poll_once(watcher, sites) == []
    assert library.watcher_seen_count(watcher.id) > 0


def test_a_new_episode_fires_once(site, sites):
    watcher = _make_watcher()
    site.set_episodes({1: ["vostfr"]})
    poll_once(watcher, sites)

    site.set_episodes({1: ["vostfr"], 2: ["vostfr"]})
    events = poll_once(watcher, sites)
    assert [e["item_key"] for e in events] == ["eplang|01|0002|vostfr"]

    assert poll_once(watcher, sites) == []


def test_a_new_language_on_an_existing_episode_fires(site, sites):
    """The headline requirement: VF arriving on an episode that already had
    VOSTFR is news, even though the episode itself is not new."""
    watcher = _make_watcher()
    site.set_episodes({1: ["vostfr"], 2: ["vostfr"]})
    poll_once(watcher, sites)

    site.set_episodes({1: ["vostfr", "vf"], 2: ["vostfr"]})
    keys = [e["item_key"] for e in poll_once(watcher, sites)]

    assert "eplang|01|0001|vf" in keys
    # And the coarse "this title now has VF at all" signal, once only.
    assert "titlelang|vf" in keys
    assert poll_once(watcher, sites) == []


def test_a_language_filter_narrows_what_is_reported(site, sites):
    """series_episodes is title_lang plus a filter — the same differ, so a
    vf-only watcher must ignore a vostfr arrival."""
    watcher = _make_watcher("series_episodes", langs=["vf"])
    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)

    site.set_episodes({1: ["vf"], 2: ["vostfr"]})
    assert poll_once(watcher, sites) == []

    site.set_episodes({1: ["vf"], 2: ["vostfr", "vf"]})
    assert [e["item_key"] for e in poll_once(watcher, sites)] == ["eplang|01|0002|vf"]


def test_one_fetch_sees_every_language(site, sites):
    """Both real sites report each episode's full language list regardless of the
    requested language, so the whole matrix comes back in a single call."""
    watcher = _make_watcher(fetch_lang="vf")
    site.set_episodes({1: ["vostfr", "vf", "vo"]})
    poll_once(watcher, sites)
    assert site.fetches == 1
    assert library.watcher_seen_count(watcher.id) == 6  # 3 episode + 3 title keys


def test_a_site_failure_leaves_the_baseline_untouched(site, sites):
    watcher = _make_watcher()
    site.set_episodes({1: ["vostfr"], 2: ["vostfr"]})
    poll_once(watcher, sites)
    before = library.watcher_seen_count(watcher.id)

    site.error = SiteError("site down")
    with pytest.raises(SiteError):
        poll_once(watcher, sites)

    assert library.watcher_seen_count(watcher.id) == before
    assert library.watcher_unread_count() == 0


def test_an_empty_result_after_a_good_poll_is_treated_as_a_failure(site, sites):
    """A page that briefly parses to nothing must not look like truth, or the
    next good poll would have to re-report the whole season."""
    watcher = _make_watcher()
    site.set_episodes({1: ["vostfr"], 2: ["vostfr"]})
    poll_once(watcher, sites)
    before = library.watcher_seen_count(watcher.id)

    site.set_episodes({})
    with pytest.raises(TransientEmptyResult):
        poll_once(watcher, sites)
    assert library.watcher_seen_count(watcher.id) == before

    # Recovery reports nothing, because nothing actually changed.
    site.set_episodes({1: ["vostfr"], 2: ["vostfr"]})
    assert poll_once(watcher, sites) == []


def test_a_kind_without_a_collector_is_rejected(site, sites):
    """A row this build has no collector for — written by a newer version, or a
    kind since removed. The route validates kinds, so this can only arrive in the
    database, which is why the engine has to guard it too."""
    row = library.watcher_create("kind_from_the_future", {})
    with pytest.raises(UnsupportedKind):
        poll_once(Watcher.from_row(row), sites)


def test_saved_search_reports_new_cards(site, sites):
    row = library.watcher_create("saved_search", {"query": "naruto", "sources": []})
    watcher = Watcher.from_row(row)
    site.cards = [
        SeasonCard(
            newsid="1",
            title="Naruto Saison 1",
            series_name="Naruto",
            season_number=1,
            poster_url="",
            page_url="https://scripted.example/1-naruto.html",
            source="scripted",
        )
    ]
    assert poll_once(watcher, sites) == []

    site.cards.append(
        SeasonCard(
            newsid="2",
            title="Naruto Saison 2",
            series_name="Naruto",
            season_number=2,
            poster_url="",
            page_url="https://scripted.example/2-naruto.html",
            source="scripted",
        )
    )
    events = poll_once(watcher, sites)
    assert [e["title"] for e in events] == ["Naruto Saison 2"]


def test_saved_search_domain_rotation_is_not_a_new_card(site, sites):
    row = library.watcher_create("saved_search", {"query": "naruto", "sources": []})
    watcher = Watcher.from_row(row)
    site.cards = [
        SeasonCard(
            newsid="1",
            title="Naruto",
            series_name="Naruto",
            season_number=1,
            poster_url="",
            page_url="https://old.example/tv-show/naruto?sn=1&sid=4",
            source="scripted",
        )
    ]
    poll_once(watcher, sites)

    site.cards[0].page_url = "https://new.example/tv-show/naruto?sn=1&sid=4"
    assert poll_once(watcher, sites) == []


# --- outcome bookkeeping ----------------------------------------------------- #


def test_run_watcher_records_success_and_reschedules(site, sites):
    watcher = _make_watcher()
    site.set_episodes({1: ["vf"]})
    outcome = poller.run_watcher(watcher, sites)

    assert outcome.error is None
    row = library.watcher_get(watcher.id)
    assert row["consecutive_failures"] == 0
    assert row["last_ok_at"] is not None
    assert row["next_poll_at"] > row["last_ok_at"]


def test_run_watcher_backs_off_on_repeated_failure(site, sites):
    watcher = _make_watcher()
    site.error = SiteError("down")

    first = poller.run_watcher(watcher, sites)
    assert first.failures == 1
    gap_one = library.watcher_get(watcher.id)["next_poll_at"]

    second = poller.run_watcher(_reload(watcher), sites)
    assert second.failures == 2
    # Each failure pushes the next attempt further out.
    assert library.watcher_get(watcher.id)["next_poll_at"] > gap_one


def test_a_failing_watcher_reports_once_then_is_disabled(site, sites):
    watcher = _make_watcher()
    site.error = SiteError("down")

    for _ in range(poller.ERROR_EVENT_THRESHOLD):
        poller.run_watcher(_reload(watcher), sites)
    errors = [
        e for e in library.watcher_event_list() if e["event_type"] == "watcher_error"
    ]
    assert len(errors) == 1

    # Still one, several ticks later: an outage is one row, not one per tick.
    for _ in range(5):
        poller.run_watcher(_reload(watcher), sites)
    errors = [
        e for e in library.watcher_event_list() if e["event_type"] == "watcher_error"
    ]
    assert len(errors) == 1

    while _reload(watcher).consecutive_failures < poller.DISABLE_THRESHOLD:
        poller.run_watcher(_reload(watcher), sites)
    row = library.watcher_get(watcher.id)
    assert row["enabled"] is False
    assert any(
        e["event_type"] == "watcher_disabled" for e in library.watcher_event_list()
    )


def test_an_unsupported_kind_is_disabled_rather_than_retried(site, sites):
    row = library.watcher_create("kind_from_the_future", {})
    outcome = poller.run_watcher(Watcher.from_row(row), sites)
    assert outcome.disabled is True
    assert library.watcher_get(row["id"])["enabled"] is False


def test_a_rotated_domain_is_repaired_and_the_poll_retried(site, sites, monkeypatch):
    """Senpai's page URLs go stale on every TLD move. Without the repair, every
    watcher pointing at it would fail permanently."""
    watcher = _make_watcher()
    site.set_episodes({1: ["vf"]})
    poller.run_watcher(watcher, sites)

    # The site now lives somewhere else, and the stored URL 404s.
    monkeypatch.setattr(site, "base_url", "https://moved.example", raising=False)
    stale = "https://scripted.example/naruto"
    calls: list[str] = []
    original = site.fetch_page

    def fetch(url: str, lang: str = "vf"):
        calls.append(url)
        if url == stale:
            raise SiteError("404")
        return original(url, lang)

    monkeypatch.setattr(site, "fetch_page", fetch)
    outcome = poller.run_watcher(_reload(watcher), sites)

    assert outcome.error is None
    assert calls == [stale, "https://moved.example/naruto"]
    assert (
        library.watcher_get(watcher.id)["config"]["page_url"]
        == "https://moved.example/naruto"
    )


def test_only_due_watchers_are_polled(site, sites):
    due = _make_watcher()
    library.watcher_update(due.id, next_poll_at=0)
    later = _make_watcher()
    library.watcher_update(later.id, next_poll_at=2**31)

    ids = {row["id"] for row in library.watcher_list_due(1000)}
    assert ids == {due.id}


def test_a_tick_polls_at_most_the_per_tick_cap(site, sites, monkeypatch):
    for _ in range(poller._MAX_PER_TICK + 2):
        watcher = _make_watcher()
        library.watcher_update(watcher.id, next_poll_at=0)
    site.set_episodes({1: ["vf"]})

    app = create_app()
    app.state.sites = sites
    outcomes = asyncio.run(poller._tick(app))

    assert len(outcomes) == poller._MAX_PER_TICK
    # The overflow keeps its due time, so it leads the queue on the next tick
    # instead of being pushed back.
    assert len(library.watcher_list_due(1000)) == 2


def test_the_poller_survives_a_failing_tick(site, sites, monkeypatch):
    monkeypatch.setattr(poller, "WATCHER_TICK_SECONDS", 0)
    calls = {"n": 0}

    async def flaky(app):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return []

    monkeypatch.setattr(poller, "_tick", flaky)

    async def run() -> None:
        app = create_app()
        app.state.sites = sites
        task = asyncio.create_task(poller.run_poller(app))
        while calls["n"] < 3:
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert calls["n"] >= 3


def test_the_poller_is_off_when_the_kill_switch_is_set(monkeypatch):
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    assert poller.watchers_enabled() is False
    monkeypatch.setenv("SESTUDIO_WATCHERS", "1")
    assert poller.watchers_enabled() is True


def test_entering_the_lifespan_with_watchers_off_does_no_polling(site, monkeypatch):
    """Existing route tests enter the lifespan; the kill switch keeps them from
    reaching the network."""
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    watcher = _make_watcher()
    library.watcher_update(watcher.id, next_poll_at=0)

    app = create_app()
    app.state.sites = {"scripted": site}
    with TestClient(app):
        pass
    assert site.fetches == 0


# --- the HTTP surface -------------------------------------------------------- #


@pytest.fixture()
def client(site):
    app = create_app()
    app.state.sites = {"scripted": site}
    return TestClient(app)


def test_watcher_crud_round_trip(client, site):
    site.set_episodes({1: ["vostfr"]})

    created = client.post(
        "/api/watchers",
        json={
            "kind": "title_lang",
            "label": "Naruto",
            "config": {
                "page_url": "https://scripted.example/naruto",
                "source": "scripted",
            },
        },
    )
    assert created.status_code == 201
    watcher_id = created.json()["id"]
    assert created.json()["enabled"] is True
    assert created.json()["auto_download"] is False

    assert len(client.get("/api/watchers").json()) == 1

    patched = client.patch(
        f"/api/watchers/{watcher_id}",
        json={"auto_download": True, "label": "Naruto VF"},
    )
    assert patched.json()["auto_download"] is True
    assert patched.json()["label"] == "Naruto VF"

    assert client.delete(f"/api/watchers/{watcher_id}").status_code == 200
    assert client.get("/api/watchers").json() == []


def test_creating_a_watcher_validates_kind_and_config(client):
    assert (
        client.post(
            "/api/watchers", json={"kind": "nonsense", "config": {}}
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/watchers", json={"kind": "title_lang", "config": {}}
        ).status_code
        == 422
    )


def test_interval_is_clamped_to_a_polite_minimum(client):
    created = client.post(
        "/api/watchers",
        json={
            "kind": "title_lang",
            "config": {"page_url": "https://scripted.example/n", "source": "scripted"},
            "interval_seconds": 5,
        },
    )
    assert created.json()["interval_seconds"] == 300


def test_manual_poll_baselines_then_reports(client, site):
    site.set_episodes({1: ["vostfr"]})
    created = client.post(
        "/api/watchers",
        json={
            "kind": "title_lang",
            "config": {"page_url": "https://scripted.example/n", "source": "scripted"},
        },
    )
    watcher_id = created.json()["id"]

    first = client.post(f"/api/watchers/{watcher_id}/poll").json()
    assert first["events"] == [] and first["error"] is None

    site.set_episodes({1: ["vostfr", "vf"]})
    second = client.post(f"/api/watchers/{watcher_id}/poll").json()
    assert "eplang|01|0001|vf" in [e["item_key"] for e in second["events"]]


def test_notification_timeline_and_read_state(client, site):
    site.set_episodes({1: ["vostfr"]})
    created = client.post(
        "/api/watchers",
        json={
            "kind": "title_lang",
            "config": {"page_url": "https://scripted.example/n", "source": "scripted"},
        },
    )
    watcher_id = created.json()["id"]
    client.post(f"/api/watchers/{watcher_id}/poll")
    site.set_episodes({1: ["vostfr", "vf"], 2: ["vf"]})
    client.post(f"/api/watchers/{watcher_id}/poll")

    listing = client.get("/api/notifications").json()
    assert listing["unread"] == len(listing["events"]) > 0
    assert client.get("/api/notifications/unread").json()["count"] == listing["unread"]

    one = listing["events"][0]["id"]
    marked = client.post("/api/notifications/read", json={"ids": [one]}).json()
    assert marked["marked"] == 1
    assert marked["unread"] == listing["unread"] - 1

    assert client.get("/api/notifications?unread_only=true").json()["events"]
    assert (
        client.post("/api/notifications/read", json={"all": True}).json()["unread"] == 0
    )
    assert client.get("/api/notifications?unread_only=true").json()["events"] == []


def test_missing_watcher_is_a_404(client):
    assert client.post("/api/watchers/999/poll").status_code == 404
    assert client.delete("/api/watchers/999").status_code == 404
    assert client.patch("/api/watchers/999", json={"label": "x"}).status_code == 404


def test_mark_read_requires_a_target(client):
    assert client.post("/api/notifications/read", json={}).status_code == 422


# --- auto-download ----------------------------------------------------------- #


@pytest.fixture()
def store(monkeypatch):
    """A real JobStore with the downloader stubbed out to touch the file."""

    def fake_download(source, output_path, **kwargs):
        output_path.write_bytes(b"video")
        return True

    monkeypatch.setattr("sestudio.web.worker.download", fake_download)
    return JobStore(max_workers=2, watcher_max_concurrent=1)


def _cfg(tmp_path) -> AppConfig:
    # An explicit config: load_config() would read (and a save would write) the
    # real ~/.config/sestudio/config.json.
    return AppConfig(output_root=str(tmp_path))


def _run_auto(watcher, events, store, sites, tmp_path) -> int:
    return asyncio.run(
        auto_download(watcher, events, store=store, sites=sites, cfg=_cfg(tmp_path))
    )


def test_auto_download_is_off_by_default(site, sites, store, tmp_path):
    watcher = _make_watcher()
    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vf"], 2: ["vf"]})
    events = poll_once(watcher, sites)

    assert watcher.auto_download is False
    assert _run_auto(watcher, events, store, sites, tmp_path) == 0
    assert store.all_jobs() == []


def test_auto_download_queues_new_episodes_in_the_watcher_lane(
    site, sites, store, tmp_path
):
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vf"], 2: ["vf"], 3: ["vf"]})
    events = poll_once(watcher, sites)

    assert _run_auto(watcher, events, store, sites, tmp_path) == 2
    jobs = store.all_jobs()
    assert len(jobs) == 2
    assert {job.lane for job in jobs} == {"watcher"}
    assert sorted(job.episode_name for job in jobs) == [
        "S01E02 - Ep 2.mp4",
        "S01E03 - Ep 3.mp4",
    ]


def test_auto_download_records_the_job_on_the_event(site, sites, store, tmp_path):
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vf"], 2: ["vf"]})
    events = poll_once(watcher, sites)
    _run_auto(watcher, events, store, sites, tmp_path)

    row = next(
        e for e in library.watcher_event_list() if e["item_key"] == "eplang|01|0002|vf"
    )
    assert row["download_state"] == "queued"
    assert row["job_id"]


def test_auto_download_refetches_once_per_language_not_per_episode(
    site, sites, store, tmp_path
):
    """A whole season landing in one language must cost one page fetch."""
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({n: ["vf"] for n in range(1, 7)})
    events = poll_once(watcher, sites)

    site.fetches = 0
    assert _run_auto(watcher, events, store, sites, tmp_path) == 5
    assert site.fetches == 1


def test_the_coarse_language_event_is_not_downloaded(site, sites, store, tmp_path):
    """ "VF is now available" is a headline, not a file — only episodes queue."""
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vostfr"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vostfr", "vf"]})
    events = poll_once(watcher, sites)

    assert any(e["item_key"] == "titlelang|vf" for e in events)
    # One job for the episode, none for the title-level signal.
    assert _run_auto(watcher, events, store, sites, tmp_path) == 1


def test_an_episode_without_embeds_is_recorded_as_failed_not_re_notified(
    site, sites, store, tmp_path
):
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vf"], 2: ["vf"]})
    events = poll_once(watcher, sites)

    # The site now lists episode 2 but offers nothing playable.
    site.page.episodes = [
        Episode(number=2, title="Ep 2", season=1, embed_urls={}, langs=["vf"])
    ]
    assert _run_auto(watcher, events, store, sites, tmp_path) == 0

    row = next(
        e for e in library.watcher_event_list() if e["item_key"] == "eplang|01|0002|vf"
    )
    assert row["download_state"] == "error"
    # Still seen, so the next poll does not report it all over again.
    assert poll_once(_reload(watcher), sites) == []


def test_a_file_already_on_disk_is_skipped(site, sites, store, tmp_path):
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vf"], 2: ["vf"]})
    events = poll_once(watcher, sites)

    existing = tmp_path / "Naruto" / "Season 01" / "VF" / "S01E02 - Ep 2.mp4"
    existing.parent.mkdir(parents=True, exist_ok=True)
    existing.write_bytes(b"already here")

    assert _run_auto(watcher, events, store, sites, tmp_path) == 0
    assert store.all_jobs() == []
    row = next(
        e for e in library.watcher_event_list() if e["item_key"] == "eplang|01|0002|vf"
    )
    assert row["download_state"] == "skipped"


def test_a_refetch_failure_does_not_lose_the_notification(site, sites, store, tmp_path):
    watcher = _make_watcher()
    library.watcher_update(watcher.id, auto_download=True)
    watcher = _reload(watcher)

    site.set_episodes({1: ["vf"]})
    poll_once(watcher, sites)
    site.set_episodes({1: ["vf"], 2: ["vf"]})
    events = poll_once(watcher, sites)
    assert events

    site.error = SiteError("down")
    assert _run_auto(watcher, events, store, sites, tmp_path) == 0
    # The event is still in the timeline; only the download was lost.
    assert any(
        e["item_key"] == "eplang|01|0002|vf" for e in library.watcher_event_list()
    )
