"""YouTube and Twitch, read through yt-dlp: no account and no API key.

A video is a one-episode title (season 0), and yt-dlp resolves it on demand.
A channel lists its latest videos: YouTube's through yt-dlp, dated by the
channel's RSS feed; Twitch's from its public web GraphQL endpoint.
"""

from __future__ import annotations

import json
import re
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sestudio.catalogs import TtlCache
from sestudio.downloader import check_yt_dlp, js_runtime_args
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


def ytdlp_json(*args: str, timeout: float = 60) -> dict[str, Any]:
    """Run ``yt-dlp -J`` and return its JSON, or raise SiteError with its reason."""
    cmd = [check_yt_dlp(), "-J", "--no-warnings", *js_runtime_args(), *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise SiteError(f"yt-dlp timed out after {timeout:.0f}s") from exc
    if proc.returncode != 0:
        lines = [ln for ln in proc.stderr.splitlines() if ln.strip()]
        raise SiteError(lines[-1] if lines else f"yt-dlp exited {proc.returncode}")
    try:
        return json.loads(proc.stdout)
    except ValueError as exc:
        raise SiteError(f"yt-dlp returned no JSON: {exc}") from exc


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

    def __init__(self) -> None:
        # googlevideo URLs stop working after about 6 hours.
        self._info = TtlCache(4 * 3600)
        self._channels = TtlCache(600)

    def owns_url(self, url: str) -> bool:
        host = (urlsplit(url).hostname or "").removeprefix("www.").removeprefix("m.")
        return host in self.hosts

    def search(self, query: str) -> list[SeasonCard]:
        return []

    def provider_order(self) -> tuple[str, ...]:
        return (self.id,)

    def info(self, url: str) -> dict[str, Any]:
        return self._info.get(url, lambda: ytdlp_json("--no-playlist", url))

    def video(self, url: str) -> dict[str, Any]:
        """What the app shows for one video or live stream."""
        info = self.info(url)
        return video_card(info, self.id, url)

    def channel(self, url: str) -> dict[str, Any]:
        """A channel and its latest videos (and its live stream, if on now)."""
        return self._channels.get(url, lambda: self._channel(url))

    def _channel(self, url: str) -> dict[str, Any]:
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


class YouTubeSite(_YtDlpSite):
    id = "youtube"
    display_name = "YouTube"
    home_url = "https://www.youtube.com"
    films_dirname = "YouTube"
    hosts = ("youtube.com", "music.youtube.com", "youtu.be")

    def proxy_fix(self, url: str) -> ProxyFix | None:
        return ProxyFix({}, h264_only) if "/hls_variant/" in url else None

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

    def _channel(self, url: str) -> dict[str, Any]:
        base = re.sub(
            r"/(videos|streams|shorts|featured|live|playlists)$",
            "",
            url.split("?")[0].rstrip("/"),
        )
        # The Videos tab: Shorts and past streams live on tabs of their own.
        listing = ytdlp_json(
            "--flat-playlist", "--playlist-end", "30", base + "/videos"
        )
        name = listing.get("channel") or listing.get("uploader") or ""
        channel_url = listing.get("channel_url") or base
        dates = youtube_feed_dates(listing.get("channel_id") or "")
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

    def _channel(self, url: str) -> dict[str, Any]:
        login = urlsplit(url).path.strip("/").split("/")[0].lower()
        if not re.fullmatch(r"\w{1,25}", login) or login == "videos":
            raise SiteError(f"Not a Twitch channel: {url}")
        user = twitch_gql(_TWITCH_CHANNEL, {"login": login}).get("user")
        if not user:
            raise SiteError(f"No Twitch channel called {login}")
        return twitch_channel(user)

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


def youtube_feed(channel_id: str) -> list[dict[str, Any]]:
    """A channel's last 15 long-form uploads, newest first, from its RSS feed.

    The ``UULF`` playlist is the channel's uploads without Shorts and streams,
    matching its Videos tab. One free request, no key; raises SiteError.
    """
    try:
        with new_client(headers={"User-Agent": BROWSER_UA}) as client:
            resp = client.get(
                "https://www.youtube.com/feeds/videos.xml",
                params={"playlist_id": "UULF" + channel_id.removeprefix("UC")},
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


def youtube_feed_dates(channel_id: str) -> dict[str, int]:
    """Upload time of a channel's latest videos, by video id.

    yt-dlp's flat listing has no dates. Empty on any failure: the dates are a
    nicety, the listing still stands.
    """
    try:
        return (
            {e["id"]: e["timestamp"] for e in youtube_feed(channel_id)}
            if channel_id
            else {}
        )
    except SiteError:
        return {}


# Twitch's own web client id, the one yt-dlp sends too: public, no account.
_TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
_TWITCH_CHANNEL = """
query($login: String!) {
  user(login: $login) {
    login displayName profileImageURL(width: 150)
    stream { title viewersCount createdAt previewImageURL(width: 640, height: 360) }
    videos(first: 30, type: ARCHIVE, sort: TIME) {
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
