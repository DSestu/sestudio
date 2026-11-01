"""YouTube and Twitch, read through yt-dlp: no account and no API key.

A video is a one-episode title (season 0), and yt-dlp resolves it on demand.
Their own search and channel pages come later (docs/SPEC-youtube-twitch.md).
"""

from __future__ import annotations

import json
import re
import subprocess
from typing import Any
from urllib.parse import urlsplit

from sestudio.catalogs import TtlCache
from sestudio.downloader import check_yt_dlp, js_runtime_args
from sestudio.http_client import BROWSER_UA
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


class _YtDlpSite(ContentSite):
    hosts: tuple[str, ...] = ()
    # Kept out of the title search: their own Videos kind comes later.
    searchable = False

    def __init__(self) -> None:
        # googlevideo URLs stop working after about 6 hours.
        self._info = TtlCache(4 * 3600)

    def owns_url(self, url: str) -> bool:
        host = (urlsplit(url).hostname or "").removeprefix("www.").removeprefix("m.")
        return host in self.hosts

    def search(self, query: str) -> list[SeasonCard]:
        return []

    def provider_order(self) -> tuple[str, ...]:
        return (self.id,)

    def info(self, url: str) -> dict[str, Any]:
        return self._info.get(url, lambda: ytdlp_json("--no-playlist", url))

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


class TwitchSite(_YtDlpSite):
    id = "twitch"
    display_name = "Twitch"
    home_url = "https://www.twitch.tv"
    films_dirname = "Twitch"
    hosts = ("twitch.tv", "clips.twitch.tv")
