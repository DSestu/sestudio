"""Restarting the server on newer code, from its own settings page."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

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


def checkout() -> Path | None:
    """The source checkout sestudio runs from, or None for an installed copy
    (`uvx sestudio`, a wheel)."""
    root = Path(__file__).resolve().parent.parent.parent
    return root if (root / "pyproject.toml").is_file() else None


def command() -> tuple[list[str], str]:
    """How to start the server again, with the options it was started with,
    and which way that is: "checkout" — the code now in the checkout; "uvx" —
    `uvx sestudio@latest`, the newest release; "installed" — the same copy,
    when uvx is not to be found."""
    args = sys.argv[1:]
    root = checkout()
    if root is not None:
        # Through uv where it is, which installs what the new code needs first.
        if uv := shutil.which("uv"):
            return [uv, "run", "--project", str(root), "sestudio", *args], "checkout"
        return [sys.executable, "-m", "sestudio", *args], "checkout"
    if uvx := shutil.which("uvx"):
        return [uvx, "sestudio@latest", *args], "uvx"
    return [sys.executable, "-m", "sestudio", *args], "installed"


def spawn() -> str:
    """Start the next server once this one has exited and let go of its ports
    (see :data:`WAITER`). Says which way it is started (see :func:`command`)."""
    argv, how = command()
    subprocess.Popen([sys.executable, "-c", WAITER, str(os.getpid()), *argv])
    return how
