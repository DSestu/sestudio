"""Music libraries: where tracks live (SPEC-music §13.1, §11 PR 19).

The download root is always the library ``local``. Others are kept in the
config: another folder on this machine (a NAS mount), another sestudio server
read through its share API with a bearer token, or a YouTube Music account.
This module is the registry, the remote client and the share tokens this server
hands out; the routes in ``web/routes/music_libraries.py`` expose them.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from sestudio import downloaded
from sestudio.config import config_dir, load_config, save_config
from sestudio.music import store

logger = logging.getLogger(__name__)

LOCAL = downloaded.LOCAL_LIBRARY
FOLDER, REMOTE, YTMUSIC = "local_folder", "remote_sestudio", "ytmusic_account"
KINDS = (FOLDER, REMOTE, YTMUSIC)
ANDROID_STORAGE = "android_storage.json"

#: How long a remote's (or YT Music's) listing is trusted before it is fetched again.
TTL = 60.0
YTMUSIC_TTL = 600.0
TIMEOUT = 5.0
YTMUSIC_LIKES = "https://music.youtube.com/playlist?list=LM"
YTMUSIC_MAX = 500

#: Tests put a ``httpx.MockTransport`` here; None means the network.
transport: httpx.BaseTransport | httpx.AsyncBaseTransport | None = None


class Invalid(ValueError):
    pass


# --- registry -----------------------------------------------------------------


def registered() -> list[dict[str, Any]]:
    return list(load_config().music_libraries)


def all_libraries() -> list[dict[str, Any]]:
    """``local`` first, then the registered ones, in the order they were added."""
    here = {
        "id": LOCAL,
        "kind": "local",
        "label": downloaded.LOCAL_LIBRARY_LABEL,
        "path": load_config().output_root,
    }
    return [here, *registered()]


def get(library_id: str) -> dict[str, Any]:
    for lib in all_libraries():
        if lib["id"] == library_id:
            return lib
    raise Invalid(f"unknown library: {library_id}")


def public(lib: dict[str, Any]) -> dict[str, Any]:
    """A library as the client sees it: the token is never sent back."""
    out = {k: v for k, v in lib.items() if k != "token"}
    if lib["kind"] == REMOTE:
        out["has_token"] = bool(lib.get("token"))
    return out


def add(
    kind: str, label: str = "", path: str = "", url: str = "", token: str = ""
) -> dict[str, Any]:
    label = label.strip()
    lib: dict[str, Any] = {"kind": kind}
    if kind == FOLDER:
        folder = Path(path.strip()).expanduser()
        if not folder.is_dir():
            raise Invalid("That folder does not exist on this machine")
        lib |= {"id": "f" + secrets.token_hex(3), "path": str(folder)}
        label = label or folder.name or str(folder)
    elif kind == REMOTE:
        url = url.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise Invalid("The server address must start with http:// or https://")
        if not token.strip():
            raise Invalid("A token from the other server is needed")
        lib |= {"id": "r" + secrets.token_hex(3), "url": url, "token": token.strip()}
        label = label or url.split("//", 1)[1]
    elif kind == YTMUSIC:
        if any(x["kind"] == YTMUSIC for x in registered()):
            raise Invalid("A YouTube Music account is already added")
        lib["id"] = "y" + secrets.token_hex(3)
        label = label or "YouTube Music"
    else:
        raise Invalid(f"unknown library kind: {kind}")
    lib["label"] = label
    cfg = load_config()
    cfg.music_libraries.append(lib)
    save_config(cfg)
    return lib


def rename(library_id: str, label: str) -> dict[str, Any]:
    cfg = load_config()
    for lib in cfg.music_libraries:
        if lib["id"] == library_id:
            lib["label"] = label.strip() or lib["label"]
            save_config(cfg)
            return lib
    raise Invalid(f"unknown library: {library_id}")


def remove(library_id: str) -> None:
    cfg = load_config()
    kept = [lib for lib in cfg.music_libraries if lib["id"] != library_id]
    if len(kept) == len(cfg.music_libraries):
        raise Invalid(f"unknown library: {library_id}")
    gone = next(lib for lib in cfg.music_libraries if lib["id"] == library_id)
    if gone["kind"] == FOLDER and gone["path"] not in cfg.music_dismissed:
        cfg.music_dismissed.append(gone["path"])
    cfg.music_libraries = kept
    save_config(cfg)
    with _lock:
        _remote.pop(library_id, None)
        _ytmusic.pop(library_id, None)
    (config_dir() / "music_remote" / f"{library_id}.json").unlink(missing_ok=True)


def android_storage() -> dict[str, list[dict[str, Any]]]:
    """What the Android app says is exposed to this server: ``{roots, folders}``, each
    ``{label, path}``. The app writes it into the config dir before starting the server."""
    try:
        data = json.loads((config_dir() / ANDROID_STORAGE).read_text("utf-8"))
        return {
            k: [x for x in data.get(k, []) if isinstance(x, dict)]
            for k in ("roots", "folders")
        }
    except (OSError, ValueError, AttributeError):
        return {"roots": [], "folders": []}


def sync_defaults() -> None:
    """Add the app's standard music folders that exist and are not libraries yet.

    Idempotent; a folder the user removed (``music_dismissed``) stays removed.
    """
    cfg = load_config()
    known = {lib.get("path") for lib in cfg.music_libraries} | set(cfg.music_dismissed)
    added = False
    for d in android_storage()["folders"]:
        path, label = str(d.get("path", "")), str(d.get("label", ""))
        if not path or path in known or not Path(path).is_dir():
            continue
        cfg.music_libraries.append(
            {
                "id": "f" + secrets.token_hex(3),
                "kind": FOLDER,
                "label": label or Path(path).name,
                "path": path,
            }
        )
        known.add(path)
        added = True
    if added:
        save_config(cfg)


def folder_roots() -> list[tuple[str, Path]]:
    """Every library made of files on this machine, ``local`` first."""
    return [
        (lib["id"], Path(lib["path"]))
        for lib in all_libraries()
        if lib["kind"] in ("local", FOLDER)
    ]


# --- files on this machine ----------------------------------------------------


def _files(lib_id: str, root: Path) -> list[downloaded.DownloadedFile]:
    return downloaded.audio_files(root, lib_id) if root.is_dir() else []


def file_for(track_id: str, library_id: str | None = None) -> Path | None:
    """The file of a local track (any local library when *library_id* is None)."""
    for lib_id, root in folder_roots():
        if library_id not in (None, lib_id):
            continue
        for f in _files(lib_id, root):
            if f.track_id == track_id:
                return root / f.path
    return None


def local_tracks(lib_id: str, root: Path) -> list[dict[str, Any]]:
    label = get(lib_id)["label"]
    return [
        {
            "id": f.track_id,
            "library": lib_id,
            "crate": lib_id,
            "library_label": label,
            "source": "file",
            "title": f.title,
            "artist": f.artist,
            "album": f.album,
            "duration": f.duration or 0,
            "folder": f.folder,
            "name": f.series,
            "path": f.path,
        }
        for f in _files(lib_id, root)
    ]


# --- remote sestudio servers --------------------------------------------------

_lock = threading.Lock()
_remote: dict[str, dict[str, Any]] = {}


def remote_id(library_id: str, remote_track: str) -> str:
    return f"{library_id}-{remote_track}"


def split_remote(track_id: str) -> tuple[dict[str, Any], str] | None:
    """(library, the remote's own id) of a track id made by ``remote_id``, else None."""
    head, dash, rest = track_id.partition("-")
    if not dash:
        return None
    lib = next(
        (x for x in registered() if x["id"] == head and x["kind"] == REMOTE), None
    )
    return (lib, rest) if lib else None


def _auth(lib: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {lib['token']}"}


def _cache_file(library_id: str) -> Path:
    return config_dir() / "music_remote" / f"{library_id}.json"


def _remote_state(lib: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        state = _remote.get(lib["id"])
        if state is None:
            state = {"tracks": [], "checked": 0.0, "offline_since": None, "error": ""}
            try:
                state |= json.loads(_cache_file(lib["id"]).read_text("utf-8"))
                state["checked"] = 0.0
            except (OSError, ValueError):
                pass
            _remote[lib["id"]] = state
        return state


def refresh_remote(lib: dict[str, Any], force: bool = False) -> dict[str, Any]:
    """The remote's cached listing and state, fetched again when older than ``TTL``.

    When the server cannot be reached the last listing stays, and ``offline_since``
    keeps the time of the first failure.
    """
    state = _remote_state(lib)
    now = time.time()
    if not force and now - state["checked"] < TTL:
        return state
    state["checked"] = now
    try:
        with httpx.Client(transport=transport, timeout=TIMEOUT) as client:
            r = client.get(f"{lib['url']}/api/music/share/tracks", headers=_auth(lib))
        if r.status_code == 401:
            raise httpx.HTTPError("The other server refused the token")
        r.raise_for_status()
        state["tracks"] = [t for t in r.json()["tracks"] if "id" in t]
        state["offline_since"], state["error"] = None, ""
        path = _cache_file(lib["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"tracks": state["tracks"]}), encoding="utf-8")
    except (httpx.HTTPError, ValueError, KeyError, TypeError, OSError) as exc:
        state["offline_since"] = state["offline_since"] or now
        state["error"] = str(exc) or type(exc).__name__
        logger.info("Music library %s is unreachable: %s", lib["id"], state["error"])
    return state


def remote_tracks(lib: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": remote_id(lib["id"], t["id"]),
            "library": lib["id"],
            "crate": lib["id"],
            "library_label": lib["label"],
            "source": "file",
            "title": t.get("title", ""),
            "artist": t.get("artist", ""),
            "album": t.get("album", ""),
            "duration": t.get("duration") or 0,
            "folder": t.get("folder", ""),
            "name": t.get("name", ""),
        }
        for t in refresh_remote(lib)["tracks"]
    ]


def remote_analysis(lib: dict[str, Any], remote_track: str) -> dict[str, Any] | None:
    """A remote track's analysis, asked of its server; None when it has none or is down."""
    try:
        with httpx.Client(transport=transport, timeout=TIMEOUT) as client:
            r = client.get(
                f"{lib['url']}/api/music/share/tracks/{remote_track}/analysis",
                headers=_auth(lib),
            )
        if r.status_code != 200:
            return None
        return {**r.json(), "id": remote_id(lib["id"], remote_track)}
    except (httpx.HTTPError, ValueError):
        return None


def remote_request(lib: dict[str, Any], remote_track: str, range_: str | None):
    """The request for a remote track's audio; the caller sends it, streaming."""
    # identity: the length and range headers are passed on as they come, so the bytes must be too.
    headers = _auth(lib) | {"Accept-Encoding": "identity"}
    headers |= {"Range": range_} if range_ else {}
    client = httpx.AsyncClient(transport=transport, timeout=TIMEOUT)
    return client, client.build_request(
        "GET",
        f"{lib['url']}/api/music/share/tracks/{remote_track}/audio",
        headers=headers,
    )


def mark_offline(library_id: str, error: str) -> None:
    with _lock:
        state = _remote.get(library_id)
    if state is not None:
        state["offline_since"] = state["offline_since"] or time.time()
        state["error"] = error


# --- YouTube Music account ----------------------------------------------------

_ytmusic: dict[str, dict[str, Any]] = {}


def ytmusic_cookies() -> str:
    path = load_config().ytmusic_cookies
    return path if path and Path(path).is_file() else ""


def ytmusic_tracks(lib: dict[str, Any], force: bool = False) -> dict[str, Any]:
    """The account's likes as online items: ``{tracks, state, error}``."""
    from sestudio.music import online
    from sestudio.sites import SiteError
    from sestudio.sites.creators import ytdlp_json

    cookies = ytmusic_cookies()
    if not cookies:
        return {"tracks": [], "state": "needs_signin", "error": ""}
    with _lock:
        hit = _ytmusic.get(lib["id"])
    if hit and not force and time.monotonic() - hit["at"] < YTMUSIC_TTL:
        return hit["out"]
    try:
        info = ytdlp_json(
            "--cookies", cookies, "--flat-playlist",
            "--playlist-end", str(YTMUSIC_MAX), YTMUSIC_LIKES,
        )  # fmt: skip
    except SiteError as exc:
        # Stale likes beat none; with nothing cached the library reads as offline.
        return hit["out"] | {"state": "offline", "error": str(exc)} if hit else {
            "tracks": [], "state": "offline", "error": str(exc),
        }  # fmt: skip
    tracks = [
        {
            **online.item(e, "ytmusic"),
            "crate": lib["id"],
            "library_label": lib["label"],
            "album": "",
            "folder": lib["id"],
            "name": lib["label"],
            "id": online.track_id(e["id"]),
        }
        for e in info.get("entries") or []
        if e.get("id")
    ]
    out = {"tracks": tracks, "state": "online", "error": ""}
    with _lock:
        _ytmusic[lib["id"]] = {"at": time.monotonic(), "out": out}
    return out


# --- listing and status -------------------------------------------------------


def tracks_of(lib: dict[str, Any]) -> list[dict[str, Any]]:
    if lib["kind"] == REMOTE:
        return remote_tracks(lib)
    if lib["kind"] == YTMUSIC:
        return ytmusic_tracks(lib)["tracks"]
    return local_tracks(lib["id"], Path(lib["path"]))


def other_tracks() -> list[dict[str, Any]]:
    """Every track of every library but ``local`` (that one is the downloads listing)."""
    return [t for lib in registered() for t in tracks_of(lib)]


def known_tracks() -> set[tuple[str, str]]:
    """``(library, track id)`` of every track a queue or playlist may hold."""
    out = {
        (lib_id, f.track_id)
        for lib_id, root in folder_roots()
        for f in _files(lib_id, root)
    }
    for lib in registered():
        if lib["kind"] == REMOTE:
            out |= {
                (lib["id"], remote_id(lib["id"], t["id"]))
                for t in refresh_remote(lib)["tracks"]
            }
    return out


def status(indexing: bool = False) -> list[dict[str, Any]]:
    """Each library with its state: online, offline (since when) or needing a sign-in,
    its track count, and how many are analysed."""
    stamps = store.stamps()
    out = []
    for lib in all_libraries():
        row = public(lib) | {"state": "online", "since": None, "error": ""}
        if lib["kind"] in ("local", FOLDER):
            root = Path(lib["path"])
            files = _files(lib["id"], root)
            done = sum(stamps.get(f.track_id) == (f.mtime, f.size) for f in files)
            row |= {"count": len(files), "indexed": done}
            row["indexing"] = indexing and done < len(files)
            if not root.is_dir():
                row |= {"state": "offline", "error": "Folder not found"}
        elif lib["kind"] == REMOTE:
            state = refresh_remote(lib)
            row |= {
                "count": len(state["tracks"]),
                "indexed": None,
                "indexing": False,
                "since": state["offline_since"],
                "error": state["error"],
                "state": "offline" if state["offline_since"] else "online",
            }
        else:
            found = ytmusic_tracks(lib)
            row |= {
                "count": len(found["tracks"]),
                "indexed": None,
                "indexing": False,
                "state": found["state"],
                "error": found["error"],
            }
        out.append(row)
    return out


# --- what this server shares --------------------------------------------------


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def tokens() -> list[dict[str, Any]]:
    return [
        {k: t[k] for k in ("id", "label", "created")}
        for t in load_config().music_share_tokens
    ]


def issue_token(label: str) -> tuple[dict[str, Any], str]:
    """A new token for another server; the secret is returned once and only its hash kept."""
    secret = "sst_" + secrets.token_urlsafe(24)
    record = {
        "id": secrets.token_hex(3),
        "label": label.strip() or "Another server",
        "created": int(time.time()),
    }
    cfg = load_config()
    cfg.music_share_tokens.append({**record, "hash": _hash(secret)})
    save_config(cfg)
    return record, secret


def revoke_token(token_id: str) -> None:
    cfg = load_config()
    kept = [t for t in cfg.music_share_tokens if t["id"] != token_id]
    if len(kept) == len(cfg.music_share_tokens):
        raise Invalid(f"unknown token: {token_id}")
    cfg.music_share_tokens = kept
    save_config(cfg)


def token_valid(secret: str) -> bool:
    digest = _hash(secret)
    return any(
        hmac.compare_digest(t.get("hash", ""), digest)
        for t in load_config().music_share_tokens
    )


def share_tracks() -> list[dict[str, Any]]:
    """Every track in the libraries made of files here, as another server lists them."""
    return [
        {
            "id": f.track_id,
            "title": f.title,
            "artist": f.artist,
            "album": f.album,
            "duration": f.duration or 0,
            "folder": f"{lib_id}:{f.folder}",
            "name": f.series,
        }
        for lib_id, root in folder_roots()
        for f in _files(lib_id, root)
    ]
