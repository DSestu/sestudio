"""The station end to end with a fake picture: start, stream, clock, stop, idle stop."""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from sestudio import downloaded, library
from sestudio.media import ffmpeg_binary
from sestudio.music import mixer, queue, station
from sestudio.music.station import Station
from sestudio.web.app import create_app
from sestudio.web.routes import music_station as route
from tests.test_music_mixer import FakePort, Files, tone

NAMES = ["a.flac", "b.flac"]


class FakeCapture:
    def __init__(self, jpeg: bytes) -> None:
        self.jpeg, self.closed = jpeg, False

    async def open(self, width, height):
        async def frames():
            while True:
                await asyncio.sleep(0.04)
                yield self.jpeg

        return frames()

    async def close(self):
        self.closed = True


@pytest.fixture()
def jpeg(tmp_path) -> bytes:
    out = tmp_path / "f.jpg"
    subprocess.run(
        [ffmpeg_binary(), "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360",
         "-frames:v", "1", str(out)],
        check=True,
    )  # fmt: skip
    return out.read_bytes()


@pytest.fixture(autouse=True)
def _stopped():
    yield
    station.stop()


def decode(ts: bytes, *args: str) -> subprocess.CompletedProcess:
    # From a file, not a pipe: a seekable input lets ffmpeg probe the whole capture.
    with tempfile.NamedTemporaryFile(suffix=".ts") as f:
        f.write(ts)
        f.flush()
        return subprocess.run(
            [
                ffmpeg_binary(),
                "-probesize",
                "50M",
                "-analyzeduration",
                "20M",
                "-i",
                f.name,
                *args,
            ],
            capture_output=True,
        )


def test_one_stream_with_picture_and_sound_and_a_clock_the_tv_can_follow(
    tmp_path, jpeg
):
    files = {
        t: (tone(tmp_path / f"{t}.flac", hz, 20), None)
        for t, hz in [("a", 440), ("b", 660)]
    }
    mix = mixer.Mixer(FakePort(["a", "b"]), Files(files), ahead=1.0)
    cap = FakeCapture(jpeg)
    first = station.start(lambda: Station(cap, mix, fps=20, height=360, idle=30))
    assert station.start(lambda: pytest.fail("one station at a time")) is first

    async def pull(seconds: float) -> bytes:
        sub = first.subscribe()
        got = bytearray()
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            got += await asyncio.wait_for(sub[1].get(), 30)
        first.unsubscribe(sub)
        return bytes(got)

    assert first.live.wait(30)
    ts = asyncio.run(pull(6))
    assert queue._station_clock and queue._station_clock["item_id"] == "q0"
    assert first.status()["clients"] == 0 and first.status()["running"]
    first.stop()
    assert cap.closed and not first.running and queue._station_clock is None

    assert ts[0] == 0x47 and len(ts) % 188 == 0
    run = decode(ts, "-f", "null", "-")
    info = run.stderr.decode()
    assert (
        "Input #0" in info
    ), f"ffmpeg exit {run.returncode}, {len(ts)} bytes: {info[-400:]}"
    assert "Video: h264" in info and "Audio: aac" in info and "640x360" in info
    # Sound and picture end together, and the tone is the first track's.
    pcm = decode(ts, "-vn", "-f", "s16le", "-ac", "1", "-ar", "44100", "-").stdout
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    assert 3 < len(x) / 44100 < 7
    assert abs(np.argmax(np.abs(np.fft.rfft(x[44100 : 44100 * 2]))) - 440) <= 2


def test_it_stops_by_itself_when_no_one_pulls_the_stream(tmp_path, jpeg):
    files = {"a": (tone(tmp_path / "a.flac", 440, 20), None)}
    mix = mixer.Mixer(FakePort(["a"]), Files(files))
    st = station.start(
        lambda: Station(FakeCapture(jpeg), mix, fps=20, height=360, idle=1.5)
    )
    assert st.done.wait(30) and st.error is None
    assert station.current() is None


@pytest.mark.exclude_ci
def test_a_real_browser_delivers_pictures(tmp_path):
    """Needs Playwright and a browser (`--extra station`); not run in CI."""
    pytest.importorskip("playwright")
    page = tmp_path / "p.html"
    page.write_text(
        "<body><script>setInterval(()=>document.title=Date.now(),20)</script>"
    )
    cap = station.BrowserCapture(page.as_uri())

    async def go() -> int:
        try:
            frames = await cap.open(640, 360)
            n = 0
            async for _ in frames:
                n += 1
                if n == 5:
                    return n
        except station.StationError as exc:
            pytest.skip(str(exc))
        finally:
            await cap.close()
        return 0

    assert asyncio.run(go()) == 5


@pytest.fixture()
def client(tmp_path, monkeypatch, jpeg):
    out = tmp_path / "out"
    out.mkdir()
    for n, hz in zip(NAMES, (440, 660), strict=True):
        tone(out / n, hz, 20)
    monkeypatch.setenv("SESTUDIO_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.setenv("SESTUDIO_DB", str(tmp_path / "library.db"))
    monkeypatch.setattr(downloaded, "audio_info", lambda f: ("", "", "", None))
    monkeypatch.setattr(
        route, "make_station",
        lambda request, fps: Station(FakeCapture(jpeg), fps=fps or 20, height=360, idle=30),
    )  # fmt: skip
    library.reset_connection()
    downloaded.invalidate()
    c = TestClient(create_app())
    c.put("/api/settings", json={"output_root": str(out), "station_fps": 25})
    yield c
    library.reset_connection()


def test_routes_start_status_stream_and_stop_over_the_real_queue(client):
    assert client.get("/api/music/station/status").json()["running"] is False
    assert client.get("/api/music/station/stream").status_code == 409
    ids = [downloaded.track_id(n) for n in NAMES]
    r = client.post(
        "/api/music/queue",
        json={"tracks": [{"track_id": i} for i in ids], "replace": True},
    )
    assert r.status_code == 200
    r = client.post("/api/music/station/start", json={"fps": 15})
    assert r.status_code == 200 and r.json()["running"] and r.json()["fps"] == 15
    assert r.json()["path"] == "/api/music/station/stream"
    assert client.post("/api/music/station/start").json()["fps"] == 15  # the same one
    st = station.current()
    assert st and st.live.wait(30)
    # The queue's own state carries the station clock for the TV page.
    clock = None
    for _ in range(40):
        clock = client.get("/api/music/queue").json().get("station")
        if clock:
            break
        time.sleep(0.25)
    assert clock and clock["item_id"] and clock["playing"] is True
    # The same encode is also a live HLS playlist for a Chromecast, in a temp dir that goes with the run.
    hls_dir = st.hls_dir
    for _ in range(80):
        playlist = client.get("/api/music/station/hls/live.m3u8")
        if playlist.status_code == 200 and "seg0.ts" in playlist.text:
            break
        time.sleep(0.25)
    assert playlist.status_code == 200
    assert playlist.headers["content-type"] == "application/vnd.apple.mpegurl"
    segment = client.get("/api/music/station/hls/seg0.ts")
    assert segment.status_code == 200 and segment.content[0] == 0x47
    assert client.get("/api/music/station/hls/nope.ts").status_code == 404
    # The test client only returns a response once it has ended: the stop ends the stream.
    threading.Timer(3, lambda: client.post("/api/music/station/stop")).start()
    resp = client.get("/api/music/station/stream")
    assert resp.status_code == 200 and resp.headers["content-type"] == "video/mpeg"
    assert resp.content[0] == 0x47 and len(resp.content) > 20_000
    assert client.get("/api/music/queue").json()["station"] is None
    assert st.done.wait(15) and not hls_dir.exists()
    assert client.get("/api/music/station/hls/live.m3u8").status_code == 404


def test_the_volume_the_player_sets_reaches_every_page_and_ends_with_the_station():
    async def go() -> dict:
        sub = queue.subscribe()
        queue.publish_volume(1.4, False)  # clamped
        queue.publish_volume(0.35, True)
        events = [await asyncio.wait_for(sub[1].get(), 2) for _ in range(2)]
        queue.unsubscribe(sub)
        return events[-1]

    ev = asyncio.run(go())
    assert ev["op"] == "volume" and ev["rev"] == 0
    assert ev["level"] == 0.35 and ev["muted"] is True
    assert queue.get_state()["volume"] == {"level": 0.35, "muted": True}
    queue.publish_station(None)
    assert queue.get_state()["volume"] is None


def test_the_volume_route_validates_and_publishes(client):
    assert (
        client.post("/api/music/station/volume", json={"level": 2}).status_code == 422
    )
    r = client.post("/api/music/station/volume", json={"level": 0.5, "muted": False})
    assert r.status_code == 200
    assert client.get("/api/music/queue").json()["volume"]["level"] == 0.5
