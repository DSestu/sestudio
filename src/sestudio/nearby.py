"""What holds files on the network this sestudio is on (SPEC-storage §10, B3–B5).

Three ways of looking, run side by side for a few seconds:

- mDNS: NAS boxes and Macs announce ``_smb._tcp``, ``_ftp._tcp``, ``_sftp-ssh._tcp``;
- SSDP: UPnP media servers (a Freebox announces itself as "Freebox Server");
- WS-Discovery: Windows 10/11 and NAS boxes with SMB1 and NetBIOS off announce
  themselves only this way (SPEC-storage §11, M2);
- a port check of the box (the ``.1`` and ``.254`` of each local network) and of
  every address found above, for SMB, FTP and SFTP: boxes that announce nothing.

Boxes are named by brand (§11, M1): by their UPnP gateway announcement, and by the
name each one answers to on its own network.

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


def merge(
    found: list[dict[str, Any]], hints: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """One row per (address, kind); a name from an announcement beats an address,
    and an address that announced a name lends it to its other services. *hints*
    name addresses without adding rows: a name says nothing of what is shared."""
    names = {f["host"]: f["name"] for f in found if f["name"] != f["host"]}
    # A hint names the machine itself ("Freebox Pop", a PC's own name), not one of its services.
    names.update(hints or {})
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
    hints: dict[str, str] = {}

    def hint(fn, *args):
        try:
            got = fn(*args)
        except Exception as exc:  # noqa: BLE001 - one way of looking failing leaves the others
            logger.info("Nearby: %s failed: %s", fn.__name__, exc)
            return
        with lock:
            for host, name in got.items():
                hints.setdefault(host, name)

    looks = [threading.Thread(target=collect, args=(f, seconds), daemon=True)
             for f in (_mdns, _ssdp)]  # fmt: skip
    looks += [threading.Thread(target=hint, args=(f, seconds), daemon=True)
              for f in (_wsd, _gateway_names)]  # fmt: skip
    looks.append(threading.Thread(target=hint, args=(_box_names,), daemon=True))
    looks.append(
        threading.Thread(target=hint, args=(_freebox_names, _boxes(ips)), daemon=True)
    )
    looks.append(
        threading.Thread(
            target=collect, args=(_freebox_media, _boxes(ips)), daemon=True
        )
    )
    looks.append(
        threading.Thread(target=collect, args=(_probe, _boxes(ips)), daemon=True)
    )
    for t in looks:
        t.start()
    for t in looks:
        t.join(seconds + 4)
    # What was announced gets its ports checked too: a Freebox found by SSDP has SMB.
    with lock:
        announced = sorted(({f["host"] for f in found} | set(hints)) - set(_boxes(ips)))
    if announced:
        collect(_probe, announced)
    return {
        "found": merge(found, hints),
        "seconds": round(time.monotonic() - started, 1),
    }


# --- names: WS-Discovery, the gateway, the boxes' own names (§11, M1, M2) -------

_WSD_GROUP = ("239.255.255.250", 3702)
_WSD_PROBE = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
 xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
 xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery"
 xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof"
 xmlns:pub="http://schemas.microsoft.com/windows/pub/2005/07">
<soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
<wsa:MessageID>urn:uuid:{id}</wsa:MessageID></soap:Header>
<soap:Body><wsd:Probe><wsd:Types>wsdp:Device pub:Computer</wsd:Types></wsd:Probe></soap:Body>
</soap:Envelope>"""
_WSD_GET = """<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
 xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">
<soap:Header><wsa:To>{to}</wsa:To>
<wsa:Action>http://schemas.xmlsoap.org/ws/2004/09/transfer/Get</wsa:Action>
<wsa:MessageID>urn:uuid:{id}</wsa:MessageID>
<wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
</soap:Header><soap:Body/></soap:Envelope>"""

#: What each French box answers to on its own network (§11, M1).
BOX_HOSTS = {
    "mafreebox.freebox.fr": "Freebox",
    "gestionbbox.lan": "Bbox",
    "livebox.home": "Livebox",
}


def parse_probe_matches(xml: str) -> list[tuple[str, str]]:
    """(endpoint address, first XAddr) of each match in a WS-Discovery answer."""
    import re

    out = []
    for match in re.findall(
        r"<(?:\w+:)?ProbeMatch\b.*?</(?:\w+:)?ProbeMatch>", xml, re.S
    ):
        address = re.search(r"<(?:\w+:)?Address>\s*([^<\s]+)", match)
        xaddrs = re.search(r"<(?:\w+:)?XAddrs>\s*([^<]+)", match)
        if address and xaddrs:
            out.append((address.group(1), xaddrs.group(1).split()[0]))
    return out


def parse_computer(xml: str) -> str | None:
    """The machine's name in a WS-Discovery metadata answer: ``NAME/Workgroup:…``."""
    import re

    found = re.search(r"<(?:\w+:)?Computer>\s*([^<]+?)\s*</", xml)
    return found.group(1).split("/")[0] if found else None


def _wsd(seconds: float) -> dict[str, str]:
    import urllib.parse
    import uuid

    import httpx

    sources = _lan_ipv4s() or [""]
    socks = []
    for ip in sources:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
            if ip:
                s.setsockopt(
                    socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(ip)
                )
            s.bind((ip, 0))
            s.sendto(_WSD_PROBE.format(id=uuid.uuid4()).encode(), _WSD_GROUP)
            socks.append(s)
        except OSError:
            s.close()
    matches: dict[str, tuple[str, str]] = {}
    deadline = time.monotonic() + min(seconds, 3.0)
    try:
        while socks and (left := deadline - time.monotonic()) > 0:
            import select

            ready, _, _ = select.select(socks, [], [], left)
            for s in ready:
                data, (addr, _port) = s.recvfrom(65535)
                for endpoint, xaddr in parse_probe_matches(
                    data.decode("utf-8", "replace")
                ):
                    matches.setdefault(addr, (endpoint, xaddr))
    finally:
        for s in socks:
            s.close()
    names: dict[str, str] = {}
    for addr, (endpoint, xaddr) in matches.items():
        name = None
        if urllib.parse.urlparse(xaddr).scheme == "http":
            try:
                r = httpx.post(xaddr, timeout=2.0, content=_WSD_GET.format(to=endpoint, id=uuid.uuid4()),
                               headers={"Content-Type": "application/soap+xml"})  # fmt: skip
                name = parse_computer(r.text)
            except httpx.HTTPError:
                pass
        names[addr] = name or addr
    return names


def _gateway_names(seconds: float) -> dict[str, str]:
    """The box's own name, from its UPnP gateway announcement ("Livebox 6", "Bbox")."""
    from async_upnp_client.aiohttp import AiohttpRequester
    from async_upnp_client.client_factory import UpnpFactory
    from async_upnp_client.search import async_search

    async def run() -> dict[str, str]:
        locations: set[str] = set()

        async def on_response(headers: Any) -> None:
            if headers.get("location"):
                locations.add(headers["location"])

        await async_search(on_response, timeout=int(min(seconds, 3)),
                           search_target="urn:schemas-upnp-org:device:InternetGatewayDevice:1")  # fmt: skip
        factory = UpnpFactory(AiohttpRequester(timeout=3))
        out = {}
        for location in locations:
            try:
                device = await factory.async_create_device(location)
            except Exception:  # noqa: BLE001 - an odd device is skipped
                continue
            host = location.split("//", 1)[-1].split("/", 1)[0].split(":")[0]
            out[host] = device.friendly_name
        return out

    return asyncio.run(run())


#: Freebox generations by the number in ``box_model_name`` ("Freebox v8 (r1)").
FREEBOX_MODELS = {
    6: "Freebox Revolution",
    7: "Freebox Delta",
    8: "Freebox Pop",
    9: "Freebox Ultra",
}


def freebox_name(answer: dict[str, Any]) -> str | None:
    """A Freebox's name from its ``/api_version`` answer; None for anything else."""
    import re

    model = str(answer.get("box_model_name") or "")
    if not model.lower().startswith("freebox") and "Freebox" not in str(
        answer.get("device_name") or ""
    ):
        return None
    found = re.search(r"v(\d+)", model)
    return FREEBOX_MODELS.get(int(found.group(1)), "Freebox") if found else "Freebox"


def _freebox_names(hosts: list[str]) -> dict[str, str]:
    """Which of *hosts* is a Freebox: each says so at ``/api_version``, whatever its DNS name."""
    import httpx

    out = {}

    def ask(host: str) -> None:
        try:
            r = httpx.get(f"http://{host}/api_version", timeout=2.0)
            name = freebox_name(r.json()) if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            return
        if name:
            out[host] = name

    threads = [threading.Thread(target=ask, args=(h,), daemon=True) for h in hosts]
    for t in threads:
        t.start()
    for t in threads:
        t.join(3.0)
    return out


#: Where a Freebox's media server describes itself, whether SSDP gets through or not.
FREEBOX_MEDIA = "http://{host}:52424/device.xml"


def _freebox_media(hosts: list[str]) -> list[dict[str, Any]]:
    """A Freebox's media server, asked at its usual address: SSDP can be blocked
    (WSL, some Wi-Fi), the box still answers there."""
    import re

    import httpx

    out = []

    def ask(host: str) -> None:
        location = FREEBOX_MEDIA.format(host=host)
        try:
            r = httpx.get(location, timeout=2.0)
        except httpx.HTTPError:
            return
        if r.status_code == 200 and "MediaServer" in r.text:
            name = re.search(r"<friendlyName>([^<]*)</friendlyName>", r.text)
            out.append({"name": name.group(1) if name else host, "kind": "media",
                        "host": host, "port": None, "location": location})  # fmt: skip

    threads = [threading.Thread(target=ask, args=(h,), daemon=True) for h in hosts]
    for t in threads:
        t.start()
    for t in threads:
        t.join(3.0)
    return out


def _box_names() -> dict[str, str]:
    """The boxes whose usual name answers here, by address."""
    out = {}

    def look(name: str) -> None:
        try:
            address = socket.gethostbyname(name)
        except OSError:
            return
        if address.startswith(
            ("10.", "172.", "192.168.")
        ):  # their own network, not the internet
            out[address] = BOX_HOSTS[name]

    threads = [threading.Thread(target=look, args=(n,), daemon=True) for n in BOX_HOSTS]
    for t in threads:
        t.start()
    for t in threads:
        t.join(3.0)
    return out


# --- what a found place lets in (SPEC-storage §10, B5–B6) -----------------------
#
# Tried with no login first, as boxes usually share as a guest: SMB as "guest",
# FTP as "anonymous". Nothing is ever written on a share to find out what it
# allows: SMB is asked (see ``smbshares``), FTP and SFTP are listed for reading
# and have no such question for writing, which stays unknown (None) there.

#: Logins tried when none is given, in order.
NO_LOGIN = {
    # "guest": what the files are then read with (an empty login cannot be).
    "smb": [("guest", "")],
    "ftp": [("anonymous", "anonymous@")],
    "sftp": [],
}
#: How long one step of a check may take.
PROBE_STEP = 6.0


def _try(fn) -> bool:
    try:
        fn()
        return True
    except Exception:  # noqa: BLE001 - refused, or not allowed: that is the answer
        return False


class _Refused(Exception):
    """The login was not accepted."""


def _smb_shares(host: str, port: int, user: str, password: str) -> list[dict[str, Any]]:
    from sestudio import smbshares

    try:
        return smbshares.shares(host, port, user, password, PROBE_STEP)
    except smbshares.Refused:
        raise _Refused from None


def _ftp_shares(host: str, port: int, user: str, password: str) -> list[dict[str, Any]]:
    import ftplib

    ftp = ftplib.FTP(timeout=PROBE_STEP)
    try:
        ftp.connect(host, port)
        try:
            ftp.login(user, password)
        except ftplib.error_perm:
            raise _Refused from None
        read = _try(lambda: ftp.nlst("/"))
        return [{"name": "/", "read": read, "write": None}]
    finally:
        _try(ftp.close)


def _sftp_shares(
    host: str, port: int, user: str, password: str
) -> list[dict[str, Any]]:
    from sestudio import remotefs

    s = {
        "id": "probe",
        "kind": "sftp",
        "host": host,
        "port": port,
        "username": user,
        "path": "/",
    }
    try:
        fs = remotefs._open(s, password or None)
    except Exception:  # noqa: BLE001 - paramiko words a refused login many ways
        raise _Refused from None
    read = _try(lambda: fs.ls("/"))
    return [{"name": "/", "read": read, "write": None}]


_SHARES = {"smb": _smb_shares, "ftp": _ftp_shares, "sftp": _sftp_shares}


def probe(
    kind: str,
    host: str,
    port: int | None = None,
    username: str = "",
    password: str = "",
) -> dict[str, Any]:
    """Who gets in, and what each share lets them do.

    ``{"login": "none" | "given", "user": ..., "shares": [{name, read, write}]}``
    when a login worked; ``{"login": "needed"}`` when none did;
    ``{"error": ...}`` when the place did not answer.
    """
    if kind not in _SHARES:
        return {"error": "Only SMB, FTP and SFTP are checked"}
    port = port or PORTS[kind]
    given = bool(username or password)
    logins = [(username, password)] if given else NO_LOGIN[kind]
    for user, secret in logins:
        try:
            shares = _SHARES[kind](host, port, user, secret)
        except _Refused:
            continue
        except Exception as exc:  # noqa: BLE001 - its own words are the answer
            return {"error": f"Could not reach it: {exc}"}
        return {"login": "given" if given else "none", "user": user, "shares": shares}
    return {"login": "needed", "shares": []}
