"""YouTube and Twitch through yt-dlp: which URL plays, and which site owns a link."""

from __future__ import annotations

import pytest

from sestudio.sites import creators
from sestudio.sites.base import SiteError, StreamCandidate
from sestudio.sites.creators import TwitchSite, YouTubeSite, stream_url


def test_hls_master_wins_so_the_player_can_switch_quality():
    """Twitch lists one format per rendition, all from the same master."""
    info = {
        "formats": [
            {
                "url": "https://cdn/480.m3u8",
                "protocol": "m3u8_native",
                "manifest_url": "https://usher/master.m3u8",
            },
            {
                "url": "https://cdn/1080.m3u8",
                "protocol": "m3u8_native",
                "manifest_url": "https://usher/master.m3u8",
            },
        ]
    }
    assert stream_url(info) == "https://usher/master.m3u8"


def test_youtube_plays_the_file_with_both_picture_and_sound():
    """Above 360p YouTube splits video and audio; a lone video-only file is mute."""
    info = {
        "formats": [
            {
                "url": "https://gv/18",
                "protocol": "https",
                "height": 360,
                "vcodec": "avc1",
                "acodec": "mp4a",
            },
            {
                "url": "https://gv/299",
                "protocol": "https",
                "height": 1080,
                "vcodec": "avc1",
                "acodec": "none",
            },
            {
                "url": "https://gv/140",
                "protocol": "https",
                "vcodec": "none",
                "acodec": "mp4a",
            },
        ]
    }
    assert stream_url(info) == "https://gv/18"


def test_no_playable_format_is_a_site_error():
    with pytest.raises(SiteError):
        stream_url({"formats": [{"url": "x", "protocol": "https", "acodec": "none"}]})


@pytest.mark.parametrize(
    ("url", "site"),
    [
        ("https://www.youtube.com/watch?v=abc", "youtube"),
        ("https://youtu.be/abc", "youtube"),
        ("https://m.youtube.com/watch?v=abc", "youtube"),
        ("https://www.twitch.tv/videos/123", "twitch"),
        ("https://clips.twitch.tv/Abc", "twitch"),
    ],
)
def test_links_route_to_their_site(url, site):
    owners = [s.id for s in (YouTubeSite(), TwitchSite()) if s.owns_url(url)]
    assert owners == [site]


def test_lookalike_hosts_are_not_owned():
    assert not YouTubeSite().owns_url("https://notyoutube.com/watch?v=abc")


def test_a_video_is_one_original_language_episode(monkeypatch):
    monkeypatch.setattr(creators, "ytdlp_json", lambda *a, **k: {"title": "Clip"})
    page = YouTubeSite().fetch_page("https://youtu.be/abc")

    assert page.is_film and page.available_langs == ["vo"]
    assert page.episodes[0].title == "Clip"
    assert page.episodes[0].embed_urls == {"youtube": "https://youtu.be/abc"}


def test_downloads_extract_the_page_and_live_is_never_cached(monkeypatch):
    calls: list[str] = []

    def fake(*args, **_kw):
        calls.append(args[-1])
        return {
            "is_live": True,
            "webpage_url": "https://www.twitch.tv/someone",
            "formats": [{"url": "u", "protocol": "m3u8", "manifest_url": "m"}],
        }

    monkeypatch.setattr(creators, "ytdlp_json", fake)
    site = TwitchSite()
    cand = StreamCandidate("twitch", "https://www.twitch.tv/someone")
    src = site.resolve_candidate(cand, {})
    site.resolve_candidate(cand, {})

    assert src.url == "m"
    assert src.extract_url == "https://www.twitch.tv/someone"
    # One cached lookup, then a fresh one for each resolve of a live stream.
    assert len(calls) == 3


def test_youtube_master_keeps_only_h264_variants():
    """Chromecast and TVs pick a variant by bandwidth and can't decode VP9/AV1."""
    master = (
        b"#EXTM3U\n"
        b'#EXT-X-MEDIA:URI="a.m3u8",TYPE=AUDIO,GROUP-ID="234"\n'
        b'#EXT-X-STREAM-INF:BANDWIDTH=7417746,CODECS="avc1.64002A,mp4a.40.2"\n'
        b"https://gv/h264.m3u8\n"
        b'#EXT-X-STREAM-INF:BANDWIDTH=27987109,CODECS="vp09.00.51.08,mp4a.40.2"\n'
        b"https://gv/vp9.m3u8\n"
    )
    out = creators.h264_only(master).decode()

    assert "h264.m3u8" in out and 'URI="a.m3u8"' in out
    assert "vp09" not in out and "vp9.m3u8" not in out
    assert YouTubeSite().proxy_fix("https://manifest.googlevideo.com/x/hls_variant/y")
    assert (
        YouTubeSite().proxy_fix("https://manifest.googlevideo.com/hls_playlist/")
        is None
    )


def test_youtube_channel_lists_its_videos_dated_by_the_feed(monkeypatch):
    """yt-dlp's flat listing has no dates; the channel's RSS feed fills them in."""
    calls: list[tuple] = []

    def fake(*args, **_kw):
        calls.append(args)
        return {
            "channel": "Blender",
            "channel_id": "UC1",
            "channel_url": "https://www.youtube.com/channel/UC1",
            "thumbnails": [{"id": "avatar_uncropped", "url": "https://yt/avatar"}],
            "entries": [
                {"id": "a", "url": "https://www.youtube.com/watch?v=a", "title": "A"},
                {"id": "b", "url": "https://www.youtube.com/watch?v=b", "title": "B"},
            ],
        }

    monkeypatch.setattr(creators, "ytdlp_json", fake)
    feeds: list[str] = []
    monkeypatch.setattr(
        creators,
        "youtube_feed_dates",
        lambda cid, playlist: feeds.append(playlist) or {"a": 1700000000},
    )
    channel = YouTubeSite().channel("https://www.youtube.com/@BlenderOfficial/videos")

    assert calls[0][-1] == "https://www.youtube.com/@BlenderOfficial/videos"
    assert (channel["name"], channel["url"], channel["avatar"]) == (
        "Blender",
        "https://www.youtube.com/channel/UC1",
        "https://yt/avatar",
    )
    assert [(v["title"], v["timestamp"]) for v in channel["videos"]] == [
        ("A", 1700000000),
        ("B", 0),
    ]
    assert channel["videos"][0]["channel"] == "Blender"
    assert channel["tab"] == "videos" and feeds == ["UULF"]

    streams = YouTubeSite().channel(
        "https://www.youtube.com/@BlenderOfficial", "streams"
    )
    assert calls[-1][-1] == "https://www.youtube.com/@BlenderOfficial/streams"
    assert streams["tab"] == "streams" and feeds[-1] == "UULV"
    assert [t["id"] for t in streams["tabs"]] == ["videos", "streams"]


def test_twitch_channel_from_graphql_has_its_live_stream_and_vods():
    channel = creators.twitch_channel(
        {
            "login": "someone",
            "displayName": "SomeOne",
            "profileImageURL": "https://tw/avatar",
            "stream": {
                "title": "Run",
                "viewersCount": 8200,
                "createdAt": "2026-11-01T18:00:00Z",
            },
            "videos": {
                "edges": [
                    {
                        "node": {
                            "id": "42",
                            "title": "VOD",
                            "lengthSeconds": 60,
                            "publishedAt": "2026-10-30T10:00:00Z",
                        }
                    }
                ]
            },
        }
    )

    assert channel["url"] == "https://www.twitch.tv/someone"
    assert channel["live"]["is_live"] and channel["live"]["view_count"] == 8200
    assert channel["live"]["page_url"] == "https://www.twitch.tv/someone"
    vod = channel["videos"][0]
    assert vod["page_url"] == "https://www.twitch.tv/videos/42"
    assert vod["timestamp"] == 1793354400 and vod["duration"] == 60


def test_twitch_channel_refuses_non_channel_links():
    with pytest.raises(SiteError):
        TwitchSite().channel("https://www.twitch.tv/videos/123")


def test_youtube_search_lists_videos(monkeypatch):
    seen: list[tuple] = []

    def fake(*args, **_kw):
        seen.append(args)
        return {
            "entries": [
                {
                    "url": "https://www.youtube.com/watch?v=a",
                    "title": "A",
                    "channel": "C",
                }
            ]
        }

    monkeypatch.setattr(creators, "ytdlp_json", fake)
    site = YouTubeSite()
    videos = site.search_videos("dune trailer")
    site.search_videos("dune trailer")

    assert seen == [("--flat-playlist", "ytsearch20:dune trailer")]
    assert [(v["title"], v["channel"], v["source"]) for v in videos] == [
        ("A", "C", "youtube")
    ]


def test_twitch_channel_search_from_graphql(monkeypatch):
    monkeypatch.setattr(
        creators,
        "twitch_gql",
        lambda q, v: {
            "searchUsers": {
                "edges": [
                    {
                        "node": {
                            "login": "zerator",
                            "displayName": "ZeratoR",
                            "followers": {"totalCount": 1658477},
                            "stream": None,
                        }
                    },
                    {
                        "node": {
                            "login": "zerator_247",
                            "displayName": "ZeratoR_247",
                            "followers": {"totalCount": 53776},
                            "stream": {"game": {"name": "Just Chatting"}},
                        }
                    },
                ]
            }
        },
    )
    found = TwitchSite().search_channels("zerator")

    assert [(c["url"], c["followers"], c["live"], c["game"]) for c in found] == [
        ("https://www.twitch.tv/zerator", 1658477, False, ""),
        ("https://www.twitch.tv/zerator_247", 53776, True, "Just Chatting"),
    ]


def test_youtube_rate_limit_stops_further_lookups_for_a_while(monkeypatch):
    """Asking YouTube again during its ban only extends it."""
    calls: list[str] = []

    def limited(opts, url):
        calls.append(url)
        raise SiteError(
            "[youtube] x: The current session has been rate-limited by YouTube"
        )

    monkeypatch.setattr(creators, "_extract", limited)
    monkeypatch.setattr(creators, "_youtube_blocked_until", 0.0)
    with pytest.raises(SiteError):
        creators.ytdlp_json("--no-playlist", "https://www.youtube.com/watch?v=a")
    with pytest.raises(SiteError, match="try again in"):
        creators.ytdlp_json("--no-playlist", "https://www.youtube.com/watch?v=b")
    # Twitch is a different site and stays reachable.
    with pytest.raises(SiteError):
        creators.ytdlp_json("--no-playlist", "https://www.twitch.tv/videos/1")

    assert calls == [
        "https://www.youtube.com/watch?v=a",
        "https://www.twitch.tv/videos/1",
    ]
