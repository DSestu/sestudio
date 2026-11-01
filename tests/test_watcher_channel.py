"""Following a YouTube or Twitch channel: what a poll reports."""

from __future__ import annotations

import pytest

from sestudio.sites.creators import TwitchSite
from sestudio.watchers.kinds import collect_channel_hits
from sestudio.watchers.models import Watcher, validate_config


def _watcher(**config) -> Watcher:
    return Watcher(
        id=1,
        kind="channel",
        label="SomeOne",
        config=validate_config("channel", config),
        enabled=True,
        auto_download=False,
        interval_seconds=300,
        created_at=0,
        next_poll_at=0,
    )


def _video(n: int, ts: int) -> dict:
    return {
        "source": "twitch",
        "page_url": f"https://www.twitch.tv/videos/{n}",
        "title": f"VOD {n}",
        "thumbnail": f"t{n}",
        "timestamp": ts,
    }


def test_each_video_and_each_stream_is_its_own_item(monkeypatch):
    live = {
        **_video(0, 10_000),
        "page_url": "https://www.twitch.tv/someone",
        "title": "Run",
    }
    monkeypatch.setattr(
        TwitchSite,
        "_channel",
        lambda self, url: {
            "live": live,
            # 3 is the broadcast of the stream on now: news only once it ends.
            "videos": [_video(3, 9_990), _video(2, 5_000), _video(1, 1_000)],
        },
    )
    w = _watcher(
        channel_url="https://www.twitch.tv/someone", source="twitch", name="SomeOne"
    )

    hits = collect_channel_hits(w, {"twitch": TwitchSite()})

    assert [h.item_key for h in hits] == [
        "video:https://www.twitch.tv/videos/2",
        "video:https://www.twitch.tv/videos/1",
        "live:10000",
    ]
    video, live_hit = hits[0], hits[-1]
    assert video.subtitle == "SomeOne · New broadcast"
    # Opens and keys in watch state like a pasted video: its own one-item title.
    assert video.data["series_name"] == "VOD 2" and video.data["season"] == 0
    assert live_hit.subtitle == "SomeOne is live"
    assert live_hit.data["page_url"] == "https://www.twitch.tv/someone"


@pytest.mark.parametrize(
    "config",
    [
        {"channel_url": "", "source": "twitch"},
        {"channel_url": "u", "source": "fstream"},
    ],
)
def test_a_channel_needs_an_address_and_a_video_site(config):
    with pytest.raises(ValueError):
        validate_config("channel", config)
