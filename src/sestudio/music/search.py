"""One music search across the libraries and the online sources (SPEC-music §11, PR 17).

Online sources go through yt-dlp: YouTube Music's and YouTube's own search pages
and ``scsearch`` for SoundCloud. They run side by side, each with a timeout, and
every hit comes back in the shape of a queue item so it can be played as is.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any
from urllib.parse import urlencode

from sestudio import downloaded
from sestudio.music import online
from sestudio.sites.creators import ytdlp_json

logger = logging.getLogger(__name__)

ONLINE_SOURCES = ("ytmusic", "youtube", "soundcloud")
SOURCES = ("all", "library", *ONLINE_SOURCES)
#: How long one source may take before the search answers without it.
TIMEOUT = 15.0
_TTL = 300.0
LIBRARY_LIMIT = 30

_cache: dict[tuple[str, str, int], tuple[float, list[dict[str, Any]]]] = {}
_lock = threading.Lock()


def _thumb(entry: dict[str, Any]) -> str:
    thumbs = entry.get("thumbnails") or []
    best = next((t for t in thumbs if t.get("id") == "t300x300"), None)
    return (best or (thumbs[-1] if thumbs else {})).get("url", "")


def _hit(entry: dict[str, Any], source: str) -> dict[str, Any] | None:
    """A queue item plus what the results list shows, or None for a hit that
    is not playable (an artist page, an album browse page)."""
    eid = str(entry.get("id") or "")
    if not eid or not entry.get("title"):
        return None
    if source == "soundcloud":
        kind, thumb = "track", _thumb(entry)
    else:
        if entry.get("ie_key") == "YoutubeTab" or not online.video_id(
            online.track_id(eid)
        ):
            return None
        kind = "track" if source == "ytmusic" else "video"
        thumb = f"https://i.ytimg.com/vi/{eid}/mqdefault.jpg"
    out = online.item(entry, source)
    return {
        **out,
        "id": out["track_id"],
        "kind": kind,
        "thumb": thumb,
        "url": online.page_url(out["track_id"].removeprefix(online.PREFIX)),
    }


def _fetch(source: str, query: str, limit: int) -> list[dict[str, Any]]:
    if source == "soundcloud":
        info = ytdlp_json("--flat-playlist", f"scsearch{limit}:{query}")
    elif source == "youtube":
        info = ytdlp_json("--flat-playlist", f"ytsearch{limit}:{query}")
    else:
        url = "https://music.youtube.com/search?" + urlencode({"q": query})
        info = ytdlp_json("--flat-playlist", "--playlist-end", str(limit), url)
    hits = (_hit(e, source) for e in info.get("entries") or [])
    return [h for h in hits if h]


def _cached(source: str, query: str, limit: int) -> list[dict[str, Any]]:
    key = (source, query.casefold(), limit)
    with _lock:
        hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    found = _fetch(source, query, limit)
    with _lock:
        _cache[key] = (time.monotonic() + _TTL, found)
    return found


def search_online(
    query: str, sources: list[str], limit: int, timeout: float = TIMEOUT
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The hits of each source (interleaved, so no source buries another) and
    the reason each silent source gave."""
    pool = ThreadPoolExecutor(max_workers=len(sources) or 1)
    futures = {s: pool.submit(_cached, s, query, limit) for s in sources}
    wait(futures.values(), timeout=timeout)
    # Not waited for: a source stuck past its timeout finishes in the background.
    pool.shutdown(wait=False)
    found: dict[str, list[dict[str, Any]]] = {}
    errors: dict[str, str] = {}
    for source, fut in futures.items():
        if not fut.done():
            errors[source] = "timed out"
        elif exc := fut.exception():
            logger.warning("Music search on %s failed: %s", source, exc)
            errors[source] = str(exc) or "failed"
        else:
            found[source] = fut.result()
    longest = max((len(v) for v in found.values()), default=0)
    rows = [
        found[s][i]
        for i in range(longest)
        for s in sources
        if i < len(found.get(s, ()))
    ]
    return rows, errors


def search_library(query: str, root: str) -> list[dict[str, Any]]:
    words = query.casefold().split()
    out: list[dict[str, Any]] = []
    for f in downloaded.scan(root):
        if f.kind != "audio":
            continue
        hay = f"{f.title} {f.artist} {f.album}".casefold()
        if all(w in hay for w in words):
            out.append(
                {
                    "library": downloaded.LOCAL_LIBRARY,
                    "track_id": f.track_id,
                    "id": f.track_id,
                    "title": f.title,
                    "artist": f.artist,
                    "album": f.album,
                    "duration": f.duration or 0,
                }
            )
    return out[:LIBRARY_LIMIT]


def _top(
    query: str, library: list[dict[str, Any]], rows: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """The best single answer: an artist whose name holds every word of the
    query and who has at least two tracks in the results, else the first track."""
    words = query.casefold().split()
    by_artist: dict[str, list[dict[str, Any]]] = {}
    for t in [*library, *rows]:
        name = (t.get("artist") or "").strip()
        if name and all(w in name.casefold() for w in words):
            by_artist.setdefault(name, []).append(t)
    best = max(by_artist.items(), key=lambda kv: len(kv[1]), default=None)
    if best and len(best[1]) >= 2:
        thumb = next((t["thumb"] for t in best[1] if t.get("thumb")), "")
        return {"kind": "artist", "name": best[0], "thumb": thumb, "tracks": best[1]}
    first = (library or rows or [None])[0]
    return {"kind": "track", **first} if first else None


def search(
    query: str,
    source: str,
    limit: int,
    root: str,
) -> dict[str, Any]:
    query = query.strip()
    if not query:
        return {"top": None, "library": [], "online": [], "errors": {}}
    library = search_library(query, root) if source in ("all", "library") else []
    sources = (
        list(ONLINE_SOURCES)
        if source == "all"
        else [source]
        if source in ONLINE_SOURCES
        else []
    )
    rows, errors = search_online(query, sources, limit) if sources else ([], {})
    return {
        "top": _top(query, library, rows),
        "library": library,
        "online": rows,
        "errors": errors,
    }
