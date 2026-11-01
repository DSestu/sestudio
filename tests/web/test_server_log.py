"""The server's log, as Settings shows it."""

from __future__ import annotations

import logging
import time

from fastapi.testclient import TestClient

from sestudio.logging_config import LOG_BUFFER, LogBuffer
from sestudio.web.app import create_app


def test_buffer_keeps_the_newest_lines_numbered():
    buf = LogBuffer(size=2)
    log = logging.getLogger("test-buffer")
    log.addHandler(buf)
    try:
        for word in ("one", "two", "three"):
            log.warning(word)
    finally:
        log.removeHandler(buf)
    lines = buf.since(0)
    assert [line["text"].split(" ", 1)[1] for line in lines] == ["two", "three"]
    assert [line["seq"] for line in lines] == [2, 3]
    assert buf.since(2)[0]["level"] == "WARNING"


def test_route_returns_lines_after_a_number(tmp_path, monkeypatch):
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_WATCHERS", "0")
    monkeypatch.setattr("sestudio.web.app._refresh_sites", lambda app: _noop())
    with TestClient(create_app(live_domain="https://fs03.lol")) as client:
        logging.getLogger("sestudio.test").warning("hello from the server")
        body = client.get("/api/server/log").json()
        lines = body["lines"]
        assert 0 < body["started"] <= time.time()
        assert lines[-1]["text"].endswith("hello from the server")
        last = lines[-1]["seq"]
        assert client.get(f"/api/server/log?after={last}").json()["lines"] == []
    logging.getLogger().removeHandler(LOG_BUFFER)


def test_polling_the_log_is_not_logged():
    buf = LogBuffer()
    access = logging.getLogger("test-access")
    access.addHandler(buf)
    try:
        args = ("127.0.0.1:1", "GET", "/api/server/log?after=3", "1.1", 200)
        access.warning('%s - "%s %s HTTP/%s" %d', *args)
        access.warning(
            '%s - "%s %s HTTP/%s" %d', "127.0.0.1:1", "GET", "/api/search", "1.1", 200
        )
    finally:
        access.removeHandler(buf)
    assert [
        line["text"].endswith('/api/search HTTP/1.1" 200') for line in buf.since(0)
    ] == [True]


async def _noop() -> None:
    return None
