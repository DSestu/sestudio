"""/api/health: site reachability, failing watchers and free disk, no network."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from sestudio import library
from sestudio.web.app import create_app
from sestudio.web.routes import health

GB = 10**9


@pytest.fixture()
def down(monkeypatch):
    """Site urls whose probe fails; every probe is counted in probes."""
    failing: dict[str, str] = {}
    probes: list[str] = []

    def fake_probe(url: str) -> str | None:
        probes.append(url)
        return failing.get(url)

    monkeypatch.setattr(health, "_probe", fake_probe)
    return SimpleNamespace(failing=failing, probes=probes)


@pytest.fixture()
def disk(monkeypatch):
    usage = SimpleNamespace(total=1000 * GB, used=500 * GB, free=500 * GB)
    monkeypatch.setattr(health.shutil, "disk_usage", lambda path: usage)
    return usage


@pytest.fixture()
def client(tmp_path, monkeypatch, down, disk):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    library.reset_connection()
    app = create_app(live_domain="https://fs03.lol")
    for site_id in list(app.state.sites):
        if site_id not in ("fstream", "kisskh"):
            app.state.sites.pop(site_id)
    yield TestClient(app)
    library.reset_connection()


def test_all_good(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["issues"] == []
    assert {s["id"]: s["up"] for s in body["sites"]} == {
        "fstream": True,
        "kisskh": True,
    }
    assert body["watchers"] == {"count": 0, "last_run_at": None, "failing": []}
    assert body["disk"]["free_bytes"] == 500 * GB
    assert body["disk"]["low"] is False


def test_one_site_down(client, down):
    kisskh = client.app.state.sites["kisskh"]
    down.failing[kisskh.home_url] = "ConnectTimeout"
    body = client.get("/api/health").json()
    assert body["ok"] is False
    site = next(s for s in body["sites"] if s["id"] == "kisskh")
    assert site["up"] is False
    assert site["error"] == "ConnectTimeout"
    assert body["issues"] == [
        {"kind": "site", "id": "kisskh", "message": "KissKH is down", "retry": "site"}
    ]


def test_disabled_sites_are_not_probed(client, down):
    client.put("/api/settings", json={"disabled_sites": ["kisskh"]})
    body = client.get("/api/health").json()
    assert [s["id"] for s in body["sites"]] == ["fstream"]
    assert down.probes == ["https://fs03.lol"]


def test_failing_watcher(client):
    failing = library.watcher_create("title_lang", {}, label="Frieren VF")
    row = library.watcher_create("title_lang", {}, label="Ok one")
    library.watcher_record_failure(failing["id"], "site unreachable", 0)
    library.watcher_record_success(row["id"], 0)

    body = client.get("/api/health").json()
    watchers = body["watchers"]
    assert watchers["count"] == 2
    assert watchers["last_run_at"] is not None
    assert [(w["label"], w["error"]) for w in watchers["failing"]] == [
        ("Frieren VF", "site unreachable")
    ]
    assert watchers["failing"][0]["since"] is not None
    assert body["issues"] == [
        {
            "kind": "watcher",
            "id": str(failing["id"]),
            "message": "Watcher 'Frieren VF' failed",
            "retry": "watcher",
        }
    ]


def test_low_disk_comes_first(client, down, disk):
    disk.free = 8 * GB
    down.failing[client.app.state.sites["kisskh"].home_url] = "boom"
    body = client.get("/api/health").json()
    assert body["disk"]["low"] is True
    assert [i["kind"] for i in body["issues"]] == ["disk", "site"]
    assert body["issues"][0]["message"] == "Disk almost full: 8 GB free"


def test_low_disk_by_ratio(client, disk):
    # 40 GB is plenty in bytes but under 5 % of a 1 TB disk.
    disk.total, disk.free = 1000 * GB, 40 * GB
    assert client.get("/api/health").json()["disk"]["low"] is True


def test_site_probes_are_cached(client, down):
    client.get("/api/health")
    client.get("/api/health")
    assert len(down.probes) == 2  # one per site, not per request


def test_retry_reprobes_one_site(client, down):
    kisskh = client.app.state.sites["kisskh"]
    down.failing[kisskh.home_url] = "boom"
    assert client.get("/api/health").json()["ok"] is False

    down.failing.clear()
    entry = client.post("/api/health/sites/kisskh/retry").json()
    assert entry["id"] == "kisskh"
    assert entry["up"] is True
    assert down.probes.count(kisskh.home_url) == 2
    # The fresh result replaces the cached one.
    assert client.get("/api/health").json()["ok"] is True


def test_retry_unknown_site_is_404(client):
    assert client.post("/api/health/sites/nope/retry").status_code == 404


def test_probe_error_marks_the_site_down(monkeypatch):
    def boom(**kwargs):
        raise RuntimeError("no network here")

    monkeypatch.setattr(health, "new_client", boom)
    assert health._probe("https://x.example") == "no network here"
