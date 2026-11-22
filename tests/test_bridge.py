"""A sestudio as a bridge to another home's network (SPEC-storage §10, PR 18):
what it says about its Wi-Fi, and a bridge storage reading it, end to end."""

from __future__ import annotations

import json
import socket
import threading
import time

import pytest
import uvicorn
from fastapi.testclient import TestClient

from sestudio import bridge, library, storage
from sestudio.config import config_dir
from sestudio.web.app import create_app


def test_wifi_names_from_the_os():
    netsh = """
    Name                   : Wi-Fi
    State                  : connected
    SSID                   : Freebox-1A2B3C
    BSSID                  : aa:bb:cc:dd:ee:ff
"""
    assert bridge.parse_netsh(netsh) == "Freebox-1A2B3C"
    assert bridge.parse_netsh("There is no wireless interface") is None
    assert bridge.parse_nmcli("no:Other\nyes:Free\\:box\n") == "Free:box"
    assert bridge.parse_nmcli("no:Other\n") is None


def test_android_tells_the_wifi_and_asks_for_the_permission(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    bridge.forget()
    (config_dir() / bridge.ANDROID_FILE).write_text(
        json.dumps({"wifi": "Freebox-1A2B3C", "permission": True})
    )
    assert bridge.info()["wifi"] == "Freebox-1A2B3C"
    bridge.forget()
    (config_dir() / bridge.ANDROID_FILE).write_text(
        json.dumps({"wifi": None, "permission": False})
    )
    got = bridge.info()
    assert got["wifi"] is None and got["wifi_blocked"]
    assert (config_dir() / bridge.WANTED_FILE).exists()  # the app asks, once
    bridge.forget()


@pytest.fixture()
def phone(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    library.reset_connection()
    storage._state.clear()
    storage._networks.clear()
    bridge.forget()
    (config_dir()).mkdir(parents=True, exist_ok=True)
    (config_dir() / bridge.ANDROID_FILE).write_text(
        json.dumps({"wifi": "Freebox-1A2B3C", "permission": True})
    )
    app = create_app()
    c = TestClient(app)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    token = c.post("/api/music/share-tokens", json={"label": "home"}).json()["token"]
    yield c, f"http://127.0.0.1:{port}", token
    server.should_exit = True
    bridge.forget()
    library.reset_connection()


def test_a_bridge_says_its_wifi_only_with_the_token(phone):
    c, _, token = phone
    assert c.get("/api/share/bridge").status_code == 401
    got = c.get(
        "/api/share/bridge", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert got["wifi"] == "Freebox-1A2B3C" and got["name"]


def test_a_bridge_storage_shows_where_it_is(phone):
    # One app plays both the phone and home: the storage points at itself.
    c, url, token = phone
    s = c.post("/api/storages", json={"kind": "remote_sestudio", "roles": ["video"], "url": url,
               "token": token, "label": "Pixel 7", "bridge": True}).json()  # fmt: skip
    assert s["bridge"] is True and s["state"] == "online"
    assert s["network"]["wifi"] == "Freebox-1A2B3C"
    # Not a bridge any more: no network said.
    off = c.patch(f"/api/storages/{s['id']}", json={"bridge": False}).json()
    assert "bridge" not in off
    storage._state.clear()
    assert "network" not in c.get("/api/storages").json()[-1]


def test_only_another_sestudio_is_a_bridge(phone):
    c, _, _ = phone
    assert c.patch("/api/storages/local", json={"bridge": True}).status_code == 400


# --- looking around (PR 19) ------------------------------------------------------


def test_one_row_per_address_and_kind_with_the_announced_name():
    from sestudio import nearby

    rows = nearby.merge([
        {"name": "192.168.1.254", "kind": "smb", "host": "192.168.1.254", "port": 445},
        {"name": "Freebox Server", "kind": "media", "host": "192.168.1.254", "port": None},
        {"name": "192.168.1.254", "kind": "smb", "host": "192.168.1.254", "port": 445},
        {"name": "192.168.1.254", "kind": "ftp", "host": "192.168.1.254", "port": 21},
    ])  # fmt: skip
    assert [(r["name"], r["kind"]) for r in rows] == [
        ("Freebox Server", "smb"), ("Freebox Server", "ftp"), ("Freebox Server", "media"),
    ]  # fmt: skip


def test_the_box_is_looked_for_and_tailscale_left_out(monkeypatch):
    from sestudio import dlna, nearby

    monkeypatch.setattr(dlna, "_local_ipv4s", lambda: ["192.168.1.20", "100.101.7.22"])
    assert nearby._lan_ipv4s() == ["192.168.1.20"]
    assert nearby._boxes(["192.168.1.20"]) == ["192.168.1.1", "192.168.1.254"]


def test_a_port_that_answers_is_found():
    from sestudio import nearby

    with socket.socket() as srv:
        srv.bind(("127.0.0.1", 0))
        srv.listen()
        port = srv.getsockname()[1]
        assert nearby._open("127.0.0.1", port)
    with socket.socket() as quiet:  # bound, not listening: refused
        quiet.bind(("127.0.0.1", 0))
        assert not nearby._open("127.0.0.1", quiet.getsockname()[1])


def test_home_asks_the_bridge_to_look_around(phone, monkeypatch):
    from sestudio import nearby

    found = {"found": [{"name": "Freebox Server", "kind": "smb", "host": "192.168.1.254", "port": 445}],
             "seconds": 4.1}  # fmt: skip
    monkeypatch.setattr(nearby, "scan", lambda: found)
    c, url, token = phone
    plain = c.post("/api/storages", json={"kind": "remote_sestudio", "roles": ["video"],
                   "url": url, "token": token}).json()  # fmt: skip
    assert c.get(f"/api/storages/{plain['id']}/nearby").status_code == 400
    c.patch(f"/api/storages/{plain['id']}", json={"bridge": True})
    assert c.get(f"/api/storages/{plain['id']}/nearby").json() == found
    assert c.get("/api/nearby").json() == found
