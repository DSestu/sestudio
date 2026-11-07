"""Other sestudio servers this one can stand in front of (docs/SPEC-remote-servers.md).

The registry lives in the config; each server is checked against its
``/api/health`` and its certificate pinned by SHA-256 fingerprint the first
time the user accepts it. ``app.state.upstream`` is the server in use, which
the forwarding layer reads on every request.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import logging
import secrets
import time
from typing import Any

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from sestudio import dlna, tls
from sestudio.config import load_config, save_config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/servers")

#: Tests put a ``httpx.MockTransport`` here; None means the network.
transport: httpx.BaseTransport | None = None
TIMEOUT = 3.0


class ServerBody(BaseModel):
    name: str
    url: str


class ActiveBody(BaseModel):
    id: str | None = None


def version() -> str:
    try:
        return importlib.metadata.version("sestudio")
    except importlib.metadata.PackageNotFoundError:
        return "dev"


def _fingerprint(response: httpx.Response) -> str:
    """SHA-256 of the certificate the server presented, "" over http or in tests."""
    try:
        ssl_object = response.extensions["network_stream"].get_extra_info("ssl_object")
        der = ssl_object.getpeercert(True)
    except (KeyError, AttributeError):
        return ""
    return hashlib.sha256(der).hexdigest() if der else ""


def check(server: dict[str, Any]) -> dict[str, Any]:
    """One probe of the server's ``/api/health``: reachable, version, round trip,
    and the fingerprint it presented. The certificate is not verified here: the
    pin (the fingerprint the user accepted) is what makes it trusted."""
    url = server["url"].rstrip("/")
    started = time.monotonic()
    try:
        with httpx.Client(transport=transport, timeout=TIMEOUT, verify=False) as client:
            # Streamed: the TLS socket, and so the certificate, is only there
            # until the body has been read.
            with client.stream("GET", f"{url}/api/health") as r:
                fingerprint = _fingerprint(r)
                r.read()
        r.raise_for_status()
        return {
            "reachable": True,
            "version": str(r.json().get("version") or ""),
            "rtt_ms": round((time.monotonic() - started) * 1000),
            "fingerprint": fingerprint,
            "last_seen": time.time(),
            "error": "",
        }
    except (httpx.HTTPError, ValueError, OSError) as exc:
        return {"reachable": False, "error": str(exc) or type(exc).__name__}


def _state(request: Request) -> dict[str, dict[str, Any]]:
    """Last check result per server id, kept on the app."""
    if not hasattr(request.app.state, "servers_checked"):
        request.app.state.servers_checked = {}
    return request.app.state.servers_checked


def _row(
    server: dict[str, Any], checked: dict[str, Any] | None, active: str
) -> dict[str, Any]:
    checked = checked or {}
    seen = checked.get("fingerprint")
    pinned = server.get("fingerprint", "")
    # http needs no pin; https is trusted once the pin matches what it presents.
    trusted = not server["url"].startswith("https://") or (
        bool(pinned) and pinned == seen
    )
    return {
        "id": server["id"],
        "name": server["name"],
        "url": server["url"],
        "in_use": server["id"] == active,
        "reachable": checked.get("reachable"),
        "version": checked.get("version", ""),
        "rtt_ms": checked.get("rtt_ms"),
        "last_seen": checked.get("last_seen") or server.get("last_seen"),
        "fingerprint": seen if seen is not None else pinned,
        "trusted": trusted,
        "error": checked.get("error", ""),
    }


def _find(cfg, server_id: str) -> dict[str, Any]:
    for server in cfg.servers:
        if server["id"] == server_id:
            return server
    raise HTTPException(404, "No such server")


async def _check_into(request: Request, server: dict[str, Any]) -> dict[str, Any]:
    result = await asyncio.to_thread(check, server)
    if result["reachable"]:
        # Remembered across restarts, for the "last seen" of a server now down.
        server["last_seen"] = result["last_seen"]
    _state(request)[server["id"]] = result
    return result


def own_fingerprint() -> str:
    """The SHA-256 of this server's certificate, for the other side to compare."""
    try:
        cert_path, _ = tls.ensure_cert()
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        return cert.fingerprint(hashes.SHA256()).hex()
    except Exception:  # no cert yet, or no permission to write one
        return ""


def _self(request: Request) -> dict[str, Any]:
    """What another sestudio needs to add this one: its addresses and fingerprint."""
    https = request.app.state.https_port
    http = request.app.state.http_port
    scheme, port = ("https", https) if https else ("http", http)
    return {
        "addresses": [f"{scheme}://{ip}:{port}" for ip in dlna._local_ipv4s()]
        if port
        else [],
        "fingerprint": own_fingerprint() if https else "",
        "version": version(),
    }


@router.get("")
async def list_servers(request: Request, check: bool = False) -> dict[str, Any]:
    """The registry with each server's last check; ``check=true`` probes them all first."""
    cfg = load_config()
    if check:
        await asyncio.gather(*(_check_into(request, s) for s in cfg.servers))
        save_config(cfg)
    state = _state(request)
    return {
        "active": cfg.active_server or None,
        "servers": [
            _row(s, state.get(s["id"]), cfg.active_server) for s in cfg.servers
        ],
        "self": _self(request),
    }


@router.post("")
async def add_server(body: ServerBody, request: Request) -> dict[str, Any]:
    url = body.url.strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "The address must start with http:// or https://")
    name = body.name.strip() or url
    cfg = load_config()
    if any(s["url"] == url for s in cfg.servers):
        raise HTTPException(409, "That server is already in the list")
    server = {"id": secrets.token_hex(4), "name": name, "url": url, "fingerprint": ""}
    cfg.servers.append(server)
    result = await _check_into(request, server)
    save_config(cfg)
    return _row(server, result, cfg.active_server)


@router.delete("/{server_id}")
async def remove_server(server_id: str, request: Request) -> dict[str, Any]:
    cfg = load_config()
    server = _find(cfg, server_id)
    cfg.servers.remove(server)
    if cfg.active_server == server_id:
        cfg.active_server = ""
        request.app.state.upstream = None
    save_config(cfg)
    _state(request).pop(server_id, None)
    return {"removed": server_id}


@router.post("/{server_id}/check")
async def check_server(server_id: str, request: Request) -> dict[str, Any]:
    cfg = load_config()
    server = _find(cfg, server_id)
    result = await _check_into(request, server)
    save_config(cfg)
    return _row(server, result, cfg.active_server)


@router.post("/{server_id}/trust")
async def trust_server(server_id: str, request: Request) -> dict[str, Any]:
    """Pin the fingerprint the last check saw."""
    cfg = load_config()
    server = _find(cfg, server_id)
    seen = _state(request).get(server_id, {}).get("fingerprint")
    if not seen:
        raise HTTPException(409, "Check the server first")
    server["fingerprint"] = seen
    save_config(cfg)
    upstream = getattr(request.app.state, "upstream", None)
    if upstream and upstream["id"] == server_id:
        upstream["fingerprint"] = seen
    return _row(server, _state(request).get(server_id), cfg.active_server)


@router.put("/active")
async def set_active(body: ActiveBody, request: Request) -> dict[str, Any]:
    """Switch to a server, or back to this machine with ``{"id": null}``."""
    cfg = load_config()
    if body.id:
        server = _find(cfg, body.id)
        row = _row(server, _state(request).get(body.id), cfg.active_server)
        if not row["trusted"]:
            raise HTTPException(409, "Trust that server first")
        cfg.active_server = body.id
        request.app.state.upstream = {
            "id": body.id,
            "name": server["name"],
            "url": server["url"],
            "fingerprint": server["fingerprint"],
        }
    else:
        cfg.active_server = ""
        request.app.state.upstream = None
    save_config(cfg)
    return {"active": cfg.active_server or None}


def restore(app) -> None:
    """At startup: the server picked last time is in use again."""
    cfg = load_config()
    app.state.upstream = None
    if cfg.active_server:
        for server in cfg.servers:
            if server["id"] == cfg.active_server:
                app.state.upstream = {
                    "id": server["id"],
                    "name": server["name"],
                    "url": server["url"],
                    "fingerprint": server["fingerprint"],
                }
