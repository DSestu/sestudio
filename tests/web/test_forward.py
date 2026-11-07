"""Switched to another server: /api is forwarded as it came, streaming; the local set stays."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from sestudio.web import forward
from sestudio.web.app import create_app
from sestudio.web.routes import servers

PIN = "ab" * 32


@pytest.fixture()
def switched(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    seen: list[httpx.Request] = []
    state = {"up": True, "presented": PIN}

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if not state["up"]:
            raise httpx.ConnectError("down")
        if request.url.path == "/api/health":
            return httpx.Response(200, json={"ok": True, "version": "9.9"})
        if request.url.path == "/api/music/queue/events":
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=httpx.ByteStream(b"data: one\n\ndata: two\n\n"),
            )
        if request.url.path == "/api/stream/tv":
            rng = request.headers.get("range", "")
            return httpx.Response(
                206 if rng else 200,
                headers={"content-type": "video/mp4", "content-range": "bytes 0-3/10"},
                stream=httpx.ByteStream(b"vide"),
            )
        echo = {
            "path": request.url.path,
            "query": request.url.query.decode(),
            "method": request.method,
            "body": request.content.decode(),
            "ctype": request.headers.get("content-type", ""),
        }
        # MockTransport hands back a sync body; the forwarder streams, so give it a stream.
        return httpx.Response(
            201,
            headers={"content-type": "application/json"},
            stream=httpx.ByteStream(json.dumps(echo).encode()),
        )

    monkeypatch.setattr(servers, "transport", httpx.MockTransport(handle))
    monkeypatch.setattr(servers, "_fingerprint", lambda r: PIN)
    monkeypatch.setattr(forward, "_presented", lambda r: state["presented"])
    c = TestClient(create_app())
    row = c.post(
        "/api/servers", json={"name": "PC", "url": "https://pc.test:8443"}
    ).json()
    c.post(f"/api/servers/{row['id']}/trust")
    assert c.put("/api/servers/active", json={"id": row["id"]}).status_code == 200
    seen.clear()
    c.seen, c.state, c.server = seen, state, row
    return c


def test_api_requests_go_to_the_server_in_use_as_they_came(switched):
    r = switched.post(
        "/api/library/items?x=1&y=2", json={"a": 1}, headers={"X-Thing": "kept"}
    )
    assert r.status_code == 201
    assert r.json() == {
        "path": "/api/library/items",
        "query": "x=1&y=2",
        "method": "POST",
        "body": '{"a":1}',
        "ctype": "application/json",
    }
    sent = switched.seen[-1]
    assert sent.url.host == "pc.test"
    assert sent.headers["x-thing"] == "kept"
    assert sent.headers["accept-encoding"] == "identity"
    assert sent.headers["host"] == "pc.test:8443"


def test_the_local_set_and_the_frontend_stay_here(switched):
    assert switched.get("/api/servers").json()["active"] == switched.server["id"]
    assert switched.get("/api/cast/http-port").status_code == 200
    assert switched.get("/api/server/lan").status_code == 200
    assert switched.get("/api/health").json()["version"] == servers.version()
    assert all(r.url.host != "pc.test" for r in switched.seen)
    assert forward.is_local("/api/cast/dlna/renderers")
    assert not forward.is_local("/api/cast/tracks")
    assert not forward.is_local("/api/healthcheck")


def test_streams_pass_through_with_their_range_and_type(switched):
    r = switched.get("/api/stream/tv?token=t", headers={"Range": "bytes=0-3"})
    assert r.status_code == 206
    assert r.headers["content-range"] == "bytes 0-3/10"
    assert r.headers["content-type"] == "video/mp4"
    assert r.content == b"vide"
    assert switched.seen[-1].headers["range"] == "bytes=0-3"

    with switched.stream("GET", "/api/music/queue/events") as events:
        assert events.headers["content-type"] == "text/event-stream"
        assert b"".join(events.iter_bytes()) == b"data: one\n\ndata: two\n\n"


def test_a_server_that_is_down_answers_502_with_its_name(switched):
    switched.state["up"] = False
    r = switched.get("/api/library/items")
    assert r.status_code == 502
    assert r.json() == {
        "detail": "PC is not answering",
        "server": switched.server["id"],
    }


def test_a_changed_certificate_is_refused(switched):
    switched.state["presented"] = "ef" * 32
    r = switched.get("/api/library/items")
    assert r.status_code == 502
    assert "certificate changed" in r.json()["detail"]


def test_switching_back_stops_forwarding(switched):
    switched.put("/api/servers/active", json={"id": None})
    switched.seen.clear()
    assert switched.get("/api/health").status_code == 200
    assert switched.get("/api/settings").status_code == 200
    assert switched.seen == []
