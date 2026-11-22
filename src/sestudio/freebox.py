"""A Freebox through Freebox OS, its own API (SPEC-storage §11, M4).

Paired once: sestudio asks the box for an app token, the person confirms on the
box (or in Freebox OS / the Freebox Connect app), and from then on a session is
opened with that token to read the box's disks and its file sharing, and to turn
its Windows sharing (SMB) on, only when asked to.

Runs where the box is reachable: on this server, or on a bridge for the sestudio
at home, which keeps the token (like a password) and sends it with each call.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import threading
import time
from typing import Any

import httpx

APP = {
    "app_id": "io.github.dsestu.sestudio",
    "app_name": "sestudio",
    "app_version": "1",
}
TIMEOUT = 8.0

#: Open sessions by (host, app token): reused until the box says otherwise.
_sessions: dict[tuple[str, str], str] = {}
_lock = threading.Lock()


class FreeboxError(Exception):
    """What the box said no with, in its own words."""


def _base(host: str) -> str:
    """The API's address: ``/api/v<major>/`` of the version the box says it speaks."""
    try:
        info = httpx.get(f"http://{host}/api_version", timeout=TIMEOUT).json()
    except (httpx.HTTPError, ValueError) as exc:
        raise FreeboxError(f"The Freebox did not answer: {exc}") from None
    major = str(info.get("api_version") or "8").split(".")[0]
    return f"http://{host}{info.get('api_base_url') or '/api/'}v{major}"


def _result(r: httpx.Response) -> Any:
    try:
        body = r.json()
    except ValueError:
        raise FreeboxError(f"The Freebox answered {r.status_code}") from None
    if not body.get("success"):
        code = body.get("error_code") or ""
        if code == "insufficient_rights":
            raise FreeboxError(
                "Freebox OS refused: give sestudio the right to change settings, in Freebox OS › "
                "Paramètres de la Freebox › Gestion des accès › Applications"
            )
        raise FreeboxError(
            body.get("msg") or code or f"The Freebox answered {r.status_code}"
        )
    return body.get("result")


def info(host: str) -> dict[str, Any]:
    """Who the box is: its model, name and id, from ``/api_version``."""
    try:
        return httpx.get(f"http://{host}/api_version", timeout=TIMEOUT).json()
    except (httpx.HTTPError, ValueError) as exc:
        raise FreeboxError(f"The Freebox did not answer: {exc}") from None


def pair(host: str, device_name: str) -> dict[str, Any]:
    """Ask the box for an app token; it waits for the person's confirmation.
    ``{app_token, track_id}``: the token works once the track says granted."""
    base = _base(host)
    r = httpx.post(
        f"{base}/login/authorize/",
        json={**APP, "device_name": device_name},
        timeout=TIMEOUT,
    )
    got = _result(r)
    return {"app_token": got["app_token"], "track_id": got["track_id"]}


def pair_status(host: str, track_id: int) -> str:
    """unknown | pending | timeout | granted | denied"""
    base = _base(host)
    return str(
        _result(httpx.get(f"{base}/login/authorize/{int(track_id)}", timeout=TIMEOUT))[
            "status"
        ]
    )


def _session(host: str, app_token: str, fresh: bool = False) -> tuple[str, str]:
    base = _base(host)
    key = (host, app_token)
    with _lock:
        token = None if fresh else _sessions.get(key)
    if token:
        return base, token
    challenge = _result(httpx.get(f"{base}/login/", timeout=TIMEOUT))["challenge"]
    password = hmac.new(
        app_token.encode(), challenge.encode(), hashlib.sha1
    ).hexdigest()
    got = _result(httpx.post(f"{base}/login/session/", json={"app_id": APP["app_id"], "password": password},
                             timeout=TIMEOUT))  # fmt: skip
    with _lock:
        _sessions[key] = got["session_token"]
    return base, got["session_token"]


def _call(host: str, app_token: str, method: str, path: str, **kw: Any) -> Any:
    """One call with a session, opened again once if the box let the last one go."""
    for fresh in (False, True):
        base, token = _session(host, app_token, fresh)
        r = httpx.request(
            method,
            f"{base}{path}",
            headers={"X-Fbx-App-Auth": token},
            timeout=TIMEOUT,
            **kw,
        )
        if r.status_code == 403 and not fresh:
            try:
                if r.json().get("error_code") in ("auth_required", "invalid_session"):
                    continue
            except ValueError:
                pass
        return _result(r)
    return None


def disks(host: str, app_token: str) -> list[dict[str, Any]]:
    """The box's disks and their partitions: name, size, room left."""
    out = []
    for disk in _call(host, app_token, "GET", "/storage/disk/") or []:
        for part in disk.get("partitions") or []:
            path = part.get("path") or ""
            try:
                path = base64.b64decode(path).decode("utf-8", "replace") if path else ""
            except ValueError:
                pass
            out.append({
                "name": part.get("label") or disk.get("model") or "Disk",
                "kind": disk.get("type") or "",
                "model": disk.get("model") or "",
                "total": int(part.get("total_bytes") or 0),
                "free": int(part.get("free_bytes") or 0),
                "path": path,
                "ready": part.get("state") in (None, "mounted"),
            })  # fmt: skip
    return out


def sharing(host: str, app_token: str) -> dict[str, Any]:
    """Whether its Windows sharing (SMB) is on, and with a login or not."""
    smb = _call(host, app_token, "GET", "/netshare/samba/") or {}
    return {
        "smb": bool(smb.get("file_share_enabled")),
        "logon": bool(smb.get("logon_enabled")),
        "user": smb.get("logon_user") or "",
    }


def turn_on_sharing(
    host: str, app_token: str, user: str = "", password: str = ""
) -> dict[str, Any]:
    """Turn the box's Windows sharing on: open to guests, or with *user* and *password*
    set on the box. Only on the person's explicit say-so (spec §11, S)."""
    change: dict[str, Any] = {"file_share_enabled": True, "logon_enabled": bool(user)}
    if user:
        change |= {"logon_user": user, "logon_password": password}
    _call(host, app_token, "PUT", "/netshare/samba/", json=change)
    time.sleep(0.5)  # the box restarts its sharing service
    return sharing(host, app_token)
