from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pytest_httpx import HTTPXMock

from sestudio.models import StreamSource
from sestudio.web.app import create_app
from sestudio.web.proxy import sign
from sestudio.web.worker import DownloadJob

SECRET = b"0123456789abcdef0123456789abcdef"


@pytest.fixture()
def client():
    app = create_app(live_domain="https://fs03.lol")
    app.state.proxy_secret = SECRET
    return TestClient(app)


def _token(url: str) -> str:
    return sign(SECRET, url, "https://uqload.is/", "uqload")


def _staged_job(client, tmp_path: Path, status: str = "done", body: bytes = b"VIDEO"):
    """A device-bound job whose file is already staged on disk.

    Registered directly rather than via ``submit`` so no worker thread runs —
    the point is to exercise serving the result, not to download anything.
    """
    out = tmp_path / "S01E01.mp4"
    out.write_bytes(body)
    job = DownloadJob(
        id="staged-job",
        episode_name="S01E01.mp4",
        source=StreamSource(
            url="https://cdn/x.m3u8", referer="https://uqload.is/", provider="uqload"
        ),
        output_path=out,
        to_device=True,
        status=status,
    )
    client.app.state.job_store._jobs[job.id] = job
    return job


def test_mp4_download_relays_with_attachment_headers(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="https://cdn.example/v.mp4",
        content=b"MP4BYTES",
        headers={"content-type": "video/mp4", "content-length": "8"},
    )
    resp = client.get(
        "/api/downloads/stream",
        params={
            "token": _token("https://cdn.example/v.mp4"),
            "filename": "S01E01 - Pilot.mp4",
        },
    )
    assert resp.status_code == 200
    assert resp.content == b"MP4BYTES"
    cd = resp.headers["content-disposition"]
    assert cd.startswith("attachment;")
    assert "S01E01 - Pilot.mp4" in cd
    assert resp.headers["content-type"] == "video/mp4"
    assert resp.headers["content-length"] == "8"
    # The upstream fetch carries the provider referer, never exposed to the client.
    sent = httpx_mock.get_requests()[0]
    assert sent.headers["referer"] == "https://uqload.is/"


def test_filename_gets_mp4_extension(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url="https://cdn.example/v.mp4", content=b"x")
    resp = client.get(
        "/api/downloads/stream",
        params={"token": _token("https://cdn.example/v.mp4"), "filename": "Episode 1"},
    )
    assert resp.status_code == 200
    assert 'filename="Episode 1.mp4"' in resp.headers["content-disposition"]


def test_hls_source_is_not_relayed(client):
    """HLS is a playlist, not a file: the UI must route it through a job."""
    resp = client.get(
        "/api/downloads/stream",
        params={
            "token": _token("https://cdn.example/master.m3u8"),
            "filename": "ep.mp4",
        },
    )
    assert resp.status_code == 409
    assert "server job" in resp.json()["detail"]


def test_finished_device_job_serves_its_file(client, tmp_path):
    job = _staged_job(client, tmp_path)
    resp = client.get(f"/api/downloads/{job.id}/file")
    assert resp.status_code == 200
    assert resp.content == b"VIDEO"
    assert 'filename="S01E01.mp4"' in resp.headers["content-disposition"]


def test_unfinished_device_job_is_409(client, tmp_path):
    """The file doesn't exist yet — don't hand the browser a broken download."""
    job = _staged_job(client, tmp_path, status="downloading")
    resp = client.get(f"/api/downloads/{job.id}/file")
    assert resp.status_code == 409


def test_device_job_file_gone_is_410(client, tmp_path):
    job = _staged_job(client, tmp_path)
    job.output_path.unlink()
    resp = client.get(f"/api/downloads/{job.id}/file")
    assert resp.status_code == 410


def test_unknown_job_file_404(client):
    resp = client.get("/api/downloads/does-not-exist/file")
    assert resp.status_code == 404


def test_clearing_history_removes_staged_device_files(client, tmp_path):
    """Temp files exist only to be collected — they must not accumulate."""
    job = _staged_job(client, tmp_path)
    assert job.output_path.exists()
    client.delete("/api/downloads")
    assert not job.output_path.exists()


def test_invalid_token_403(client):
    resp = client.get(
        "/api/downloads/stream",
        params={"token": "not-a-token", "filename": "ep.mp4"},
    )
    assert resp.status_code == 403


def test_upstream_error_maps_to_502(client, httpx_mock: HTTPXMock):
    httpx_mock.add_response(url="https://cdn.example/v.mp4", status_code=403)
    resp = client.get(
        "/api/downloads/stream",
        params={"token": _token("https://cdn.example/v.mp4"), "filename": "ep.mp4"},
    )
    assert resp.status_code == 502
