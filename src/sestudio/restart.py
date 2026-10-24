"""Restarting the server on newer code, from its own settings page."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import psutil

#: Run by the old server's Python: waits for it (argv[1], a process id) to exit,
#: then runs the rest of argv. Before the new server, not inside it: `uv run`
#: installs what new code needs first, and on Windows a library the old server
#: has loaded cannot be replaced until it is gone. The standard library only,
#: so it loads none of those itself.
WAITER = """
import os, subprocess, sys, time
pid = int(sys.argv[1])
def alive():
    if os.name == "nt":
        import ctypes
        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return False
        try:
            return kernel.WaitForSingleObject(handle, 0) == 0x102  # timed out
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True
deadline = time.monotonic() + 60
while alive() and time.monotonic() < deadline:
    time.sleep(0.2)
sys.exit(subprocess.call(sys.argv[2:]))
"""


def launcher() -> tuple[list[str], str] | None:
    """The uv command this server was started with, and the folder it was run
    in: the outermost `uv`/`uvx` among the processes above this one. What a
    restart runs again — `uvx --with-editable . sestudio` on the code now in
    the folder, `uvx sestudio` on its version, `uv run sestudio` in its own
    environment — with its own options (`--python 3.12`) kept."""
    found = None
    try:
        for parent in psutil.Process().parents():
            name = parent.name().lower().removesuffix(".exe")
            if name in ("uv", "uvx"):
                found = parent
            elif found is not None:
                break  # the shell that ran it
        return (found.cmdline(), found.cwd()) if found is not None else None
    except psutil.Error:
        return None


def checkout() -> Path | None:
    """The source checkout sestudio runs from, or None for an installed copy
    (`uvx sestudio`, a wheel)."""
    root = Path(__file__).resolve().parent.parent.parent
    return root if (root / "pyproject.toml").is_file() else None


def command() -> tuple[list[str], str, str | None]:
    """How to start the server again, which way that is, and the folder to run
    it in: "launcher" — the uv command it was started with (see
    :func:`launcher`); else "uvx" — `uvx sestudio@latest`, the newest release,
    with the options it was started with; else "python" — the same Python,
    whose code is the checkout's as it is now, if it runs from one."""
    if found := launcher():
        return found[0], "launcher", found[1]
    args = sys.argv[1:]
    if checkout() is None and (uvx := shutil.which("uvx")):
        return [uvx, "sestudio@latest", *args], "uvx", None
    return [sys.executable, "-m", "sestudio", *args], "python", None


def spawn() -> str:
    """Start the next server once this one has exited and let go of its ports
    (see :data:`WAITER`). Says which way it is started (see :func:`command`)."""
    argv, how, cwd = command()
    subprocess.Popen([sys.executable, "-c", WAITER, str(os.getpid()), *argv], cwd=cwd)
    return how
