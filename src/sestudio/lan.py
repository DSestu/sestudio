"""Whether phones and TVs on the network can reach this server, checked at startup."""

from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import sys

import psutil

logger = logging.getLogger(__name__)

#: Asked of Windows about the network carrying the LAN address (env
#: SESTUDIO_IP; -Command takes no arguments): its category, the firewall
#: profiles turned off, and the enabled inbound rules for this Python (env
#: SESTUDIO_EXE).
_FIREWALL_QUERY = """
$ip, $exe = $env:SESTUDIO_IP, $env:SESTUDIO_EXE
$cats = @(Get-NetIPAddress -IPAddress $ip -ErrorAction SilentlyContinue |
  Get-NetConnectionProfile | ForEach-Object { "$($_.NetworkCategory)" -replace 'Authenticated', '' })
$off = @(Get-NetFirewallProfile | Where-Object { "$($_.Enabled)" -eq 'False' } | ForEach-Object { $_.Name })
$rules = @(Get-NetFirewallApplicationFilter |
  Where-Object { [Environment]::ExpandEnvironmentVariables($_.Program) -ieq $exe } |
  Get-NetFirewallRule | Where-Object { "$($_.Enabled)" -eq 'True' -and "$($_.Direction)" -eq 'Inbound' } |
  ForEach-Object { @{ action = "$($_.Action)"; profile = "$($_.Profile)" } })
@{ categories = $cats; off = $off; rules = $rules } | ConvertTo-Json -Compress -Depth 3
"""


def _listed(value: object) -> list:
    """PowerShell's JSON gives a lone item instead of a one-item list."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def blocked_by_rules(state: dict) -> str | None:
    """The network category ("Private", "Public", "Domain") on which Windows
    Firewall drops incoming connections to this Python, or None: a Block rule
    wins over an Allow, and with neither the default is to block."""
    off = _listed(state.get("off"))
    rules = _listed(state.get("rules"))
    for category in _listed(state.get("categories")):
        if category in off:
            continue
        actions = {
            rule["action"]
            for rule in rules
            if rule["profile"] == "Any" or category in rule["profile"]
        }
        if "Block" in actions or "Allow" not in actions:
            return category
    return None


def firewall_blocks(ip: str) -> str | None:
    """The category of *ip*'s network if Windows Firewall keeps other devices
    from reaching this Python there (see :func:`blocked_by_rules`). None off
    Windows, or when it cannot be told.

    shortcut: only per-program rules count; a rule opening the port alone
    still reads as blocked. Read port rules too if that turns up."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                _FIREWALL_QUERY,
            ],
            env={
                **os.environ,
                "SESTUDIO_IP": ip,
                "SESTUDIO_EXE": psutil.Process().exe(),
            },
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout
        return blocked_by_rules(json.loads(out))
    except Exception as exc:  # no PowerShell, no NetSecurity module, odd output
        logger.debug("Could not read the firewall rules: %s", exc)
        return None


def answers(host: str, port: int) -> bool:
    """Whether something listens on host:port."""
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


def problem(ip: str, port: int, firewalled: str | None) -> str | None:
    """Why other devices can't reach the server on ip:port, once it listens:
    "unreachable" (the address does not answer even here), "firewall", or
    None when nothing is in the way."""
    if not answers(ip, port):
        return "unreachable"
    return "firewall" if firewalled else None


def primary_ip() -> str | None:
    """This machine's address on the default route: the one phones and TVs on
    the same network reach it by. None when it has no network."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))  # no packet is sent: it only picks the route
            ip = sock.getsockname()[0]
    except OSError:
        return None
    return None if ip.startswith("127.") or ip == "0.0.0.0" else ip


def state(scheme: str, port: int, http_port: int | None) -> dict:
    """Where other devices reach the server now, and what is in the way: the
    /api/server/lan answer. Blocks for a few seconds on Windows (see
    :func:`firewall_blocks`)."""
    ip = primary_ip()
    if ip is None:
        return {
            "ip": None,
            "url": None,
            "problem": "offline",
            "http_port": http_port,
            "program": psutil.Process().exe(),
        }
    network = firewall_blocks(ip)
    return {
        "ip": ip,
        "url": f"{scheme}://{ip}:{port}",
        "problem": problem(ip, port, network),
        # The category whose box to tick, when the firewall is in the way.
        "network": network,
        "http_port": http_port,
        "program": psutil.Process().exe(),
    }
