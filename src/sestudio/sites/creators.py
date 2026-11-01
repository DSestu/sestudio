"""YouTube and Twitch, read through yt-dlp: no account and no API key.

A video is a one-episode title (season 0), and yt-dlp resolves it on demand.
A channel lists its latest videos: YouTube's through yt-dlp, dated by the
channel's RSS feed; Twitch's from its public web GraphQL endpoint.
"""

from __future__ import annotations

import re
import threading
import time
from collections import defaultdict
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any
from urllib.parse import urlencode, urlsplit

# Imported with the app, not on first use: it takes over a second, which the
# first video opened would otherwise wait for.
import yt_dlp

from sestudio.catalogs import TtlCache
from sestudio.downloader import js_runtime_args
from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import Episode, SeasonCard, StreamSource
from sestudio.providers.base import StreamProvider
from sestudio.sites.base import (
    ContentSite,
    PageResult,
    ProxyFix,
    SiteError,
    StreamCandidate,
)

# These videos carry no VF/VOSTFR distinction: everything is the original.
LANG = "vo"


# YouTube bans an IP for up to an hour when it asks too much: once it says so,
# stop asking for a while (asking again only extends the ban), and never ask
# more than two things at once.
_YOUTUBE_COOLDOWN = 15 * 60
_youtube_blocked_until = 0.0
_youtube_slots = threading.BoundedSemaphore(2)


def _is_youtube(url: str) -> bool:
    return url.startswith("ytsearch") or "youtube.com" in url or "youtu.be" in url


def ytdlp_json(*args: str) -> dict[str, Any]:
    """What ``yt-dlp -J <args>`` prints, or SiteError with yt-dlp's reason.

    Run in this process rather than as a command: starting yt-dlp alone takes
    over a second, which was a third of the wait before a video plays. The
    arguments are yt-dlp's own command line, parsed by yt-dlp; the last is the URL.
    """
    argv = [
        "--ignore-config",
        # yt-dlp's default only reports an extraction error and returns
        # nothing; in-process that hid every failure (subscriber-only videos,
        # YouTube's rate limit) behind an empty result that got cached.
        "--abort-on-error",
        "--quiet",
        "--no-warnings",
        "--socket-timeout",
        "20",
        *js_runtime_args(),
        *args,
    ]
    parsed = yt_dlp.parse_options(argv)
    url = parsed.urls[-1]
    if not _is_youtube(url):
        return _extract(parsed.ydl_opts, url)
    global _youtube_blocked_until
    wait = _youtube_blocked_until - time.monotonic()
    if wait > 0:
        raise SiteError(
            f"YouTube is rate-limiting this server; try again in {wait / 60:.0f} min"
        )
    with _youtube_slots:
        try:
            return _extract(parsed.ydl_opts, url)
        except SiteError as exc:
            if "rate-limited" in str(exc):
                _youtube_blocked_until = time.monotonic() + _YOUTUBE_COOLDOWN
            raise


def _extract(ydl_opts: dict[str, Any], url: str) -> dict[str, Any]:
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            return ydl.sanitize_info(ydl.extract_info(url, download=False)) or {}
    except yt_dlp.utils.YoutubeDLError as exc:
        message = str(exc).removeprefix("ERROR: ")
        if "subscriber-only" in message:
            # No account here, so no subscription: say so rather than relay
            # yt-dlp's advice about passing cookies.
            message = "Subscribers only: Twitch keeps this broadcast for the channel's subscribers"
        raise SiteError(message) from exc


def stream_url(info: dict[str, Any]) -> str:
    """The URL a browser can play: the HLS master when there is one (Twitch,
    YouTube, live streams), which carries every quality and the audio tracks,
    else the best single file holding both picture and sound."""
    formats = [f for f in info.get("formats") or [] if f.get("url")]
    for f in reversed(formats):
        if str(f.get("protocol", "")).startswith("m3u8") and f.get("manifest_url"):
            return f["manifest_url"]
    files = [
        f
        for f in formats
        if str(f.get("protocol", "")).startswith("http")
        and f.get("vcodec") != "none"
        and f.get("acodec") != "none"
    ]
    if not files:
        raise SiteError(f"No playable format for {info.get('webpage_url')}")
    return max(files, key=lambda f: f.get("height") or 0)["url"]


def video_card(info: dict[str, Any], source: str, url: str = "") -> dict[str, Any]:
    """A video as the client sees it, from a full or a flat yt-dlp entry."""
    thumbs = info.get("thumbnails") or []
    return {
        "source": source,
        "page_url": info.get("webpage_url") or info.get("url") or url,
        "title": info.get("title") or url,
        "channel": info.get("channel") or info.get("uploader") or "",
        "channel_url": info.get("channel_url") or info.get("uploader_url") or "",
        "thumbnail": info.get("thumbnail") or (thumbs[-1].get("url") if thumbs else ""),
        "duration": info.get("duration") or 0,
        "is_live": bool(info.get("is_live")),
        "timestamp": info.get("timestamp") or info.get("release_timestamp") or 0,
        "view_count": info.get("view_count") or info.get("concurrent_view_count") or 0,
    }


class _YtDlpSite(ContentSite):
    hosts: tuple[str, ...] = ()
    # Kept out of the title search: their own Videos kind comes later.
    searchable = False
    # Their HLS master holds every quality: one is picked from it, never
    # re-encoded down from the best (see routes/stream.py `source_qualities`).
    source_qualities = True

    def __init__(self) -> None:
        # googlevideo URLs stop working after about 6 hours.
        self._info = TtlCache(4 * 3600)
        # One yt-dlp run per URL at a time: the watch view asks for the title
        # page and the link card together, and each run costs seconds.
        self._info_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
        self._channels = TtlCache(600)

    def owns_url(self, url: str) -> bool:
        host = (urlsplit(url).hostname or "").removeprefix("www.").removeprefix("m.")
        return host in self.hosts

    def search(self, query: str) -> list[SeasonCard]:
        return []

    def provider_order(self) -> tuple[str, ...]:
        return (self.id,)

    def info(self, url: str) -> dict[str, Any]:
        with self._info_locks[url]:
            return self._info.get(url, lambda: ytdlp_json("--no-playlist", url))

    def video(self, url: str) -> dict[str, Any]:
        """What the app shows for one video or live stream."""
        info = self.info(url)
        return video_card(info, self.id, url)

    # The channel page's tabs, first one the default: id -> label.
    tabs: dict[str, str] = {}

    def channel(self, url: str, tab: str = "") -> dict[str, Any]:
        """A channel and its latest videos on one tab (and its live stream, if
        on now)."""
        tab = tab if tab in self.tabs else next(iter(self.tabs))
        channel = self._channels.get(f"{tab}:{url}", lambda: self._channel(url, tab))
        return {
            **channel,
            "tab": tab,
            "tabs": [{"id": k, "label": v} for k, v in self.tabs.items()],
        }

    def _channel(self, url: str, tab: str) -> dict[str, Any]:
        raise NotImplementedError

    def latest(self, url: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        """A followed channel's newest videos and its live stream, cheaply: run
        every few minutes for every channel followed."""
        raise NotImplementedError

    def fetch_page(self, url: str, lang: str = LANG) -> PageResult:
        info = self.info(url)
        episode = Episode(
            number=1,
            title=info.get("title") or url,
            season=0,
            embed_urls={self.id: url},
            langs=[LANG],
        )
        return PageResult(
            season=0, episodes=[episode], is_film=True, available_langs=[LANG]
        )

    def resolve_candidate(
        self,
        candidate: StreamCandidate,
        host_resolvers: dict[str, StreamProvider],
    ) -> StreamSource:
        if candidate.provider != self.id:
            raise SiteError(f"No resolver for provider {candidate.provider!r}")
        info = self.info(candidate.embed_url)
        if info.get("is_live"):
            # A live manifest is only good while the stream runs: never reuse one.
            info = ytdlp_json("--no-playlist", candidate.embed_url)
        headers = info.get("http_headers") or {}
        return StreamSource(
            url=stream_url(info),
            referer=info.get("webpage_url") or candidate.embed_url,
            provider=self.id,
            user_agent=headers.get("User-Agent") or BROWSER_UA,
            # Downloads hand yt-dlp the page instead, so it picks and merges the
            # best video and audio itself.
            extract_url=candidate.embed_url,
        )


def h264_only(playlist: bytes) -> bytes:
    """Drop the VP9 and AV1 variants from an HLS master, with their URI lines.

    Chrome plays them, but Chromecast, Safari and many TVs can't, and a player
    choosing one by bandwidth has no idea it won't decode.
    """
    out: list[str] = []
    skip_uri = False
    for line in playlist.decode("utf-8", errors="replace").splitlines():
        if skip_uri and line and not line.startswith("#"):
            skip_uri = False
            continue
        if line.startswith("#EXT-X-STREAM-INF") and re.search(r"vp09|av01", line):
            skip_uri = True
            continue
        out.append(line)
    return "\n".join(out).encode()


def original_audio_first(playlist: bytes) -> bytes:
    """Make a YouTube master's original audio the default, ahead of its dubs.

    YouTube lists AI-dubbed tracks ("Français - dubbed") beside the original
    ("American English - original") and marks none as the default, so a player
    took the first in the list or one matching the browser's language: a dub.
    The dubs stay selectable; a video with no track marked original is left as
    it is.
    """
    lines = playlist.decode("utf-8", errors="replace").splitlines()

    def is_audio(line: str) -> bool:
        return line.startswith("#EXT-X-MEDIA") and "TYPE=AUDIO" in line

    def is_original(line: str) -> bool:
        return bool(re.search(r'NAME="[^"]*\boriginal"', line))

    audio = [line for line in lines if is_audio(line)]
    originals = [line for line in audio if is_original(line)]
    if not originals:
        return playlist
    marked = [re.sub(r"DEFAULT=NO", "DEFAULT=YES", line) for line in originals]
    others = [
        re.sub(r"DEFAULT=YES", "DEFAULT=NO", line)
        for line in audio
        if not is_original(line)
    ]
    out: list[str] = []
    for line in lines:
        if not is_audio(line):
            out.append(line)
        elif line is audio[0]:
            out += marked + others
    return "\n".join(out).encode()


class YouTubeSite(_YtDlpSite):
    id = "youtube"
    display_name = "YouTube"
    home_url = "https://www.youtube.com"
    films_dirname = "YouTube"
    hosts = ("youtube.com", "music.youtube.com", "youtu.be")

    def proxy_fix(self, url: str) -> ProxyFix | None:
        if "/hls_variant/" not in url:
            return None
        return ProxyFix({}, lambda body: original_audio_first(h264_only(body)))

    def search_channels(self, query: str) -> list[dict[str, Any]]:
        """YouTube channels matching a query: one yt-dlp run on YouTube's own
        search, filtered to channels."""
        url = "https://www.youtube.com/results?" + urlencode(
            {"search_query": query, "sp": "EgIQAg=="}
        )
        return self._channels.get(
            f"channels:{query}",
            lambda: [
                youtube_channel_hit(entry)
                for entry in ytdlp_json(
                    "--flat-playlist", "--playlist-end", "12", url
                ).get("entries")
                or []
                if entry.get("channel_id")
            ],
        )

    def search_videos(self, query: str) -> list[dict[str, Any]]:
        """YouTube's own search, through yt-dlp: the top 20 videos."""
        return self._channels.get(
            f"search:{query}",
            lambda: [
                video_card(entry, self.id)
                for entry in ytdlp_json("--flat-playlist", f"ytsearch20:{query}").get(
                    "entries"
                )
                or []
            ],
        )

    def latest(self, url: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        # shortcut: no live check for YouTube, which would cost a yt-dlp run per
        # channel per poll; add one on /channel/<id>/live if it is missed.
        match = re.search(r"/channel/(UC[\w-]+)", url)
        if not match:
            raise SiteError(f"Follow a YouTube channel by its /channel/ address: {url}")
        videos = [
            {
                "source": self.id,
                "page_url": entry["page_url"],
                "title": entry["title"],
                "channel": "",
                "channel_url": url,
                "thumbnail": entry["thumbnail"],
                "duration": 0,
                "is_live": False,
                "timestamp": entry["timestamp"],
                "view_count": 0,
            }
            for entry in youtube_feed(match.group(1))
        ]
        return videos, None

    tabs = {"videos": "Videos", "streams": "Past streams"}

    def _channel(self, url: str, tab: str = "videos") -> dict[str, Any]:
        base = re.sub(
            r"/(videos|streams|shorts|featured|live|playlists)$",
            "",
            url.split("?")[0].rstrip("/"),
        )
        # Shorts have a tab of their own, deliberately not offered.
        listing = ytdlp_json("--flat-playlist", "--playlist-end", "30", f"{base}/{tab}")
        name = listing.get("channel") or listing.get("uploader") or ""
        channel_url = listing.get("channel_url") or base
        dates = youtube_feed_dates(
            listing.get("channel_id") or "", "UULV" if tab == "streams" else "UULF"
        )
        videos = []
        for entry in listing.get("entries") or []:
            card = video_card(entry, self.id)
            card.update(channel=name, channel_url=channel_url)
            card["timestamp"] = card["timestamp"] or dates.get(entry.get("id") or "", 0)
            videos.append(card)
        thumbs = listing.get("thumbnails") or []
        avatar = next(
            (t["url"] for t in thumbs if t.get("id") == "avatar_uncropped"), ""
        )
        return {
            "source": self.id,
            "name": name,
            "url": channel_url,
            # "=s0" asks for the original upload, megabytes for a 64px circle.
            "avatar": re.sub(r"=s0$", "=s176", avatar),
            "live": None,
            "videos": videos,
        }


class TwitchSite(_YtDlpSite):
    id = "twitch"
    display_name = "Twitch"
    home_url = "https://www.twitch.tv"
    films_dirname = "Twitch"
    hosts = ("twitch.tv", "clips.twitch.tv")

    def video(self, url: str) -> dict[str, Any]:
        card = super().video(url)
        login = self.info(url).get("uploader_id")
        if not card["channel_url"] and login:
            card["channel_url"] = f"https://www.twitch.tv/{login}"
        return card

    tabs = {"videos": "Past broadcasts", "highlights": "Highlights"}

    def _channel(self, url: str, tab: str = "videos") -> dict[str, Any]:
        login = urlsplit(url).path.strip("/").split("/")[0].lower()
        if not re.fullmatch(r"\w{1,25}", login) or login == "videos":
            raise SiteError(f"Not a Twitch channel: {url}")
        kind = "HIGHLIGHT" if tab == "highlights" else "ARCHIVE"
        user = twitch_gql(_TWITCH_CHANNEL, {"login": login, "type": kind}).get("user")
        if not user:
            raise SiteError(f"No Twitch channel called {login}")
        return twitch_channel(user)

    def search_channels(self, query: str) -> list[dict[str, Any]]:
        """Twitch channels matching a query, in Twitch's own order."""
        return self._channels.get(f"search:{query}", lambda: twitch_search(query))

    def latest(self, url: str) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        channel = self._channel(url)
        live = channel["live"]
        videos = channel["videos"]
        if live:
            # The stream on now is already listed as a broadcast that is still
            # being recorded: it is news, and downloadable, once it ends.
            videos = [v for v in videos if v["timestamp"] < live["timestamp"] - 300]
        return videos, live


def _timestamp(iso: str | None) -> int:
    return (
        int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
        if iso
        else 0
    )


_ATOM = {
    "a": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}


def youtube_feed(channel_id: str, playlist: str = "UULF") -> list[dict[str, Any]]:
    """A channel's last 15 uploads of one kind, newest first, from its RSS feed.

    ``UULF`` is its uploads without Shorts and streams, matching its Videos
    tab; ``UULV`` its past streams. One free request, no key; raises SiteError.
    """
    try:
        with new_client(headers={"User-Agent": BROWSER_UA}) as client:
            resp = client.get(
                "https://www.youtube.com/feeds/videos.xml",
                params={"playlist_id": playlist + channel_id.removeprefix("UC")},
            )
            resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except Exception as exc:  # noqa: BLE001
        raise SiteError(f"youtube feed: {exc}") from exc
    entries = []
    for entry in root.findall("a:entry", _ATOM):
        video_id = entry.findtext("yt:videoId", "", _ATOM)
        thumb = entry.find("media:group/media:thumbnail", _ATOM)
        entries.append(
            {
                "id": video_id,
                "page_url": f"https://www.youtube.com/watch?v={video_id}",
                "title": entry.findtext("a:title", "", _ATOM),
                "timestamp": _timestamp(entry.findtext("a:published", "", _ATOM)),
                "thumbnail": thumb.get("url", "") if thumb is not None else "",
            }
        )
    return entries


def youtube_feed_dates(channel_id: str, playlist: str = "UULF") -> dict[str, int]:
    """Upload time of a channel's latest videos, by video id.

    yt-dlp's flat listing has no dates. Empty on any failure: the dates are a
    nicety, the listing still stands.
    """
    try:
        return (
            {e["id"]: e["timestamp"] for e in youtube_feed(channel_id, playlist)}
            if channel_id
            else {}
        )
    except SiteError:
        return {}


# Twitch's own web client id, the one yt-dlp sends too: public, no account.
_TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
_TWITCH_CHANNEL = """
query($login: String!, $type: BroadcastType = ARCHIVE) {
  user(login: $login) {
    login displayName profileImageURL(width: 150)
    stream { title viewersCount createdAt previewImageURL(width: 640, height: 360) }
    videos(first: 30, type: $type, sort: TIME) {
      edges { node {
        id title lengthSeconds publishedAt viewCount
        previewThumbnailURL(width: 640, height: 360)
      } }
    }
  }
}
"""


def twitch_gql(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    try:
        with new_client(headers={"Client-ID": _TWITCH_CLIENT_ID}) as client:
            resp = client.post(
                "https://gql.twitch.tv/gql",
                json={"query": query, "variables": variables},
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise SiteError(f"twitch: {exc}") from exc
    if body.get("errors"):
        raise SiteError(f"twitch: {body['errors'][0].get('message')}")
    return body.get("data") or {}


def twitch_channel(user: dict[str, Any]) -> dict[str, Any]:
    """A Twitch user from GraphQL, as the client sees a channel."""
    name = user.get("displayName") or user["login"]
    url = f"https://www.twitch.tv/{user['login']}"
    stream = user.get("stream")
    live = (
        {
            "source": "twitch",
            "page_url": url,
            "title": stream.get("title") or name,
            "channel": name,
            "channel_url": url,
            "thumbnail": stream.get("previewImageURL") or "",
            "duration": 0,
            "is_live": True,
            "timestamp": _timestamp(stream.get("createdAt")),
            "view_count": stream.get("viewersCount") or 0,
        }
        if stream
        else None
    )
    videos = [
        {
            "source": "twitch",
            "page_url": f"https://www.twitch.tv/videos/{node['id']}",
            "title": node.get("title") or node["id"],
            "channel": name,
            "channel_url": url,
            "thumbnail": node.get("previewThumbnailURL") or "",
            "duration": node.get("lengthSeconds") or 0,
            "is_live": False,
            "timestamp": _timestamp(node.get("publishedAt")),
            "view_count": node.get("viewCount") or 0,
        }
        for node in (e["node"] for e in (user.get("videos") or {}).get("edges") or [])
    ]
    return {
        "source": "twitch",
        "name": name,
        "url": url,
        "avatar": user.get("profileImageURL") or "",
        "live": live,
        "videos": videos,
    }


_TWITCH_LIVE = """
query($logins: [String!]) {
  users(logins: $logins) {
    login displayName profileImageURL(width: 150)
    stream {
      title viewersCount createdAt previewImageURL(width: 640, height: 360)
      game { name }
    }
  }
}
"""


def twitch_live(logins: list[str]) -> list[dict[str, Any]]:
    """Which of these Twitch channels are live now, in one request."""
    if not logins:
        return []
    users = twitch_gql(_TWITCH_LIVE, {"logins": logins[:100]}).get("users") or []
    live = []
    for user in users:
        if not user or not user.get("stream"):
            continue
        card = twitch_channel({**user, "videos": None})["live"]
        card["avatar"] = user.get("profileImageURL") or ""
        card["game"] = ((user["stream"].get("game") or {}).get("name")) or ""
        live.append(card)
    return live


_TWITCH_SEARCH = """
query($q: String!) {
  searchUsers(userQuery: $q, first: 12) {
    edges { node {
      login displayName profileImageURL(width: 150)
      followers { totalCount }
      stream { title viewersCount game { name } }
    } }
  }
}
"""


def twitch_search(query: str) -> list[dict[str, Any]]:
    """Twitch channels whose name matches *query*, as the client lists them."""
    edges = (twitch_gql(_TWITCH_SEARCH, {"q": query}).get("searchUsers") or {}).get(
        "edges"
    ) or []
    out = []
    for node in (e["node"] for e in edges if e.get("node")):
        stream = node.get("stream") or {}
        out.append(
            {
                "source": "twitch",
                "name": node.get("displayName") or node["login"],
                "url": f"https://www.twitch.tv/{node['login']}",
                "avatar": node.get("profileImageURL") or "",
                "followers": (node.get("followers") or {}).get("totalCount") or 0,
                "live": bool(stream),
                "game": (stream.get("game") or {}).get("name") or "",
            }
        )
    return out


def youtube_channel_hit(entry: dict[str, Any]) -> dict[str, Any]:
    """A YouTube channel from yt-dlp's flat search, as the client lists it."""
    thumbs = entry.get("thumbnails") or []
    avatar = thumbs[-1].get("url", "") if thumbs else ""
    return {
        "source": "youtube",
        "name": entry.get("title") or entry.get("channel") or "",
        # The /channel/ address: the one a follow is keyed by.
        "url": f"https://www.youtube.com/channel/{entry['channel_id']}",
        "avatar": "https:" + avatar if avatar.startswith("//") else avatar,
        "followers": entry.get("channel_follower_count") or 0,
        "live": False,
        "game": "",
    }
