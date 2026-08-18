from __future__ import annotations

import pytest

from sestudio import library


@pytest.fixture()
def watcher(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    library.reset_connection()
    yield library.watcher_create("title_lang", {"page_url": "u", "source": "fake"})
    library.reset_connection()


def test_first_poll_records_a_baseline_and_fires_nothing(watcher):
    assert watcher["baselined_at"] is None

    assert library.watcher_record_seen(watcher["id"], ["a", "b"]) == []

    assert library.watcher_get(watcher["id"])["baselined_at"] is not None
    assert library.watcher_seen_count(watcher["id"]) == 2


def test_second_poll_reports_only_new_keys(watcher):
    library.watcher_record_seen(watcher["id"], ["a", "b"])
    assert library.watcher_record_seen(watcher["id"], ["a", "b", "c"]) == ["c"]
    # And not again on the poll after that.
    assert library.watcher_record_seen(watcher["id"], ["a", "b", "c"]) == []


def test_a_shrinking_result_retracts_nothing(watcher):
    """Seen-state only ever grows. If an item vanished from the site and came
    back, it must not be reported as new the second time."""
    library.watcher_record_seen(watcher["id"], ["a", "b", "c"])
    assert library.watcher_record_seen(watcher["id"], ["a"]) == []
    assert library.watcher_seen_count(watcher["id"]) == 3
    assert library.watcher_record_seen(watcher["id"], ["a", "b", "c"]) == []


def test_a_first_poll_that_finds_nothing_still_baselines(watcher):
    """A film that is not out yet legitimately yields zero items. If that did not
    count as a baseline, the watcher would fire its whole catalogue later."""
    assert library.watcher_record_seen(watcher["id"], []) == []
    assert library.watcher_get(watcher["id"])["baselined_at"] is not None
    # So the first real result is news.
    assert library.watcher_record_seen(watcher["id"], ["a"]) == ["a"]


def test_baseline_is_per_watcher(watcher):
    other = library.watcher_create("title_lang", {"page_url": "v", "source": "fake"})
    library.watcher_record_seen(watcher["id"], ["a"])
    # The second watcher has its own baseline, so the same key is new to it.
    assert library.watcher_record_seen(other["id"], ["a"]) == []
    assert library.watcher_record_seen(other["id"], ["a", "b"]) == ["b"]
    assert library.watcher_record_seen(watcher["id"], ["a", "b"]) == ["b"]


def test_pending_is_promoted_to_seen_but_never_back(watcher):
    """Stage-1 candidates are parked as 'pending' so they are not re-checked
    constantly; confirming one is what makes it news."""
    library.watcher_record_seen(watcher["id"], ["x"])  # baseline
    assert library.watcher_record_seen(watcher["id"], ["p"], state="pending") == ["p"]
    # Still pending, so it has not been reported as confirmed yet.
    assert library.watcher_pending_keys(watcher["id"], 2**31) == ["p"]

    assert library.watcher_record_seen(watcher["id"], ["p"], state="seen") == ["p"]
    assert library.watcher_pending_keys(watcher["id"], 2**31) == []
    # Now confirmed for good: a later pending write cannot demote it.
    assert library.watcher_record_seen(watcher["id"], ["p"], state="pending") == []
    assert library.watcher_pending_keys(watcher["id"], 2**31) == []


def test_recording_against_a_missing_watcher_is_harmless(watcher):
    assert library.watcher_record_seen(9999, ["a"]) == []


def test_duplicate_events_are_ignored(watcher):
    first = library.watcher_add_event(
        watcher_id=watcher["id"],
        watcher_kind="title_lang",
        event_type="new_item",
        item_key="a",
        title="A",
    )
    second = library.watcher_add_event(
        watcher_id=watcher["id"],
        watcher_kind="title_lang",
        event_type="new_item",
        item_key="a",
        title="A",
    )
    assert first is not None
    assert second is None
    assert library.watcher_unread_count() == 1


def test_error_events_are_not_deduplicated(watcher):
    """Error events carry no item_key, so the partial unique index skips them."""
    for _ in range(2):
        assert (
            library.watcher_add_event(
                watcher_id=watcher["id"],
                watcher_kind="title_lang",
                event_type="watcher_error",
                title="Broken",
            )
            is not None
        )
    assert library.watcher_unread_count() == 2


def test_deleting_a_watcher_keeps_its_events(watcher):
    library.watcher_add_event(
        watcher_id=watcher["id"],
        watcher_kind="title_lang",
        event_type="new_item",
        item_key="a",
        title="A",
    )
    library.watcher_delete(watcher["id"])
    events = library.watcher_event_list()
    assert len(events) == 1
    # Orphaned but readable: the kind is denormalised onto the row.
    assert events[0]["watcher_id"] is None
    assert events[0]["watcher_kind"] == "title_lang"


def test_mark_read_targets_specific_events(watcher):
    ids = [
        library.watcher_add_event(
            watcher_id=watcher["id"],
            watcher_kind="title_lang",
            event_type="new_item",
            item_key=key,
            title=key,
        )
        for key in ("a", "b", "c")
    ]
    assert library.watcher_mark_read([ids[0]]) == 1
    assert library.watcher_unread_count() == 2
    assert library.watcher_mark_read([]) == 0
    assert library.watcher_mark_read() == 2
    assert library.watcher_unread_count() == 0


def test_pruning_drops_read_events_but_never_seen_state(watcher):
    library.watcher_record_seen(watcher["id"], ["a", "b"])
    event_id = library.watcher_add_event(
        watcher_id=watcher["id"],
        watcher_kind="title_lang",
        event_type="new_item",
        item_key="a",
        title="A",
    )
    assert event_id is not None

    # Unread events are kept however old the cutoff makes them look.
    assert library.watcher_prune_events(2**31, max_age_days=0) == 0
    library.watcher_mark_read()
    assert library.watcher_prune_events(2**31, max_age_days=0) == 1

    assert library.watcher_event_list() == []
    assert library.watcher_seen_count(watcher["id"]) == 2
