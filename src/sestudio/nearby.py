"""What holds files on the network this sestudio is on (SPEC-storage §10, B3–B5).

Three ways of looking, run side by side for a few seconds:

- mDNS: NAS boxes and Macs announce ``_smb._tcp``, ``_ftp._tcp``, ``_sftp-ssh._tcp``;
- SSDP: UPnP media servers (a Freebox announces itself as "Freebox Server");
- a port check of the box (the ``.1`` and ``.254`` of each local network) and of
  every address found above, for SMB, FTP and SFTP: boxes that announce nothing.

Only what holds files is kept: TVs, speakers and printers never answer these.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)

#: mDNS service type → storage kind.
SERVICES = {
    "_smb._tcp.local.": "smb",
    "_ftp._tcp.local.": "ftp",
    "_sftp-ssh._tcp.local.": "sftp",
}
PORTS = {"smb": 445, "ftp": 21, "sftp": 22}
MEDIA_SERVER = "urn:schemas-upnp-org:device:MediaServer:1"
#: How long a port check may take.
PROBE_TIMEOUT = 0.8
#: Order in the list: what opens best first.
_ORDER = {"smb": 0, "ftp": 1, "sftp": 2, "media": 3}
_TAILSCALE = ipaddress.ip_network("100.64.0.0/10")


def _lan_ipv4s() -> list[str]:
    """This machine's addresses on real networks: not loopback, not Tailscale."""
    from sestudio.dlna import _local_ipv4s

    return [ip for ip in _local_ipv4s() if ipaddress.ip_address(ip) not in _TAILSCALE]


def _boxes(ips: list[str]) -> list[str]:
    """Where a home's box usually sits on each local network: .1 and .254."""
    out = []
    for ip in ips:
        net = ipaddress.ip_network(f"{ip}/24", strict=False)
        out += [str(net.network_address + 1), str(net.network_address + 254)]
    return [a for a in dict.fromkeys(out) if a not in ips]


def _mdns(seconds: float) -> list[dict[str, Any]]:
    from zeroconf import ServiceBrowser, ServiceStateChange, Zeroconf

    seen: set[tuple[str, str]] = set()

    def on_change(zeroconf, service_type, name, state_change):  # noqa: ARG001
        if state_change is ServiceStateChange.Added:
            seen.add((service_type, name))

    zc = Zeroconf()
    try:
        ServiceBrowser(zc, list(SERVICES), handlers=[on_change])
        time.sleep(seconds)
        out = []
        for service_type, name in list(seen):
            info = zc.get_service_info(service_type, name, timeout=1000)
            if not info:
                continue
            label = name.removesuffix(service_type).rstrip(".")
            for address in info.parsed_addresses():
                if ":" in address:
                    continue  # IPv6: the IPv4 one says the same
                out.append({"name": label, "kind": SERVICES[service_type],
                            "host": address, "port": info.port})  # fmt: skip
        return out
    finally:
        zc.close()


def _ssdp(seconds: float) -> list[dict[str, Any]]:
    from async_upnp_client.aiohttp import AiohttpRequester
    from async_upnp_client.client_factory import UpnpFactory
    from async_upnp_client.search import async_search

    async def run() -> list[dict[str, Any]]:
        locations: set[str] = set()

        async def on_response(headers: Any) -> None:
            if headers.get("location") and "MediaServer" in headers.get("st", ""):
                locations.add(headers["location"])

        await async_search(
            on_response, timeout=int(seconds), search_target=MEDIA_SERVER
        )
        factory = UpnpFactory(AiohttpRequester(timeout=3))
        out = []
        for location in locations:
            try:
                device = await factory.async_create_device(location)
            except Exception:  # noqa: BLE001 - an odd device is skipped
                continue
            host = location.split("//", 1)[-1].split("/", 1)[0].split(":")[0]
            out.append({"name": device.friendly_name, "kind": "media",
                        "host": host, "port": None, "location": location})  # fmt: skip
        return out

    return asyncio.run(run())


def _open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=PROBE_TIMEOUT):
            return True
    except OSError:
        return False


def _probe(hosts: list[str]) -> list[dict[str, Any]]:
    checks = [(h, kind, port) for h in hosts for kind, port in PORTS.items()]
    with ThreadPoolExecutor(max_workers=16) as pool:
        answers = list(pool.map(lambda c: _open(c[0], c[2]), checks))
    return [{"name": h, "kind": kind, "host": h, "port": port}
            for (h, kind, port), ok in zip(checks, answers) if ok]  # fmt: skip


def merge(found: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per (address, kind); a name from an announcement beats an address,
    and an address that announced a name lends it to its other services."""
    names = {f["host"]: f["name"] for f in found if f["name"] != f["host"]}
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    for f in found:
        key = (f["host"], f["kind"])
        row = rows.setdefault(key, {**f, "name": names.get(f["host"], f["name"])})
        if row.get("port") is None and f.get("port"):
            row["port"] = f["port"]
    return sorted(
        rows.values(), key=lambda r: (_ORDER[r["kind"]], r["name"].lower(), r["host"])
    )


def scan(seconds: float = 4.0) -> dict[str, Any]:
    """Everything that holds files nearby, found within about *seconds*."""
    started = time.monotonic()
    found: list[dict[str, Any]] = []
    lock = threading.Lock()

    def collect(fn, *args):
        try:
            rows = fn(*args)
        except Exception as exc:  # noqa: BLE001 - one way of looking failing leaves the others
            logger.info("Nearby: %s failed: %s", fn.__name__, exc)
            return
        with lock:
            found.extend(rows)

    ips = _lan_ipv4s()
    looks = [threading.Thread(target=collect, args=(f, seconds), daemon=True)
             for f in (_mdns, _ssdp)]  # fmt: skip
    looks.append(
        threading.Thread(target=collect, args=(_probe, _boxes(ips)), daemon=True)
    )
    for t in looks:
        t.start()
    for t in looks:
        t.join(seconds + 4)
    # What was announced gets its ports checked too: a Freebox found by SSDP has SMB.
    with lock:
        announced = sorted({f["host"] for f in found} - set(_boxes(ips)))
    if announced:
        collect(_probe, announced)
    return {"found": merge(found), "seconds": round(time.monotonic() - started, 1)}
