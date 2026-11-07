"""/api/servers: the registry of other sestudio servers, their checks, trust and the switch."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from sestudio.config import load_config
from sestudio.web.app import create_app
from sestudio.web.routes import servers


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    up: dict[str, bool] = {"pc": True}

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "pc.test" and up["pc"]:
            return httpx.Response(200, json={"ok": True, "version": "1.6.3"})
        raise httpx.ConnectError("down")

    monkeypatch.setattr(servers, "transport", httpx.MockTransport(handle))
    # MockTransport has no TLS socket: the fingerprint is whatever the test says.
    fingerprints = {"value": "ab" * 32}
    monkeypatch.setattr(servers, "_fingerprint", lambda r: fingerprints["value"])
    monkeypatch.setattr(servers, "own_fingerprint", lambda: "cd" * 32)
    c = TestClient(create_app())
    c.up, c.fingerprints = up, fingerprints
    return c


def add(c, url="https://pc.test:8443", name="PC maison") -> dict:
    r = c.post("/api/servers", json={"name": name, "url": url + "/"})
    assert r.status_code == 200, r.text
    return r.json()


def test_adding_a_server_checks_it_and_remembers_it(client):
    row = add(client)
    assert row["reachable"] is True
    assert row["version"] == "1.6.3"
    assert row["rtt_ms"] >= 0
    assert row["fingerprint"] == "ab" * 32
    assert row["trusted"] is False  # not accepted yet
    saved = load_config().servers
    assert [s["url"] for s in saved] == ["https://pc.test:8443"]
    assert saved[0]["last_seen"]
    assert (
        client.post(
            "/api/servers", json={"name": "x", "url": "https://pc.test:8443"}
        ).status_code
        == 409
    )
    assert (
        client.post("/api/servers", json={"name": "x", "url": "pc.test"}).status_code
        == 400
    )


def test_a_server_that_is_down_keeps_when_it_was_last_seen(client):
    row = add(client)
    seen = row["last_seen"]
    client.up["pc"] = False
    again = client.post(f"/api/servers/{row['id']}/check").json()
    assert again["reachable"] is False
    assert again["last_seen"] == seen
    assert again["error"]
    client.app.state.https_port = 8443  # as `serve` sets it; tests run without TLS
    listed = client.get("/api/servers").json()
    assert listed["servers"][0]["reachable"] is False
    assert listed["self"]["fingerprint"] == "cd" * 32
    assert all(
        a.startswith("https://") and a.endswith(":8443")
        for a in listed["self"]["addresses"]
    )
    assert listed["self"]["version"]


def test_trust_pins_the_fingerprint_and_a_changed_one_blocks(client):
    row = add(client)
    assert client.put("/api/servers/active", json={"id": row["id"]}).status_code == 409
    trusted = client.post(f"/api/servers/{row['id']}/trust").json()
    assert trusted["trusted"] is True
    assert load_config().servers[0]["fingerprint"] == "ab" * 32

    client.fingerprints["value"] = "ef" * 32
    changed = client.post(f"/api/servers/{row['id']}/check").json()
    assert changed["reachable"] is True
    assert changed["trusted"] is False
    assert client.put("/api/servers/active", json={"id": row["id"]}).status_code == 409


def test_http_needs_no_trust(client):
    row = add(client, url="http://pc.test:8080")
    assert row["trusted"] is True


def test_switching_sets_the_upstream_and_survives_a_restart(
    client, tmp_path, monkeypatch
):
    row = add(client)
    client.post(f"/api/servers/{row['id']}/trust")
    assert client.put("/api/servers/active", json={"id": row["id"]}).json() == {
        "active": row["id"]
    }
    assert client.app.state.upstream["url"] == "https://pc.test:8443"
    assert client.get("/api/servers").json()["servers"][0]["in_use"] is True

    again = TestClient(create_app())
    assert again.app.state.upstream["id"] == row["id"]

    assert client.put("/api/servers/active", json={"id": None}).json() == {
        "active": None
    }
    assert client.app.state.upstream is None
    assert load_config().active_server == ""


def test_removing_the_server_in_use_switches_back(client):
    row = add(client)
    client.post(f"/api/servers/{row['id']}/trust")
    client.put("/api/servers/active", json={"id": row["id"]})
    assert client.delete(f"/api/servers/{row['id']}").json() == {"removed": row["id"]}
    assert client.app.state.upstream is None
    assert client.get("/api/servers").json()["servers"] == []
    assert client.delete(f"/api/servers/{row['id']}").status_code == 404


def test_check_all_probes_every_server(client):
    a = add(client)
    b = add(client, url="https://laptop.test:8443", name="Laptop")
    rows = client.get("/api/servers?check=true").json()["servers"]
    assert {r["id"]: r["reachable"] for r in rows} == {a["id"]: True, b["id"]: False}


def test_health_tells_its_version(client, monkeypatch):
    from sestudio.web.routes import health

    monkeypatch.setattr(health, "_probe", lambda url: None)
    assert client.get("/api/health").json()["version"] == servers.version()
