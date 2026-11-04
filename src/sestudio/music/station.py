"""The station (SPEC-music §7): one live stream of the queue, sound and picture.

The sound is :class:`sestudio.music.mixer.Mixer`; the picture is a headless
Chromium on the real ``/?tv`` page whose screencast frames are held to a constant
rate; both go into one ffmpeg that writes H.264 + AAC as MPEG-TS, the stream the
TV routes already serve. Sound and picture are written on the same wall clock from
the first frame, so they stay together however long it runs; while the page is
slower than the output rate a frame is repeated, never a gap.

A station runs in its own thread and event loop. It stops by itself when no client
has pulled the stream for ``idle`` seconds. It publishes its own playback clock on
the queue's change feed, which is what the TV page follows.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import socket
import tempfile
import threading
import time
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, Protocol

from sestudio.media import ffmpeg_binary
from sestudio.music import queue
from sestudio.music.mixer import BLOCK, SR, Mixer
from sestudio.music.station_spike import TV_SIZE, pump, screencast_frames

log = logging.getLogger(__name__)

IDLE_SECONDS = 20.0
CLOCK_SECONDS = 0.5
TS_PACKET = 188
START_TIMEOUT = 45.0
HLS_PLAYLIST = "live.m3u8"
HLS_SEGMENT = "seg%d.ts"


class StationError(RuntimeError):
    pass


class Capture(Protocol):
    """Where the picture comes from: a browser, or a fake one in tests."""

    async def open(self, width: int, height: int) -> AsyncIterator[bytes]: ...
    async def close(self) -> None: ...


class BrowserCapture:
    """Headless Chromium on *url*: the system Chrome or Edge when there is one,
    else Playwright's own Chromium."""

    def __init__(self, url: str, browser: str = "", dsf: float = 1.0) -> None:
        self.url, self.browser, self.dsf = url, browser, dsf
        self._pw: Any = None
        self._browser: Any = None

    async def _launch(self) -> Any:
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise StationError(
                "The station needs Playwright: install sestudio with the `station` extra"
            ) from exc
        self._pw = await async_playwright().start()
        # An explicit path or channel first, then what is installed, then the bundled build.
        found = [
            shutil.which(n) for n in ("google-chrome", "chromium", "microsoft-edge")
        ]
        asked = (
            [self.browser]
            if self.browser
            else [*filter(None, found), "chrome", "msedge", None]
        )
        last: Exception | None = None
        for choice in asked:
            # The page plays the queue unheard, for its light: no press starts it.
            args = ["--mute-audio", "--autoplay-policy=no-user-gesture-required"]
            kw: dict[str, Any] = {"headless": True, "args": args}
            if choice and ("/" in choice or "\\" in choice):
                kw["executable_path"] = choice
            elif choice:
                kw["channel"] = choice
            try:
                return await self._pw.chromium.launch(**kw)
            except Exception as exc:  # not installed: try the next
                last = exc
        raise StationError(f"No browser to draw the picture with: {last}")

    async def open(self, width: int, height: int) -> AsyncIterator[bytes]:
        self._browser = await self._launch()
        page = await self._browser.new_page(
            viewport={"width": TV_SIZE[0], "height": TV_SIZE[1]},
            device_scale_factor=self.dsf,
            ignore_https_errors=True,
        )
        await page.goto(self.url, wait_until="load")
        return screencast_frames(page, width, height, 90)

    async def close(self) -> None:
        for closer in (
            self._browser and self._browser.close,
            self._pw and self._pw.stop,
        ):
            if closer:
                try:
                    await closer()
                except Exception:
                    log.debug("closing the browser failed", exc_info=True)


def mux_command(audio_port: int, height: int, fps: int) -> list[str]:
    """ffmpeg: PCM from a local socket it listens on, JPEG frames from stdin; one encode
    written twice: MPEG-TS to stdout (DLNA) and a live HLS playlist in the working
    directory (Chromecast's receiver plays HLS, not a bare TS stream)."""
    return [
        ffmpeg_binary(), "-hide_banner", "-loglevel", "error",
        "-f", "s16le", "-ar", str(SR), "-ac", "2",
        "-i", f"tcp://127.0.0.1:{audio_port}?listen=1",
        "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
        "-map", "1:v", "-map", "0:a",
        "-vf", f"scale=-2:{height}:flags=fast_bilinear,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-g", str(fps * 2), "-sc_threshold", "0", "-r", str(fps),
        "-c:a", "aac", "-b:a", "160k",
        "-f", "tee",
        "[f=mpegts:max_delay=0:flush_packets=1:pat_period=0.2]pipe\\:1|[f=hls:hls_time=2:hls_list_size=6:"
        f"hls_flags=delete_segments+independent_segments:hls_segment_filename={HLS_SEGMENT}]"
        f"{HLS_PLAYLIST}",
    ]  # fmt: skip


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


Sub = tuple[asyncio.AbstractEventLoop, "asyncio.Queue[bytes]"]


class Station:
    def __init__(
        self,
        capture: Capture,
        mixer: Mixer | None = None,
        fps: int = 20,
        height: int = 1080,
        idle: float = IDLE_SECONDS,
    ) -> None:
        self.capture, self.fps, self.height, self.idle = capture, fps, height, idle
        self.mixer = mixer or Mixer()
        self.error: str | None = None
        #: Where ffmpeg writes the HLS playlist and segments; removed when the run ends.
        self.hls_dir = Path(tempfile.mkdtemp(prefix="sestudio-station-"))
        self.started_at = 0.0
        self.live = threading.Event()  # first picture written: the stream is flowing
        self.fresh = 0  # distinct pictures the page has delivered
        self.live_at = 0.0
        self.done = threading.Event()
        self._subs: set[Sub] = set()
        self._lock = threading.Lock()
        self._last_client = time.monotonic()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop: asyncio.Event | None = None
        self._thread: threading.Thread | None = None

    # --- control -----------------------------------------------------------------

    def start(self) -> None:
        self.started_at = time.time()
        self._last_client = time.monotonic()
        self._thread = threading.Thread(target=self._run, name="station", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._loop and self._stop:
            self._loop.call_soon_threadsafe(self._stop.set)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(15)

    @property
    def running(self) -> bool:
        return not self.done.is_set()

    def status(self) -> dict[str, Any]:
        with self._lock:
            clients = len(self._subs)
        return {
            "running": self.running,
            "live": self.live.is_set(),
            "clients": clients,
            "fps": self.fps,
            "height": self.height,
            "since": self.started_at,
            "error": self.error,
            "clock": self.mixer.heard(),
            "underruns": self.mixer.underruns,
            # What the page really delivers: below `fps`, pictures are repeated.
            "capture_fps": round(self.fresh / (time.monotonic() - self.live_at), 1)
            if self.live_at
            else 0,
        }

    # --- clients -----------------------------------------------------------------

    def subscribe(self) -> Sub:
        sub: Sub = (asyncio.get_running_loop(), asyncio.Queue(maxsize=256))
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Sub) -> None:
        with self._lock:
            self._subs.discard(sub)
            self._last_client = time.monotonic()

    def touch(self) -> None:
        """A client fetched part of the HLS playlist: it is not subscribed, but it is pulling."""
        with self._lock:
            self._last_client = time.monotonic()

    def _fan_out(self, data: bytes) -> None:
        with self._lock:
            subs = list(self._subs)
        for loop, q in subs:

            def offer(q: asyncio.Queue[bytes] = q) -> None:
                if q.full():
                    q.get_nowait()  # a slow client sees the newest, not a backlog
                q.put_nowait(data)

            try:
                loop.call_soon_threadsafe(offer)
            except RuntimeError:  # that client's loop is gone
                self.unsubscribe((loop, q))

    def _close_clients(self) -> None:
        with self._lock:
            subs = list(self._subs)
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(q.put_nowait, b"")  # b"" ends the stream
            except (RuntimeError, asyncio.QueueFull):
                pass

    # --- the run -----------------------------------------------------------------

    def _run(self) -> None:
        try:
            asyncio.run(self._main())
        except Exception as exc:
            log.exception("the station failed")
            self.error = str(exc)
        finally:
            self.mixer.stop()
            queue.publish_station(None)
            shutil.rmtree(self.hls_dir, ignore_errors=True)
            self._close_clients()
            self.done.set()

    async def _main(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._stop = asyncio.Event()
        self.mixer.start()
        port = _free_port()
        ff = await asyncio.create_subprocess_exec(
            *mux_command(port, self.height, self.fps),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            cwd=self.hls_dir,
        )
        tasks: list[asyncio.Task] = []
        try:
            tasks = [
                asyncio.create_task(self._read_out(ff)),
                asyncio.create_task(self._pictures(ff)),
                asyncio.create_task(self._sound(port)),
                asyncio.create_task(self._watch()),
            ]
            waiter = asyncio.create_task(self._stop.wait())
            done, _ = await asyncio.wait(
                [*tasks, waiter], return_when=asyncio.FIRST_COMPLETED
            )
            for t in done:
                if t is not waiter and (exc := t.exception()):
                    raise exc
            waiter.cancel()
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self.capture.close()
            if ff.stdin:
                ff.stdin.close()
            if ff.returncode is None:
                ff.kill()
            # A launcher shim (Chocolatey's ffmpeg.exe) dies to kill() but its ffmpeg
            # does not, and holds stdout open; it ends on the EOF of both inputs.
            try:
                await asyncio.wait_for(ff.wait(), 10)
            except TimeoutError:
                log.warning("the encoder did not end")

    async def _read_out(self, ff: asyncio.subprocess.Process) -> None:
        """ffmpeg's MPEG-TS, handed on in whole 188-byte packets so a client may join anywhere."""
        assert ff.stdout is not None
        rest = b""
        while chunk := await ff.stdout.read(TS_PACKET * 64):
            rest += chunk
            whole = len(rest) // TS_PACKET * TS_PACKET
            if whole:
                self._fan_out(rest[:whole])
                rest = rest[whole:]
        raise StationError("the encoder ended")

    async def _pictures(self, ff: asyncio.subprocess.Process) -> None:
        assert ff.stdin is not None
        source = await self.capture.open(round(self.height * 16 / 9), self.height)
        stdin = ff.stdin

        async def frames() -> AsyncIterator[bytes]:
            async for f in source:
                self.fresh += 1
                yield f

        async def write(frame: bytes) -> None:
            stdin.write(frame)
            if not self.live.is_set():
                self.live_at = time.monotonic()
                self.live.set()
            await stdin.drain()

        await pump(frames(), write, self.fps, 10**9)

    async def _sound(self, port: int) -> None:
        """PCM at the sound's own rate on the wall clock, from when the first picture is."""
        writer = None
        deadline = time.monotonic() + START_TIMEOUT
        while writer is None:
            try:
                _, writer = await asyncio.open_connection("127.0.0.1", port)
            except OSError:
                if time.monotonic() > deadline:
                    raise StationError(
                        "the encoder did not open its audio input"
                    ) from None
                await asyncio.sleep(0.1)
        try:
            while not self.live.is_set():
                if time.monotonic() > deadline:
                    raise StationError("the browser drew no picture")
                await asyncio.sleep(0.02)
            start, n = time.monotonic(), 0
            while True:
                due = start + n * BLOCK / SR
                if (wait := due - time.monotonic()) > 0:
                    await asyncio.sleep(wait)
                writer.write(self.mixer.pull(BLOCK))
                await writer.drain()
                n += 1
        finally:
            writer.close()  # the encoder's audio input ends: it can finish

    async def _watch(self) -> None:
        """The clock the TV follows, and the stop when nobody is pulling the stream."""
        while True:
            await asyncio.sleep(CLOCK_SECONDS)
            if self.live.is_set() and (h := self.mixer.heard()):
                queue.publish_station({**h, "at": time.time()})
            with self._lock:
                idle = (
                    not self._subs and time.monotonic() - self._last_client > self.idle
                )
            if idle:
                log.info("no one is pulling the station: stopping")
                return


# --- the one station --------------------------------------------------------------

_current: Station | None = None
_guard = threading.Lock()


def current() -> Station | None:
    return _current if _current and _current.running else None


def last_error() -> str | None:
    """Why the last station ended, when it failed: it is gone, its status with it."""
    return _current.error if _current and not _current.running else None


def start(make: Callable[[], Station]) -> Station:
    """The running station, or a new one from *make* (one station at a time)."""
    global _current
    with _guard:
        if (cur := current()) is not None:
            return cur
        _current = make()
        _current.start()
        return _current


def stop() -> bool:
    with _guard:
        cur = current()
    if cur is None:
        return False
    cur.stop()
    return True
