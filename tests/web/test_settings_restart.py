"""Restarting the server from its settings page."""

from __future__ import annotations

import subprocess
import sys

from fastapi.testclient import TestClient

from sestudio import restart
from sestudio.web.app import create_app


def test_a_checkout_restarts_on_its_own_code_and_an_install_on_the_latest(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(restart.sys, "argv", ["sestudio", "--http_port", "9000"])
    monkeypatch.setattr(restart, "checkout", lambda: tmp_path)
    monkeypatch.setattr(restart.shutil, "which", lambda name: f"/bin/{name}")
    assert restart.command() == (
        [
            "/bin/uv",
            "run",
            "--project",
            str(tmp_path),
            "sestudio",
            "--http_port",
            "9000",
        ],
        "checkout",
    )
    # No uv: the same Python, on the checkout's code all the same.
    monkeypatch.setattr(restart.shutil, "which", lambda name: None)
    argv, how = restart.command()
    assert (argv[1:], how) == (["-m", "sestudio", "--http_port", "9000"], "checkout")

    monkeypatch.setattr(restart, "checkout", lambda: None)
    monkeypatch.setattr(restart.shutil, "which", lambda name: "/bin/uvx")
    assert restart.command() == (
        ["/bin/uvx", "sestudio@latest", "--http_port", "9000"],
        "uvx",
    )


def test_the_next_server_is_started_waiting_for_this_one_and_this_one_stops(
    monkeypatch,
):
    import os

    started: list[list[str]] = []
    monkeypatch.setattr(restart.subprocess, "Popen", lambda argv: started.append(argv))
    monkeypatch.setattr(restart, "command", lambda: (["sestudio", "-v"], "checkout"))
    monkeypatch.setattr(
        "sestudio.web.routes.settings.threading.Timer",
        lambda *a: type("T", (), {"start": lambda self: None})(),
    )
    client = TestClient(create_app(live_domain="https://x"))

    assert client.post("/api/server/restart").status_code == 409
    client.app.state.servers = [type("S", (), {"should_exit": False})()]
    assert client.post("/api/server/restart").json() == {"restart": "checkout"}
    assert started == [
        [
            restart.sys.executable,
            "-c",
            restart.WAITER,
            str(os.getpid()),
            "sestudio",
            "-v",
        ]
    ]


def test_the_waiter_runs_the_next_server_once_the_old_one_is_gone(tmp_path):
    """Run for real: a process that has exited, then the command."""
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    marker = tmp_path / "started"
    code = subprocess.call(
        [
            sys.executable, "-c", restart.WAITER, str(gone.pid),
            sys.executable, "-c", f"open({str(marker)!r}, 'w').write('ok')",
        ],
        timeout=30,
    )  # fmt: skip
    assert code == 0
    assert marker.read_text() == "ok"
