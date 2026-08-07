"""Per-site enable/disable: /api/sites plus the search fan-out it controls."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sestudio.web.app import create_app
from tests.web.conftest import FakeSite


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Point the config at a scratch file so the toggle never touches ~/.config.
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    app = create_app(live_domain="https://fs03.lol")
    app.state.sites.pop("french-manga")
    app.state.sites.pop("senpai")
    return TestClient(app)


def test_lists_registered_sites_as_enabled_by_default(client):
    resp = client.get("/api/sites")
    assert resp.status_code == 200
    sites = resp.json()
    assert [s["id"] for s in sites] == ["fstream"]
    assert sites[0]["display_name"] == "FStream"
    assert sites[0]["enabled"] is True


def test_disabling_a_site_is_persisted_and_reflected(client):
    resp = client.put("/api/settings", json={"disabled_sites": ["fstream"]})
    assert resp.status_code == 200
    assert resp.json()["disabled_sites"] == ["fstream"]
    assert client.get("/api/sites").json()[0]["enabled"] is False


def test_unknown_site_ids_are_rejected(client):
    resp = client.put("/api/settings", json={"disabled_sites": ["fstream", "nope"]})
    assert resp.status_code == 200
    assert resp.json()["disabled_sites"] == ["fstream"]


def test_senpai_is_the_default_preferred_source(client):
    assert client.get("/api/settings").json()["preferred_site"] == "senpai"


def test_preferred_source_can_be_changed(client):
    resp = client.put("/api/settings", json={"preferred_site": "fstream"})
    assert resp.json()["preferred_site"] == "fstream"
    assert client.get("/api/settings").json()["preferred_site"] == "fstream"


def test_unknown_preferred_source_is_ignored(client):
    client.put("/api/settings", json={"preferred_site": "nope"})
    assert client.get("/api/settings").json()["preferred_site"] == "senpai"


def test_disabled_site_is_skipped_by_search(client, httpx_mock):
    """No HTTP is mocked: if search still called the site, it would error."""
    client.put("/api/settings", json={"disabled_sites": ["fstream"]})
    resp = client.get("/api/search?q=stargate")
    assert resp.status_code == 200
    assert resp.json() == []


def test_disabled_site_still_resolves_its_pages(client, httpx_mock):
    """Library entries from a disabled site must keep working."""
    client.put("/api/settings", json={"disabled_sites": ["fstream"]})
    httpx_mock.add_response(
        url="https://fs03.lol/season1", text="<html><body>no config</body></html>"
    )
    resp = client.get("/api/season?url=https://fs03.lol/season1&source=fstream")
    # 502 (the page is not a real season) rather than a routing refusal —
    # the site was still consulted.
    assert resp.status_code == 502


# --- rotating domains are resolved at startup -------------------------------


class _CountingSite(FakeSite):
    """A fake whose refresh() is observable, optionally failing."""

    def __init__(self, site_id: str, fail: bool = False) -> None:
        self.id = site_id
        self.display_name = site_id
        self.refreshed = 0
        self._fail = fail

    def refresh(self) -> None:
        self.refreshed += 1
        if self._fail:
            raise RuntimeError("entrypoint down")


def test_domains_are_resolved_when_the_server_starts(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    app = create_app(live_domain="https://fs03.lol")
    sites = {"a": _CountingSite("a"), "b": _CountingSite("b")}
    app.state.sites = sites

    # Entering the context runs the lifespan, which is what startup does.
    with TestClient(app):
        pass

    assert [s.refreshed for s in sites.values()] == [1, 1]


def test_a_site_that_cannot_be_resolved_does_not_block_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    app = create_app(live_domain="https://fs03.lol")
    healthy = _CountingSite("ok")
    app.state.sites = {"broken": _CountingSite("broken", fail=True), "ok": healthy}

    with TestClient(app) as started:
        # The app still serves, and the reachable site was still refreshed.
        assert started.get("/api/sites").status_code == 200
    assert healthy.refreshed == 1
