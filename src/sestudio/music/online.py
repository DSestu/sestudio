"""YouTube and YouTube Music as music (SPEC-music §4, §13.3).

A video becomes a queue item ``{library: "online", source, track_id: "yt:<id>"}``
carrying its title, artist and duration, so the queue can show it without the
server asking again. Playing one resolves the best audio stream with yt-dlp and
the player is sent to it; the first time a track is fetched its audio is also
analysed once in the background, then the temporary copy is deleted.
"""

from __future__ import annotations

import logging
import re
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import yt_dlp

from sestudio.downloader import js_runtime_args
from sestudio.media import ffmpeg_location
from sestudio.music import analysis, genres, runner, store
from sestudio.sites.creators import ytdlp_json

logger = logging.getLogger(__name__)

ONLINE_LIBRARY = "online"
PREFIX = "yt:"
#: SoundCloud tracks (``sc:<numeric id>``) stream the same way, from their API address.
SC_PREFIX = "sc:"
MAX_PLAYLIST = 200
#: A resolved audio URL is good for hours; an hour of reuse keeps skips cheap.
_TTL = 3600.0

_ID_RE = re.compile(r"^[\w-]{11}$")
_SC_RE = re.compile(r"^sc:\d+$")
_HOSTS = ("youtube.com", "youtu.be")


@dataclass(frozen=True)
class Link:
    kind: str  # "video" | "playlist"
    id: str
    source: str  # "youtube" | "ytmusic"

    @property
    def url(self) -> str:
        host = "music.youtube.com" if self.source == "ytmusic" else "www.youtube.com"
        if self.kind == "playlist":
            return f"https://{host}/playlist?list={self.id}"
        return f"https://{host}/watch?v={self.id}"


def parse_url(text: str) -> Link | None:
    """What a pasted YouTube / YouTube Music address points at, or None."""
    text = text.strip()
    if " " in text or not text.startswith(("http://", "https://")):
        return None
    u = urlparse(text)
    host = (u.hostname or "").removeprefix("www.").removeprefix("m.")
    if not any(host == h or host.endswith("." + h) for h in _HOSTS):
        return None
    query = parse_qs(u.query)
    source = "ytmusic" if host == "music.youtube.com" else "youtube"
    if host == "youtu.be":
        vid = u.path.strip("/")
    elif u.path == "/playlist":
        pid = (query.get("list") or [""])[0]
        return Link("playlist", pid, source) if pid else None
    elif u.path == "/watch":
        vid = (query.get("v") or [""])[0]
    else:  # /shorts/<id>, /embed/<id>, /live/<id>
        head, _, vid = u.path.strip("/").partition("/")
        if head not in ("shorts", "embed", "live"):
            return None
    return Link("video", vid, source) if _ID_RE.match(vid) else None


def track_id(video_id: str) -> str:
    return PREFIX + video_id


def page_url(key: str) -> str:
    """The address yt-dlp reads a resolvable id (see `video_id`) from."""
    if key.startswith(SC_PREFIX):
        return "https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A" + key[3:]
    return f"https://www.youtube.com/watch?v={key}"


def video_id(tid: str) -> str | None:
    """What a track id resolves by: the bare video id of a YouTube track, the
    whole id of a SoundCloud one, None for anything else."""
    if _SC_RE.match(tid):
        return tid
    vid = tid.removeprefix(PREFIX)
    return vid if tid.startswith(PREFIX) and _ID_RE.match(vid) else None


def _artist(info: dict[str, Any]) -> str:
    raw = (
        info.get("artist")
        or (info.get("artists") or [""])[0]
        or info.get("channel")
        or info.get("uploader")
        or ""
    )
    return str(raw).removesuffix(" - Topic")


def item(info: dict[str, Any], source: str) -> dict[str, Any]:
    """A queue item from a yt-dlp entry (full or flat)."""
    return {
        "library": ONLINE_LIBRARY,
        "source": source,
        "track_id": (SC_PREFIX if source == "soundcloud" else PREFIX) + str(info["id"]),
        "title": info.get("track") or info.get("title") or info["id"],
        "artist": _artist(info),
        "duration": float(info.get("duration") or 0),
    }


# --- resolving ----------------------------------------------------------------

_resolved: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


def resolve(vid: str) -> dict[str, Any]:
    """The best audio stream of a video: ``{url, referer, info}``. Raises SiteError."""
    with _lock:
        hit = _resolved.get(vid)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    # SoundCloud's HLS variants do not play in a browser: take its plain file.
    fmt = "ba[protocol^=http]/ba" if vid.startswith(SC_PREFIX) else "ba"
    page = page_url(vid)
    info = ytdlp_json("--no-playlist", "-f", fmt, page)
    url = info.get("url") or next(
        (f["url"] for f in reversed(info.get("formats") or []) if f.get("url")), ""
    )
    out = {"url": url, "referer": info.get("webpage_url") or page, "info": info}
    with _lock:
        _resolved[vid] = (time.monotonic() + _TTL, out)
    return out


def complete(ref: dict[str, Any]) -> dict[str, Any]:
    """A client's online queue item with its metadata: kept when it has a title,
    else looked up. Raises ValueError for an id that is not a video, SiteError
    when the lookup fails."""
    vid = video_id(str(ref.get("track_id", "")))
    if vid is None:
        raise ValueError(f"not an online track: {ref.get('track_id')}")
    source = ref.get("source") or (
        "soundcloud" if vid.startswith(SC_PREFIX) else "youtube"
    )
    # A search hit may lack its length, which the timeline needs: look it up.
    if ref.get("title") and ref.get("duration"):
        return {**ref, "library": ONLINE_LIBRARY, "source": source}
    info = resolve(vid)["info"]
    return item({**info, "id": vid.removeprefix(SC_PREFIX)}, source)


def expand(link: Link) -> dict[str, Any]:
    """A link as queue items: one for a video, the entries for a playlist."""
    if link.kind == "video":
        return {"title": "", "tracks": [item(resolve(link.id)["info"], link.source)]}
    info = ytdlp_json("--flat-playlist", "--playlist-end", str(MAX_PLAYLIST), link.url)
    tracks = [item(e, link.source) for e in info.get("entries") or [] if e.get("id")]
    return {"title": info.get("title") or "", "tracks": tracks}


# --- analysis on first fetch --------------------------------------------------

#: The analysis keeps what it needs; the audio it was taken from is not kept.
_busy: set[str] = set()


def kick_analysis(tid: str) -> None:
    """Analyse a streamed track once, in the background; a no-op when it already is."""
    vid = video_id(tid)
    if vid is None or not runner.enabled():
        return
    with _lock:
        if tid in _busy or tid in store.stamps():
            return
        _busy.add(tid)
    threading.Thread(
        target=_analyse, args=(tid, vid), daemon=True, name="music-online"
    ).start()


def _analyse(tid: str, vid: str) -> None:
    work = Path(tempfile.mkdtemp(prefix="sestudio-online-"))
    try:
        argv = ["--ignore-config", "--quiet", "--no-warnings", "-f", "ba"]
        if ffmpeg := ffmpeg_location():
            argv += ["--ffmpeg-location", ffmpeg]
        argv += [*js_runtime_args(), "-o", str(work / "%(id)s.%(ext)s")]
        url = page_url(vid)
        parsed = yt_dlp.parse_options([*argv, url])
        with yt_dlp.YoutubeDL(parsed.ydl_opts) as ydl:
            ydl.download([url])
        file = next(p for p in work.iterdir() if p.suffix != ".part")
        a = analysis.analyse_file(str(file))
        with _lock:
            info = (_resolved.get(vid) or (0, {}))[1].get("info") or {}
        a.extra = genres.decide(
            a.extra, str(file), a.duration, genres.source_genre(info), "source"
        )
        store.save(tid, 0.0, file.stat().st_size, a)
        store.renormalise_if_needed()
    except Exception:
        logger.warning("Could not analyse %s", tid, exc_info=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        with _lock:
            _busy.discard(tid)
