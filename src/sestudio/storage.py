"""Storages: every place this server's files live (SPEC-storage).

A storage is a folder the OS can open (a disk, a network share such as
``\\\\nas\\films``, an rclone mount of an FTP server) or one of the music-only
sources (another sestudio server, a YouTube Music account). Each says what it
holds (``roles``: video, music) and exactly one folder takes new downloads.

The list lives in the config as ``storages``; ``local`` is the download root the
app always had and cannot be removed. ``config.reconcile`` keeps the older
``output_root`` and ``music_libraries`` keys in step with it.
"""

from __future__ import annotations

import dataclasses
import json

import httpx
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from sestudio import remotefs, vault
from sestudio.config import (
    FOLDER_STORAGE,
    LOCAL_STORAGE,
    ROLES,
    config_dir,
    load_config,
    save_config,
)

LOCAL, FOLDER = LOCAL_STORAGE, FOLDER_STORAGE
REMOTE, YTMUSIC = "remote_sestudio", "ytmusic_account"
#: Servers read in the app over their protocol (SPEC-storage §9, X1).
NETWORK = ("ftp", "sftp", "smb")
#: A share another sestudio (a bridge) opened on its own network for this one
#: (SPEC-storage §10); read through that bridge.
BRIDGED = "bridged"
#: A UPnP media server, read only (SPEC-storage §11, M5): a Freebox's, a NAS's.
UPNP = "upnp"
KINDS = (FOLDER, REMOTE, YTMUSIC, *NETWORK, BRIDGED, UPNP)
#: What files are read from but never written to.
READ_ONLY = (REMOTE, UPNP)
#: Kinds that only hold music (another sestudio holds video too: SPEC-storage §9, X3).
MUSIC_ONLY = (YTMUSIC,)
_PREFIX = {
    FOLDER: "f",
    REMOTE: "r",
    YTMUSIC: "y",
    "ftp": "n",
    "sftp": "n",
    "smb": "n",
    BRIDGED: "b",
    UPNP: "u",
}
#: Shares this sestudio opened as a bridge for another one: in memory only, gone
#: with the process or when that one disconnects (SPEC-storage §10, B16).
_temporary: dict[str, dict[str, Any]] = {}


class Invalid(ValueError):
    pass


def all_storages() -> list[dict[str, Any]]:
    """``local`` first, then the others in the order they were added, then the
    shares opened here as a bridge."""
    return [*load_config().storages, *_temporary.values()]


def get(storage_id: str) -> dict[str, Any]:
    for s in all_storages():
        if s["id"] == storage_id:
            return s
    raise Invalid(f"unknown storage: {storage_id}")


def download_target() -> dict[str, Any]:
    return next(s for s in all_storages() if s["download"])


def _roles(kind: str, roles: list[str]) -> list[str]:
    clean = [r for r in ROLES if r in roles]
    if not clean or len(clean) != len(set(roles)):
        raise Invalid("Say what it holds: video, music, or both")
    if kind in MUSIC_ONLY and clean != ["music"]:
        raise Invalid("This kind of storage can only hold music for now")
    if kind in (BRIDGED, UPNP) and clean != ["video"]:
        raise Invalid("A share opened through a bridge holds video only, for now")
    return clean


def add(
    kind: str,
    roles: list[str],
    label: str = "",
    path: str = "",
    url: str = "",
    token: str = "",
    network: dict[str, Any] | None = None,
    bridge: bool = False,
    via: str = "",
    auto: bool = True,
) -> dict[str, Any]:
    """Add a storage. *bridge* marks another sestudio that opens shares on its
    own network for this one (SPEC-storage §10). *network* carries an FTP, SFTP or SMB server's fields
    (host, port, share, username, domain, tls) and its password, which goes to
    the vault, never the config."""
    label = label.strip()
    s: dict[str, Any] = {"kind": kind}
    password = ""
    if kind == FOLDER:
        folder = Path(path.strip()).expanduser()
        if not path.strip() or not folder.is_dir():
            raise Invalid("That folder does not exist on this machine")
        s["path"] = str(folder)
        label = label or folder.name or str(folder)
    elif kind == REMOTE:
        url = url.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise Invalid("The server address must start with http:// or https://")
        if not token.strip():
            raise Invalid("A token from the other server is needed")
        s |= {"url": url, "token": token.strip()}
        if bridge:
            s["bridge"] = True
        label = label or url.split("//", 1)[1]
    elif kind == YTMUSIC:
        if any(x["kind"] == YTMUSIC for x in all_storages()):
            raise Invalid("A YouTube Music account is already added")
        label = label or "YouTube Music"
    elif kind in NETWORK:
        s |= _network_fields(kind, path, network or {})
        password = str((network or {}).get("password") or "")
        label = label or f"{s['host']}{'/' + s['share'] if kind == 'smb' else ''}"
    elif kind == UPNP:
        s |= _media_server(url)
        label = label or "Media server"
    elif kind == BRIDGED:
        b = get(via)
        if not b.get("bridge"):
            raise Invalid("A share is opened through a bridge")
        proto = str((network or {}).get("proto") or "")
        if proto not in (*NETWORK, UPNP):
            raise Invalid("Open an SMB, SFTP or FTP share, or a media server")
        fields = (
            _media_server(url)
            if proto == UPNP
            else _network_fields(proto, path, network or {})
        )
        s |= {"via": via, "proto": proto, **fields}
        password = str((network or {}).get("password") or "")
        s |= {
            "wifi": (_networks.get(via) or {}).get("wifi"),
            "auto": bool(auto),
            "connected": True,
        }
        label = label or f"{s['host']}{'/' + s['share'] if proto == 'smb' else ''}"
    else:
        raise Invalid(f"unknown storage kind: {kind}")
    s |= {
        "id": _PREFIX[kind] + secrets.token_hex(3),
        "label": label,
        "roles": _roles(kind, roles),
        "download": False,
    }
    if kind == BRIDGED:
        _bridge_open(s, password)  # refused there: nothing is saved here
    if password:
        vault.put(s["id"], {"password": password})
    cfg = load_config()
    cfg.storages.append(s)
    save_config(cfg)
    return s


def _media_server(url: str) -> dict[str, Any]:
    """A media server's fields: the address of its description (``…/device.xml``)."""
    from urllib.parse import urlparse

    url = url.strip()
    host = urlparse(url).hostname
    if not url.startswith(("http://", "https://")) or not host:
        raise Invalid(
            "A media server is opened by its description address, like http://192.168.1.254:52424/device.xml"
        )
    return {"url": url, "host": host}


def is_read_only(s: dict[str, Any]) -> bool:
    """Whether files are only read from it: another sestudio, a media server, or a
    media server opened through a bridge."""
    return s["kind"] in READ_ONLY or (s["kind"] == BRIDGED and s.get("proto") == UPNP)


def top_of(s: dict[str, Any]) -> Any:
    """A server's top folder, to walk or resolve paths from."""
    from sestudio import upnpfs

    return upnpfs.top(s) if s["kind"] == UPNP else remotefs.top(s)


def _network_fields(kind: str, path: str, net: dict[str, Any]) -> dict[str, Any]:
    host = str(net.get("host") or "").strip()
    if not host or "/" in host or " " in host:
        raise Invalid(
            "The server's name or address is needed, like nas.local or 192.168.1.20"
        )
    out: dict[str, Any] = {"host": host, "path": "/" + path.strip().strip("/")}
    port = net.get("port")
    if port not in (None, ""):
        try:
            out["port"] = int(port)
        except (TypeError, ValueError):
            raise Invalid("The port is a number, like 21") from None
        if not 0 < out["port"] < 65536:
            raise Invalid("The port is a number from 1 to 65535")
    if net.get("username"):
        out["username"] = str(net["username"]).strip()
    if kind == "smb":
        share = str(net.get("share") or "").strip().strip("/\\")
        if not share:
            raise Invalid("The share's name is needed, like films")
        out["share"] = share
        if net.get("domain"):
            out["domain"] = str(net["domain"]).strip()
    if kind == "ftp":
        out["tls"] = bool(net.get("tls"))
    return out


def _edit(storage_id: str, change) -> dict[str, Any]:
    cfg = load_config()
    for s in cfg.storages:
        if s["id"] == storage_id:
            change(cfg, s)
            save_config(cfg)
            return s
    raise Invalid(f"unknown storage: {storage_id}")


def rename(storage_id: str, label: str) -> dict[str, Any]:
    def change(_cfg, s):
        s["label"] = label.strip() or s["label"]

    return _edit(storage_id, change)


def set_roles(storage_id: str, roles: list[str]) -> dict[str, Any]:
    def change(_cfg, s):
        s["roles"] = _roles(s["kind"], roles)

    return _edit(storage_id, change)


def set_bridge(storage_id: str, on: bool) -> dict[str, Any]:
    """Mark another sestudio as a bridge to its network, or not (SPEC-storage §10)."""

    def change(_cfg, s):
        if s["kind"] != REMOTE:
            raise Invalid("Only another sestudio can be a bridge")
        if on:
            s["bridge"] = True
        else:
            s.pop("bridge", None)

    return _edit(storage_id, change)


def set_download(storage_id: str) -> dict[str, Any]:
    """Make *storage_id* the one storage new downloads go to."""

    def change(cfg, s):
        if s["kind"] != FOLDER:
            raise Invalid("Downloads can only go to a folder")
        for other in cfg.storages:
            other["download"] = other is s

    return _edit(storage_id, change)


def remove(storage_id: str) -> dict[str, Any]:
    """Forget a storage; its files are never touched. The download target moves to ``local``."""
    if storage_id == LOCAL:
        raise Invalid("This PC cannot be removed")
    if storage_id in _temporary:
        return close_temporary(storage_id)
    cfg = load_config()
    gone = next((s for s in cfg.storages if s["id"] == storage_id), None)
    if gone is None:
        raise Invalid(f"unknown storage: {storage_id}")
    cfg.storages = [s for s in cfg.storages if s is not gone]
    save_config(cfg)  # with no target left, `reconcile` gives it back to `local`
    if gone["kind"] == BRIDGED:
        _bridge_close(gone)
        _drop_listing(gone)
    _forget(storage_id)
    vault.drop(storage_id)
    remotefs.forget(storage_id)
    return gone


# --- shares opened through a bridge (SPEC-storage §10) --------------------------
#
# Home keeps the share (address and login) and asks the bridge to open it; the
# bridge holds it in memory as a temporary storage, ``t<home id>``, lists it in
# its share and gives its files with the same token. Nothing of it is written on
# the bridge.

BRIDGE_TIMEOUT = 20.0


def peer_of(s: dict[str, Any]) -> dict[str, Any]:
    """The sestudio a storage's files are asked of: itself, or its bridge."""
    return get(s["via"]) if s["kind"] == BRIDGED else s


def temp_id(s: dict[str, Any]) -> str:
    """What the bridge calls a share it opened for this one."""
    return "t" + s["id"]


def remote_key(s: dict[str, Any], path: str) -> str:
    """The key the peer gives a file by: a bridge prefixes its temporary storage."""
    return f"{temp_id(s)}:{path}" if s["kind"] == BRIDGED else path


def _bridge_call(
    s: dict[str, Any], method: str, path: str, **kw: Any
) -> httpx.Response:
    b = get(s["via"])
    try:
        with httpx.Client(timeout=BRIDGE_TIMEOUT) as client:
            return client.request(
                method, f"{b['url']}/api/share/bridge{path}", headers=_bearer(b), **kw
            )
    except httpx.HTTPError:
        raise Invalid(f"{b['label']} did not answer") from None


def _bridge_open(s: dict[str, Any], password: str) -> None:
    keys = ("host", "port", "share", "path", "username", "domain", "tls", "url")
    fields = {k: s[k] for k in keys if s.get(k) is not None}
    r = _bridge_call(s, "POST", "/open", json={
        "key": s["id"], "kind": s["proto"], "label": s.get("label", ""), "password": password, **fields,
    })  # fmt: skip
    if r.status_code == 404:
        raise Invalid(
            f"{get(s['via'])['label']} runs an older sestudio: update it to open shares"
        )
    if r.status_code != 200:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = None
        raise Invalid(detail or f"The share did not open ({r.status_code})")
    _networks.pop(s["via"], None)  # its list of open shares changed
    with _lock:
        _state.pop(s["via"], None)
        _state.pop(s["id"], None)


def _bridge_close(s: dict[str, Any]) -> None:
    try:
        _bridge_call(s, "DELETE", f"/open/{temp_id(s)}")
    except Invalid:
        pass  # a bridge that is away has nothing open anyway


def _drop_listing(s: dict[str, Any]) -> None:
    """Nothing of theirs is kept after a disconnect (B16): the listing and the stills."""
    from sestudio import downloaded

    files = _entry(s)["files"] or _kept(s["id"])
    downloaded.drop_thumbnails(
        [(f"{s['id']}:{f.path}", f.mtime, f.size) for f in files]
    )
    _forget(s["id"])


def set_connected(storage_id: str, on: bool) -> dict[str, Any]:
    """Open a share through its bridge again with the saved login, or close it
    and drop what was listed (B14, B16). The login stays saved."""
    s = get(storage_id)
    if s["kind"] != BRIDGED:
        raise Invalid("Only a share opened through a bridge connects and disconnects")
    if on:
        _bridge_open(s, vault.get(storage_id).get("password", ""))
    else:
        _bridge_close(s)
        _drop_listing(s)

    def change(_cfg, x):
        x["connected"] = on
        if on:
            x["wifi"] = (_networks.get(x["via"]) or {}).get("wifi") or x.get("wifi")

    return _edit(storage_id, change)


def set_auto(storage_id: str, on: bool) -> dict[str, Any]:
    """Whether a share opens by itself when its bridge is back on the same Wi-Fi (B8)."""

    def change(_cfg, x):
        if x["kind"] != BRIDGED:
            raise Invalid("Only a share opened through a bridge opens by itself")
        x["auto"] = on

    return _edit(storage_id, change)


def open_temporary(
    key: str, kind: str, net: dict[str, Any], label: str = ""
) -> dict[str, Any]:
    """On a bridge: open a share for the sestudio that asked, in memory only."""
    if kind not in (*NETWORK, UPNP):
        raise Invalid("Open an SMB, SFTP or FTP share, or a media server")
    sid = "t" + "".join(ch for ch in key if ch.isalnum())[:24]
    if sid == "t":
        raise Invalid("A key is needed")
    fields = (
        _media_server(str(net.get("url") or ""))
        if kind == UPNP
        else _network_fields(kind, str(net.get("path") or ""), net)
    )
    s: dict[str, Any] = {"id": sid, "kind": kind, **fields}
    s |= {
        "label": label.strip() or s["host"],
        "roles": ["video"],
        "download": False,
        "temporary": True,
    }
    password = str(net.get("password") or "")
    if kind == UPNP:
        if not _media_server_up(s):
            raise Invalid("The media server did not answer")
    else:
        try:
            remotefs.check_with(s, password)
        except Exception as exc:  # noqa: BLE001 - the server's own words are the answer
            raise Invalid(f"Could not open it: {exc}") from None
    remotefs.forget(sid)
    _forget(sid)
    vault.hold(sid, {"password": password})
    _temporary[sid] = s
    return s


def close_temporary(storage_id: str) -> dict[str, Any]:
    gone = _temporary.pop(storage_id, None)
    if gone is None:
        raise Invalid(f"unknown storage: {storage_id}")
    vault.release(storage_id)
    remotefs.forget(storage_id)
    _forget(storage_id)
    return gone


def temporary_ids() -> list[str]:
    return list(_temporary)


# --- reachability and listings (SPEC-storage PR 4) ------------------------------
#
# A share whose server is off can hold `is_dir()` for 20–60 s on Windows, so a
# storage is checked off the request thread with a timeout, and a listing never
# waits on one that is away: it gets the storage's last listing, kept on disk so
# it survives a restart (S13–S15).

#: How long a reachability check may take before the storage counts as offline.
CHECK_TIMEOUT = 3.0
#: The same for a server reached over FTP, SFTP or SMB: a handshake takes longer.
NET_CHECK_TIMEOUT = 8.0
#: How long a check's answer is trusted.
STATE_TTL = 15.0
#: How long another storage's listing is trusted; it is refreshed in the background.
#: `local` keeps `downloaded.scan`'s own 10 s cache.
OTHER_TTL = 60.0
#: How long a first listing (nothing kept yet) is waited for.
FIRST_WAIT = 5.0

_lock = threading.Lock()
_state: dict[str, dict[str, Any]] = {}
_lists: dict[str, dict[str, Any]] = {}
#: What each bridge last said about its network (SPEC-storage §10): name, Wi-Fi.
_networks: dict[str, dict[str, Any]] = {}


def _media_server_up(s: dict[str, Any]) -> bool:
    try:
        return httpx.get(s["url"], timeout=NET_CHECK_TIMEOUT).status_code < 400
    except httpx.HTTPError:
        return False


def _reachable(s: dict[str, Any]) -> bool:
    if s["kind"] == FOLDER:
        return Path(s["path"]).is_dir()
    if s["kind"] == UPNP:
        return _media_server_up(s)
    if s["kind"] == BRIDGED:  # its bridge is up, and has it open
        b = get(s["via"])
        if not online(b):
            return False
        said = _networks.get(b["id"]) or {}
        if temp_id(s) in (said.get("open") or []):
            return True
        # Back on the Wi-Fi it was opened on: opened again with the saved login (B8).
        if s.get("auto") and s.get("wifi") and said.get("wifi") == s["wifi"]:
            try:
                _bridge_open(s, vault.get(s["id"]).get("password", ""))
                return True
            except Invalid:
                return False
        return False
    if s["kind"] == REMOTE:  # another sestudio: any answer means it is up
        try:
            with httpx.Client(timeout=NET_CHECK_TIMEOUT) as client:
                if s.get("bridge"):
                    # A bridge also says what network it is on; an older one has no such route.
                    r = client.get(f"{s['url']}/api/share/bridge", headers=_bearer(s))
                    if r.status_code == 200:
                        _networks[s["id"]] = r.json()
                    else:
                        _networks.pop(s["id"], None)
                else:
                    r = client.get(
                        f"{s['url']}/api/share/video/ping", headers=_bearer(s)
                    )
            return r.status_code < 500
        except httpx.HTTPError:
            return False
    try:  # a server: connect and list its top folder
        remotefs.filesystem(s).ls(remotefs.root(s))
        return True
    except Exception:  # noqa: BLE001 - any failure to answer is "away"
        remotefs.forget(s["id"])  # a dropped connection is not reused
        return False


def _probe(
    s: dict[str, Any], previous: dict[str, Any] | None
) -> tuple[bool, threading.Thread | None]:
    """Whether *s* answers, decided within its timeout; a check still running
    from before is not doubled, and counts as offline."""
    # A local disk that is slow to answer is waking up (a sleeping drive takes 20 s),
    # not gone: it keeps its last state, online at first. A share that hangs is away.
    slow = s["kind"] == FOLDER and (
        previous["state"] == "online" if previous else not _is_share(s["path"])
    )
    if previous and previous.get("probe") and previous["probe"].is_alive():
        return slow, previous["probe"]
    found: list[bool] = []

    def check() -> None:
        found.append(_reachable(s))
        with _lock:  # a late answer counts as soon as it comes
            known = _state.get(s["id"])
            if known and known.get("probe") is threading.current_thread():
                known.update(state="online" if found[0] else "offline", probe=None,
                             since=None if found[0] else known["since"] or time.time())  # fmt: skip

    probe = threading.Thread(target=check, daemon=True, name="storage-probe")
    probe.start()
    probe.join(CHECK_TIMEOUT if s["kind"] == FOLDER else NET_CHECK_TIMEOUT)
    return (bool(found[0]) if found else slow, None if found else probe)


def _is_share(path: str) -> bool:
    return path.startswith(("\\\\", "//"))


def _where(s: dict[str, Any]) -> tuple:
    """What a check's answer is about: a changed address is checked again."""
    return (s.get("host"), s.get("share"), s.get("port"), s.get("path"), s.get("via"))


def state(s: dict[str, Any]) -> dict[str, Any]:
    """``{state: online | offline, since}``: ``since`` is when it went away. A
    bridge adds ``network``: what it said about the network it is on."""
    if s["kind"] == BRIDGED and not s.get("connected", True):
        return {"state": "closed", "since": None}
    out = _state_of(s)
    if s.get("bridge"):
        out["network"] = _networks.get(s["id"]) if out["state"] == "online" else None
    return out


def _state_of(s: dict[str, Any]) -> dict[str, Any]:
    if s["kind"] not in (FOLDER, REMOTE, *NETWORK, BRIDGED, UPNP):
        return {"state": "online", "since": None}
    now = time.time()
    with _lock:
        known = _state.get(s["id"])
        if known and known["path"] == _where(s) and now - known["checked"] < STATE_TTL:
            return {"state": known["state"], "since": known["since"]}
    ok, probe = _probe(s, known)
    since = None if ok else ((known or {}).get("since") or now)
    with _lock:
        _state[s["id"]] = {
            "state": "online" if ok else "offline",
            "since": since,
            "checked": time.time(),
            "path": _where(s),
            "probe": probe,
        }
    return {"state": "online" if ok else "offline", "since": since}


def online(s: dict[str, Any]) -> bool:
    return state(s)["state"] == "online"


def _list_file(storage_id: str) -> Path:
    return config_dir() / "storage" / f"{storage_id}.json"


def _kept(storage_id: str) -> list[Any]:
    from sestudio import downloaded

    try:
        rows = json.loads(_list_file(storage_id).read_text("utf-8"))
        return [downloaded.DownloadedFile(**r) for r in rows]
    except (OSError, ValueError, TypeError):
        return []


def _keep(storage_id: str, files: list[Any]) -> None:
    path = _list_file(storage_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps([dataclasses.asdict(f) for f in files]), "utf-8")
        tmp.replace(path)
    except OSError:
        pass  # only the copy kept for when it is away is lost


def _entry(s: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        entry = _lists.get(s["id"])
        if entry is None or entry["path"] != _where(s):
            entry = _lists[s["id"]] = {
                "files": None, "at": 0.0, "scan": None, "path": _where(s),
            }  # fmt: skip
    if entry["files"] is None:
        entry["files"] = _kept(s["id"]) if s["id"] != LOCAL else []
    return entry


def _scan_into(s: dict[str, Any], entry: dict[str, Any]) -> None:
    from sestudio import downloaded

    if s["kind"] in (REMOTE, BRIDGED):
        files = _peer_files(s)
    elif s["kind"] == UPNP:
        from sestudio import upnpfs

        upnpfs.load(s)  # browsed again: its index is what the files are read by
        files = downloaded.scan(upnpfs.top(s))
    else:
        files = downloaded.scan(remotefs.top(s) if s["kind"] in NETWORK else s["path"])
    if files != entry["files"]:
        _keep(s["id"], files)
    entry["files"], entry["at"] = files, time.monotonic()


def _bearer(s: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {s.get('token', '')}"}


def _peer_files(s: dict[str, Any]) -> list[Any]:
    """Another sestudio's films (spec §9, X3), as its share lists them: each file
    keeps that server's own key as its path."""
    from sestudio import downloaded

    peer = peer_of(s)
    params = {"storage": temp_id(s)} if s["kind"] == BRIDGED else None
    prefix = f"{temp_id(s)}:" if s["kind"] == BRIDGED else ""
    with httpx.Client(timeout=30.0) as client:
        r = client.get(
            f"{peer['url']}/api/share/video", headers=_bearer(peer), params=params
        )
    r.raise_for_status()
    return [
        downloaded.DownloadedFile(
            path=f["path"].removeprefix(prefix),
            series=t.get("series", ""),
            season=int(t.get("season") or 0),
            number=int(f.get("number") or 0),
            title=f.get("title", ""),
            lang=f.get("lang") or downloaded.UNKNOWN_LANG,
            folder=t.get("folder", ""),
            size=int(f.get("size") or 0),
            mtime=float(f.get("mtime") or 0),
        )  # fmt: skip
        for t in r.json()
        if t.get("kind") != "audio"
        for f in t.get("files", [])
        if f.get("path")
    ]


def files_of(s: dict[str, Any]) -> list[Any]:
    """Every file of a folder storage: scanned when reachable, else its last listing."""
    entry = _entry(s)
    if not online(s):
        if s["id"] == LOCAL and not entry["files"]:
            entry["files"] = _kept(LOCAL)
        return entry["files"]
    if s["id"] == LOCAL:
        # As before: scanned on the spot, under `downloaded.scan`'s own short cache.
        _scan_into(s, entry)
        return entry["files"]
    if time.monotonic() - entry["at"] < OTHER_TTL:
        return entry["files"]
    with _lock:
        scan = entry["scan"]
        if scan is None or not scan.is_alive():
            scan = entry["scan"] = threading.Thread(
                target=_scan_into, args=(s, entry), daemon=True, name="storage-scan"
            )
            scan.start()
    if not entry["files"]:
        scan.join(FIRST_WAIT)
    return entry["files"]


def invalidate(storage_id: str | None = None) -> None:
    """Listings are read again on next use (after a download or a delete)."""
    with _lock:
        for sid, entry in _lists.items():
            if storage_id in (None, sid):
                entry["at"] = 0.0


def _forget(storage_id: str) -> None:
    from sestudio import upnpfs

    with _lock:
        _state.pop(storage_id, None)
        _lists.pop(storage_id, None)
    _list_file(storage_id).unlink(missing_ok=True)
    upnpfs.forget(storage_id)
