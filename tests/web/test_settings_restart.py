"""Restarting the server from its settings page."""

from __future__ import annotations

import subprocess
import sys

from fastapi.testclient import TestClient

from sestudio import restart
from sestudio.web.app import create_app


def test_a_restart_runs_the_uv_command_it_was_started_with(monkeypatch, tmp_path):
    """`uvx --python 3.12 --with-editable . sestudio` from its folder, its own
    options kept: not a `uv run` that builds an environment of its own."""

    class Proc:
        def __init__(self, name, cmdline=(), cwd=""):
            self._name, self._cmdline, self._cwd = name, list(cmdline), cwd

        def name(self):
            return self._name

        def cmdline(self):
            return self._cmdline

        def cwd(self):
            return self._cwd

    uvx = ["uvx", "--python", "3.12", "--with-editable", ".", "sestudio", "serve"]
    chain = [
        Proc("python.exe"),
        Proc("sestudio.exe"),
        Proc("uv.exe", ["uv", "tool", "uvx", "..."], "D:/x"),
        Proc("uvx.exe", uvx, "D:/sestudio"),
        Proc("pwsh.exe", ["pwsh"], "C:/"),
    ]
    monkeypatch.setattr(
        restart.psutil,
        "Process",
        lambda: type("P", (), {"parents": lambda self: chain})(),
    )
    assert restart.command() == (uvx, "launcher", "D:/sestudio")

    # Not started by uv: an installed copy restarts on the latest release.
    monkeypatch.setattr(restart, "launcher", lambda: None)
    monkeypatch.setattr(restart.sys, "argv", ["sestudio", "--http_port", "9000"])
    monkeypatch.setattr(restart, "checkout", lambda: None)
    monkeypatch.setattr(restart.shutil, "which", lambda name: "/bin/uvx")
    assert restart.command() == (
        ["/bin/uvx", "sestudio@latest", "--http_port", "9000"], "uvx", None,
    )  # fmt: skip
    # A checkout: the same Python, on the code now in it.
    monkeypatch.setattr(restart, "checkout", lambda: tmp_path)
    argv, how, _cwd = restart.command()
    assert (argv[1:], how) == (["-m", "sestudio", "--http_port", "9000"], "python")


def test_the_next_server_is_started_waiting_for_this_one_and_this_one_stops(
    monkeypatch,
):
    import os

    started: list[list[str]] = []
    monkeypatch.setattr(
        restart.subprocess, "Popen", lambda argv, cwd=None: started.append((argv, cwd))
    )
    monkeypatch.setattr(
        restart, "command", lambda: (["sestudio", "-v"], "launcher", "/x")
    )
    monkeypatch.setattr(
        "sestudio.web.routes.settings.threading.Timer",
        lambda *a: type("T", (), {"start": lambda self: None})(),
    )
    client = TestClient(create_app(live_domain="https://x"))

    assert client.post("/api/server/restart").status_code == 409
    client.app.state.servers = [type("S", (), {"should_exit": False})()]
    assert client.post("/api/server/restart").json() == {"restart": "launcher"}
    waiter = [restart.sys.executable, "-c", restart.WAITER, str(os.getpid())]
    assert started == [([*waiter, "sestudio", "-v"], "/x")]


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
