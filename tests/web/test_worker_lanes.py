from __future__ import annotations

import threading
import time
from unittest.mock import patch

import pytest

from sestudio.models import StreamSource
from sestudio.web.worker import JobStore


@pytest.fixture()
def source():
    return StreamSource(
        url="https://example.com/v.mp4", referer="https://uqload.is/", provider="uqload"
    )


class Blocker:
    """A stand-in download that parks until released, so concurrency is observable."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self.running = 0
        self.peak = 0
        self._lock = threading.Lock()

    def __call__(self, *args, **kwargs):
        with self._lock:
            self.running += 1
            self.peak = max(self.peak, self.running)
        try:
            self.release.wait(5)
            return True
        finally:
            with self._lock:
                self.running -= 1

    def wait_for(self, count: int, timeout: float = 3.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                if self.running >= count:
                    return True
            time.sleep(0.02)
        return False


def _statuses(store: JobStore, jobs) -> list[str]:
    return [store.get(job.id).status for job in jobs]


def _finish(store: JobStore, blocker: Blocker) -> None:
    """Wind the store down while the patch is still in place.

    A job left queued would otherwise start after the patch exits and shell out to
    the real yt-dlp, so the test would make network calls on its way out.
    """
    for job in store.all_jobs():
        if job.status not in ("done", "failed", "cancelled"):
            store.cancel(job.id)
    blocker.release.set()
    deadline = time.time() + 3
    while time.time() < deadline and blocker.running:
        time.sleep(0.02)


def test_watcher_jobs_are_capped_at_the_lane_limit(source, tmp_path):
    """Background downloads must not use the whole pool just because it is free."""
    store = JobStore(max_workers=8, watcher_max_concurrent=2)
    blocker = Blocker()
    with patch("sestudio.web.worker.download", new=blocker):
        jobs = [
            store.submit(source, tmp_path / f"w{i}.mp4", f"W{i}", lane="watcher")
            for i in range(5)
        ]
        assert blocker.wait_for(2)
        # Give any over-admission a chance to show up before asserting.
        time.sleep(0.2)
        assert blocker.running == 2
        assert _statuses(store, jobs).count("queued") == 3
        _finish(store, blocker)


def test_a_user_download_starts_while_watcher_jobs_wait(source, tmp_path):
    """The actual point of the lane: background work never makes an interactive
    download queue behind it."""
    store = JobStore(max_workers=8, watcher_max_concurrent=2)
    blocker = Blocker()
    with patch("sestudio.web.worker.download", new=blocker):
        for i in range(5):
            store.submit(source, tmp_path / f"w{i}.mp4", f"W{i}", lane="watcher")
        assert blocker.wait_for(2)

        user = store.submit(source, tmp_path / "user.mp4", "USER")
        assert blocker.wait_for(3), "user job did not start while watcher jobs waited"
        assert store.get(user.id).status == "downloading"
        assert store.get(user.id).lane == "user"
        _finish(store, blocker)


def test_a_finished_watcher_job_admits_the_next_one(source, tmp_path):
    store = JobStore(max_workers=8, watcher_max_concurrent=1)
    first = Blocker()
    with patch("sestudio.web.worker.download", new=first):
        jobs = [
            store.submit(source, tmp_path / f"w{i}.mp4", f"W{i}", lane="watcher")
            for i in range(3)
        ]
        assert first.wait_for(1)
        assert first.running == 1
        first.release.set()
        # All three run in turn rather than only the first.
        deadline = time.time() + 5
        while time.time() < deadline:
            if all(s == "done" for s in _statuses(store, jobs)):
                break
            time.sleep(0.05)
        assert _statuses(store, jobs) == ["done", "done", "done"]


def test_cancelling_a_queued_watcher_job_does_not_consume_a_slot(source, tmp_path):
    store = JobStore(max_workers=8, watcher_max_concurrent=1)
    blocker = Blocker()
    with patch("sestudio.web.worker.download", new=blocker):
        running = store.submit(source, tmp_path / "a.mp4", "A", lane="watcher")
        waiting = store.submit(source, tmp_path / "b.mp4", "B", lane="watcher")
        after = store.submit(source, tmp_path / "c.mp4", "C", lane="watcher")
        assert blocker.wait_for(1)
        assert store.get(waiting.id).status == "queued"

        assert store.cancel(waiting.id) is True
        blocker.release.set()

        deadline = time.time() + 5
        while time.time() < deadline:
            if store.get(after.id).status == "done":
                break
            time.sleep(0.05)
        # The cancelled job never ran, and the one behind it still got its slot.
        assert store.get(waiting.id).status == "cancelled"
        assert store.get(after.id).status == "done"
        assert store.get(running.id).status == "done"


def test_lane_limit_can_be_retuned_live(source, tmp_path):
    store = JobStore(max_workers=8, watcher_max_concurrent=1)
    blocker = Blocker()
    with patch("sestudio.web.worker.download", new=blocker):
        for i in range(4):
            store.submit(source, tmp_path / f"w{i}.mp4", f"W{i}", lane="watcher")
        assert blocker.wait_for(1)
        assert blocker.running == 1

        store.set_lane_limit(3)
        assert blocker.wait_for(3), "raising the limit did not admit waiting jobs"
        _finish(store, blocker)


def test_user_lane_is_the_default_and_is_unthrottled(source, tmp_path):
    store = JobStore(max_workers=8, watcher_max_concurrent=1)
    blocker = Blocker()
    with patch("sestudio.web.worker.download", new=blocker):
        jobs = [store.submit(source, tmp_path / f"u{i}.mp4", f"U{i}") for i in range(4)]
        assert blocker.wait_for(4), "user downloads were throttled"
        assert all(job.lane == "user" for job in jobs)
        _finish(store, blocker)
