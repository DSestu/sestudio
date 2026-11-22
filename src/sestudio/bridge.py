"""This sestudio as a bridge to the network it is on (SPEC-storage §10).

A phone (or a laptop) running sestudio on another home's Wi-Fi can open that
home's shares for the sestudio at home, which reaches it over Tailscale. This
module says what network it is on: the Wi-Fi name, which the stored shares are
remembered by (B8, Q5).

On Android the app writes ``network.json`` beside the config, since only it can
read the Wi-Fi name (and only with the location permission). Elsewhere the OS
is asked.
"""

from __future__ import annotations

import json
import platform
import re
import shutil
import socket
import subprocess
import threading
import time
from typing import Any

from sestudio.config import config_dir

#: How long an answer about the Wi-Fi is trusted.
TTL = 10.0
#: Written by the Android app: ``{"wifi": "Freebox-1A2B3C" | null, "permission": bool}``.
ANDROID_FILE = "network.json"
#: Left for the Android app when the Wi-Fi name is wanted without the permission
#: to read it: the app then asks the user, once (SPEC-storage §10.5, A).
WANTED_FILE = "network_wanted"

_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "value": None}
#: Whether the app was asked for the permission yet: once per run, not every check.
_asked = False


def _run(argv: list[str]) -> str:
    try:
        return subprocess.run(
            argv, capture_output=True, text=True, timeout=4, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def parse_netsh(out: str) -> str | None:
    """The SSID line of ``netsh wlan show interfaces`` (not the BSSID one)."""
    m = re.search(r"^\s*SSID\s*:\s*(.+?)\s*$", out, re.MULTILINE)
    return m.group(1) if m else None


def parse_nmcli(out: str) -> str | None:
    """The active line of ``nmcli -t -f active,ssid dev wifi``."""
    for line in out.splitlines():
        active, _, ssid = line.partition(":")
        if active == "yes" and ssid:
            return ssid.replace("\\:", ":")
    return None


def _from_os() -> tuple[str | None, bool]:
    """(Wi-Fi name, whether it could be read at all)."""
    global _asked
    android = config_dir() / ANDROID_FILE
    if android.exists():
        try:
            data = json.loads(android.read_text("utf-8"))
        except (OSError, ValueError):
            return None, True
        if not data.get("permission", True):
            if not _asked:
                _asked = True
                try:
                    (config_dir() / WANTED_FILE).touch()
                except OSError:
                    pass
            return None, False
        return (data.get("wifi") or None), True
    system = platform.system()
    if system == "Windows":
        return parse_netsh(_run(["netsh", "wlan", "show", "interfaces"])), True
    if system == "Linux":
        if shutil.which("nmcli"):
            return parse_nmcli(
                _run(["nmcli", "-t", "-f", "active,ssid", "dev", "wifi"])
            ), True
        if shutil.which("iwgetid"):
            return (_run(["iwgetid", "-r"]).strip() or None), True
    return None, True


def info() -> dict[str, Any]:
    """What a bridge tells the sestudio that uses it: its name and its Wi-Fi.
    ``wifi_blocked`` is true when the Wi-Fi name cannot be read without a permission."""
    with _lock:
        if time.monotonic() - _cache["at"] < TTL and _cache["value"] is not None:
            return _cache["value"]
    wifi, readable = _from_os()
    value = {"name": socket.gethostname(), "wifi": wifi, "wifi_blocked": not readable}
    with _lock:
        _cache.update(at=time.monotonic(), value=value)
    return value


def forget() -> None:
    """Drop the cached answer: the network just changed."""
    global _asked
    with _lock:
        _cache.update(at=0.0, value=None)
    _asked = False
