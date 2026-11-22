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
    (tmp_path / "out").mkdir()
    c.put("/api/settings", json={"output_root": str(tmp_path / "out")})
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


# --- opening a share through a bridge (PR 20) -----------------------------------


@pytest.fixture()
def freebox(phone, monkeypatch):
    """The family's Freebox: an in-memory server the bridge (the same app) opens."""
    import fsspec

    from sestudio import remotefs, vault

    fs = fsspec.filesystem("memory", skip_instance_cache=True)
    fs.store.clear()
    fs.pseudo_dirs.clear()
    fs.pipe("/Disque dur/Films/Heat (1995).mkv", b"0123456789")
    logins: list[str | None] = []

    def fake_open(s, secret=None):
        password = secret or vault.get(s["id"]).get("password")
        logins.append(password)
        if password != "pw":
            raise PermissionError("wrong password")
        return fs

    monkeypatch.setattr(remotefs, "_open", fake_open)
    remotefs._cache.clear()
    c, url, token = phone
    b = c.post("/api/storages", json={"kind": "remote_sestudio", "roles": ["video"], "url": url,
               "token": token, "label": "Pixel 7", "bridge": True}).json()  # fmt: skip
    yield c, b, fs, logins
    for sid in list(storage._temporary):
        storage.close_temporary(sid)


def _open(c, b, password="pw"):
    return c.post("/api/storages", json={
        "kind": "bridged", "via": b["id"], "proto": "smb", "host": "192.168.1.254",
        "share": "Disque dur", "password": password, "label": "Freebox · Mum's", "roles": ["video"],
    })  # fmt: skip


def test_a_wrong_login_is_refused_and_nothing_is_saved(freebox):
    c, b, _, _ = freebox
    r = _open(c, b, "nope")
    assert r.status_code == 400 and "wrong password" in r.json()["detail"]
    assert not any(s["kind"] == "bridged" for s in c.get("/api/storages").json())
    assert storage._temporary == {}


def test_a_share_opens_through_the_bridge_and_its_films_play(freebox, tmp_path):
    from sestudio import vault

    c, b, _, logins = freebox
    s = _open(c, b).json()
    assert s["kind"] == "bridged" and s["via_label"] == "Pixel 7" and s["connected"]
    assert s["wifi"] == "Freebox-1A2B3C"  # remembered for B8
    # home keeps the login; the bridge holds it in memory only
    assert vault.get(s["id"]) == {"password": "pw"}
    assert "pw" not in (tmp_path / "config.json").read_text()
    assert list(storage._temporary) == ["t" + s["id"]]
    listed = c.get("/api/storages").json()
    assert listed[-1]["state"] == "online"
    assert not any(
        x.get("temporary") for x in listed
    )  # the bridge's own copy is not listed
    # listed at home under its own name, with clean paths, once
    for _ in range(100):
        titles = c.get("/api/downloaded").json()
        files = [f for t in titles for f in t["files"] if f.get("storage") == s["id"]]
        if files:
            break
        time.sleep(0.05)
    assert [f["rel"] for f in files] == ["Films/Heat (1995).mkv"]
    others = [f for t in titles for f in t["files"] if f.get("storage") == b["id"]]
    assert others == []  # not again under the phone itself
    got = c.get(
        "/api/downloaded/file",
        params={"path": files[0]["path"]},
        headers={"Range": "bytes=2-5"},
    )
    assert got.status_code == 206 and got.content == b"2345"
    assert logins[-1] == "pw"


def test_disconnect_closes_it_keeps_the_login_and_reconnects(freebox):
    from sestudio import vault

    c, b, _, _ = freebox
    s = _open(c, b).json()
    off = c.patch(f"/api/storages/{s['id']}", json={"connected": False}).json()
    assert off["state"] == "closed" and storage._temporary == {}
    assert vault.get(s["id"]) == {"password": "pw"}  # B14: kept for next time
    assert not any(
        f.get("storage") == s["id"]
        for t in c.get("/api/downloaded").json()
        for f in t["files"]
    )
    on = c.patch(f"/api/storages/{s['id']}", json={"connected": True}).json()
    assert on["connected"] and on["state"] == "online"
    c.delete(f"/api/storages/{s['id']}")
    assert storage._temporary == {} and vault.get(s["id"]) == {}


# --- playing and casting through a bridge (PR 21) -----------------------------


def test_the_phone_serves_a_held_share_itself_while_switched_to_home(freebox):
    """Switched to home (remote servers), the phone's TV asks the phone for a film of
    the share it holds: served from the phone, not fetched back from home."""
    c, b, _, _ = freebox
    s = _open(c, b).json()
    c.app.state.upstream = {
        "name": "Home",
        "url": "http://127.0.0.1:9",
        "fingerprint": None,
    }
    try:
        r = c.get(
            "/api/downloaded/file",
            params={"path": f"{s['id']}:Films/Heat (1995).mkv"},
            headers={"Range": "bytes=0-3"},
        )
    finally:
        c.app.state.upstream = None
    assert r.status_code == 206 and r.content == b"0123"


# --- copying and moving through a bridge (PR 22) -------------------------------


def _done(job_id):
    from sestudio import transfers

    for _ in range(300):
        job = next(j for j in transfers.all_jobs() if j["id"] == job_id)
        if job["status"] in ("done", "failed", "cancelled"):
            return job
        time.sleep(0.02)
    raise AssertionError("the transfer never finished")


def test_copy_both_ways_and_move_home_through_the_bridge(freebox, tmp_path):
    from sestudio import transfers

    c, b, fs, _ = freebox
    s = _open(c, b).json()
    home = tmp_path / "home"
    home.mkdir()
    disk = storage.add("folder", ["video"], "Home disk", str(home))
    films = f"{s['id']}:Films/Heat (1995).mkv"

    # their Freebox → my disk
    job = _done(transfers.create([films], disk["id"], "copy").id)
    assert job["status"] == "done", job["items"]
    assert (home / "Films/Heat (1995).mkv").read_bytes() == b"0123456789"

    # my disk → their Freebox, into another folder
    (home / "Mine.mkv").write_bytes(b"abcdef")
    key = f"{disk['id']}:Mine.mkv"
    job = _done(transfers.create([key], s["id"], "copy", dests=["For Mum/Mine.mkv"]).id)
    assert job["status"] == "done", job["items"]
    assert fs.cat("/Disque dur/For Mum/Mine.mkv") == b"abcdef"
    assert not [p for p in fs.find("/Disque dur") if p.endswith(".part")]

    # a move off their Freebox deletes it there, after the copy checked out
    job = _done(transfers.create([films], disk["id"], "move", "replace").id)
    assert job["status"] == "done", job["items"]
    assert not fs.exists("/Disque dur/Films/Heat (1995).mkv")


def test_a_bridge_only_touches_shares_it_holds(freebox):
    c, b, _, _ = freebox
    token = storage.get(b["id"])["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert (
        c.get(
            "/api/share/bridge/stat", params={"path": "local:x.mkv"}, headers=auth
        ).status_code
        == 404
    )
    s = _open(c, b).json()
    held = f"t{s['id']}:../escape"
    assert (
        c.get("/api/share/bridge/stat", params={"path": held}, headers=auth).status_code
        == 403
    )
    assert (
        c.get("/api/share/bridge/stat", params={"path": f"t{s['id']}:x"}).status_code
        == 401
    )


# --- the remembered Wi-Fi, and away (PR 23) -------------------------------------


def _wifi(name):
    (config_dir() / bridge.ANDROID_FILE).write_text(
        json.dumps({"wifi": name, "permission": True})
    )
    bridge.forget()
    storage._state.clear()
    storage._networks.clear()


def test_back_on_the_same_wifi_it_opens_by_itself(freebox):
    c, b, _, _ = freebox
    s = _open(c, b).json()
    # The phone's app restarted, or it left: nothing is open there any more.
    storage.close_temporary("t" + s["id"])
    _wifi("Other-Wifi")
    assert storage.state(storage.get(s["id"]))["state"] == "offline"
    assert storage._temporary == {}
    _wifi("Freebox-1A2B3C")
    assert storage.state(storage.get(s["id"]))["state"] == "online"
    assert list(storage._temporary) == ["t" + s["id"]]


def test_a_disconnected_share_stays_closed_on_its_wifi(freebox):
    c, b, _, _ = freebox
    s = _open(c, b).json()
    c.patch(f"/api/storages/{s['id']}", json={"connected": False})
    _wifi("Freebox-1A2B3C")
    assert storage.state(storage.get(s["id"]))["state"] == "closed"
    assert storage._temporary == {}


def test_a_copy_waits_for_the_phone_and_goes_on(freebox, tmp_path):
    from sestudio import transfers

    c, b, _, _ = freebox
    s = _open(c, b).json()
    home = tmp_path / "home"
    home.mkdir()
    disk = storage.add("folder", ["video"], "Home disk", str(home))
    job = transfers.create([f"{s['id']}:Films/Heat (1995).mkv"], disk["id"], "copy")
    transfers.control(job.id, "pause")
    # The phone leaves their Wi-Fi before the copy starts.
    storage.close_temporary("t" + s["id"])
    _wifi("Other-Wifi")
    transfers.control(job.id, "resume")
    for _ in range(300):
        now = next(j for j in transfers.all_jobs() if j["id"] == job.id)
        if now["waiting"]:
            break
        time.sleep(0.02)
    assert now["status"] == "paused" and now["waiting"] == "Pixel 7 on Freebox-1A2B3C"
    assert now["items"][0]["status"] == "waiting"
    _wifi("Freebox-1A2B3C")  # back: it opens again, and the copy goes on
    transfers._resume_waiting()
    assert _done(job.id)["status"] == "done"
    assert (home / "Films/Heat (1995).mkv").read_bytes() == b"0123456789"


# --- what a found place lets in (PR 25) -----------------------------------------


def test_anonymous_then_guest_is_tried_and_each_share_checked(monkeypatch):
    from sestudio import nearby

    tried = []

    def fake(host, port, user, password):
        tried.append(user)
        if user not in ("guest", "me"):
            raise nearby._Refused
        return [{"name": "Disque dur", "read": True, "write": True}]

    monkeypatch.setitem(nearby._SHARES, "smb", fake)
    got = nearby.probe("smb", "192.168.1.254")
    assert tried == ["guest"]
    assert got == {"login": "none", "user": "guest",
                   "shares": [{"name": "Disque dur", "read": True, "write": True}]}  # fmt: skip
    assert (
        nearby.probe("smb", "192.168.1.254", username="me", password="x")["login"]
        == "given"
    )
    monkeypatch.setitem(
        nearby._SHARES, "smb", lambda *a: (_ for _ in ()).throw(nearby._Refused())
    )
    assert nearby.probe("smb", "192.168.1.254")["login"] == "needed"


def test_home_asks_the_bridge_to_check_a_place(phone, monkeypatch):
    from sestudio import nearby

    seen = []
    monkeypatch.setattr(
        nearby, "probe", lambda *a: seen.append(a) or {"login": "needed", "shares": []}
    )
    c, url, token = phone
    b = c.post("/api/storages", json={"kind": "remote_sestudio", "roles": ["video"], "url": url,
               "token": token, "bridge": True}).json()  # fmt: skip
    body = {"kind": "smb", "host": "192.168.1.254", "username": "me", "password": "pw"}
    assert (
        c.post(f"/api/storages/{b['id']}/nearby/probe", json=body).json()["login"]
        == "needed"
    )
    assert seen[-1] == ("smb", "192.168.1.254", None, "me", "pw")
    assert c.post("/api/nearby/probe", json=body).json()["login"] == "needed"


# --- nothing of sestudio on a share (2026-11-22) --------------------------------


def test_the_share_list_is_read_from_the_box_answer():
    import struct

    from sestudio import smbshares

    def entry_strings(name, remark):
        return smbshares._wstr(name) + smbshares._wstr(remark)

    entries = [
        ("Disque dur", 0, "Freebox"),
        ("IPC$", 0x80000003, "IPC"),
        ("print$", 0, ""),
    ]
    stub = struct.pack("<IIIII", 1, 1, 0x20000, len(entries), 0x20004) + struct.pack(
        "<I", len(entries)
    )
    for i, (_n, kind, _r) in enumerate(entries):
        stub += struct.pack("<III", 0x20008 + 8 * i, kind, 0x2000C + 8 * i)
    for name, _k, remark in entries:
        stub += entry_strings(name, remark)
    stub += struct.pack("<III", len(entries), 0, 0)
    answer = b"\0" * 24 + stub
    assert smbshares.parse_shares(answer) == [
        ("Disque dur", 0), ("IPC$", 0x80000003), ("print$", 0),
    ]  # fmt: skip


def test_a_cut_copy_leaves_no_part_file_even_after_its_storage_was_away():
    from sestudio import transfers

    class Tmp:
        def __init__(self):
            self.away, self.gone = True, False

        def unlink(self, missing_ok=False):
            if self.away:
                raise OSError("away")
            self.gone = True

    job = transfers.Transfer(id="j", mode="copy", to="x", to_label="X", label="", on_conflict="skip",
                             items=[], total_bytes=0)  # fmt: skip
    tmp = Tmp()
    transfers._drop(job, tmp)
    assert transfers._leftovers == [tmp]
    transfers._sweep()  # still away
    assert transfers._leftovers == [tmp] and not tmp.gone
    tmp.away = False
    transfers._sweep()  # back: removed
    assert tmp.gone and transfers._leftovers == []


# --- modern boxes: WS-Discovery and names (PR 26) -------------------------------

_MATCHES = """<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
 xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery"><soap:Body><wsd:ProbeMatches>
<wsd:ProbeMatch><wsa:EndpointReference><wsa:Address>urn:uuid:6ace</wsa:Address></wsa:EndpointReference>
<wsd:Types>wsdp:Device pub:Computer</wsd:Types><wsd:XAddrs>{xaddr}</wsd:XAddrs>
<wsd:MetadataVersion>1</wsd:MetadataVersion></wsd:ProbeMatch></wsd:ProbeMatches></soap:Body></soap:Envelope>"""
_METADATA = """<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
 xmlns:pub="http://schemas.microsoft.com/windows/pub/2005/07"><soap:Body><wsx:Metadata
 xmlns:wsx="http://schemas.xmlsoap.org/ws/2004/09/mex"><wsx:MetadataSection>
<wsdp:Relationship xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof"><wsdp:Host>
<pub:Computer>DESKTOP-MAMAN/Workgroup:WORKGROUP</pub:Computer></wsdp:Host></wsdp:Relationship>
</wsx:MetadataSection></wsx:Metadata></soap:Body></soap:Envelope>"""


def test_ws_discovery_answers_are_read():
    from sestudio import nearby

    xml = _MATCHES.format(
        xaddr="http://192.168.1.31:5357/6ace http://[fe80::1]:5357/6ace"
    )
    assert nearby.parse_probe_matches(xml) == [
        ("urn:uuid:6ace", "http://192.168.1.31:5357/6ace")
    ]
    assert nearby.parse_computer(_METADATA) == "DESKTOP-MAMAN"
    assert nearby.parse_computer("<x/>") is None


def test_a_windows_pc_is_found_and_named(monkeypatch):
    """A PC that only speaks WS-Discovery: probed, it answers, its metadata names it."""
    import http.server

    from sestudio import nearby

    class Meta(http.server.BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            self.rfile.read(int(self.headers["Content-Length"]))
            body = _METADATA.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    web = http.server.HTTPServer(("127.0.0.1", 0), Meta)
    threading.Thread(target=web.serve_forever, daemon=True).start()
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.bind(("127.0.0.1", 0))

    def answer():
        data, sender = udp.recvfrom(65535)
        assert b"Probe" in data
        xaddr = f"http://127.0.0.1:{web.server_address[1]}/6ace"
        udp.sendto(_MATCHES.format(xaddr=xaddr).encode(), sender)

    threading.Thread(target=answer, daemon=True).start()
    monkeypatch.setattr(
        nearby, "_WSD_GROUP", udp.getsockname()
    )  # unicast stands in for the group
    monkeypatch.setattr(nearby, "_lan_ipv4s", lambda: ["127.0.0.1"])
    assert nearby._wsd(2) == {"127.0.0.1": "DESKTOP-MAMAN"}
    web.shutdown()
    udp.close()


def test_a_name_labels_an_address_but_adds_no_row():
    from sestudio import nearby

    rows = nearby.merge(
        [
            {
                "name": "192.168.1.254",
                "kind": "smb",
                "host": "192.168.1.254",
                "port": 445,
            }
        ],
        {"192.168.1.254": "Freebox", "192.168.1.31": "DESKTOP-MAMAN"},
    )
    assert [(r["name"], r["host"]) for r in rows] == [("Freebox", "192.168.1.254")]
