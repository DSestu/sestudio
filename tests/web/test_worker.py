from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sestudio.models import StreamSource
from sestudio.web.worker import JobStore


@pytest.fixture()
def store():
    return JobStore(max_workers=2)


@pytest.fixture()
def source():
    return StreamSource(url="https://example.com/v.mp4", referer="https://uqload.is/", provider="uqload")


def test_submit_creates_queued_job(store, source, tmp_path):
    with patch("sestudio.web.worker.download", return_value=True) as mock_dl:
        mock_dl.side_effect = lambda *a, **kw: time.sleep(10)  # block so we can inspect
        job = store.submit(source, tmp_path / "ep.mp4", "S01E01")
    assert job.id
    assert job.status in ("queued", "downloading")
    assert job.episode_name == "S01E01"


def test_job_transitions_to_done(store, source, tmp_path):
    with patch("sestudio.web.worker.download", return_value=True):
        job = store.submit(source, tmp_path / "ep.mp4", "S01E01")
        deadline = time.time() + 3
        while time.time() < deadline:
            j = store.get(job.id)
            if j and j.status == "done":
                break
            time.sleep(0.05)
        assert store.get(job.id).status == "done"


def test_job_transitions_to_failed(store, source, tmp_path):
    with patch("sestudio.web.worker.download", return_value=False):
        job = store.submit(source, tmp_path / "ep.mp4", "S01E01")
        deadline = time.time() + 3
        while time.time() < deadline:
            j = store.get(job.id)
            if j and j.status == "failed":
                break
            time.sleep(0.05)
        assert store.get(job.id).status == "failed"


def test_all_jobs_returns_list(store, source, tmp_path):
    with patch("sestudio.web.worker.download", return_value=True) as mock_dl:
        mock_dl.side_effect = lambda *a, **kw: True
        store.submit(source, tmp_path / "ep1.mp4", "S01E01")
        store.submit(source, tmp_path / "ep2.mp4", "S01E02")
        deadline = time.time() + 3
        while time.time() < deadline and len(store.all_jobs()) < 2:
            time.sleep(0.05)
    assert len(store.all_jobs()) == 2
