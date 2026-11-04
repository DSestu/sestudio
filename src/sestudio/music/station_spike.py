"""Station spike (SPEC-music §7): render the player's `?tv` page in headless Chromium and
encode it with ffmpeg, to measure whether a machine can hold 720p30 / 1080p30.

Not the station: no audio, no stream routes. Frames come from a source (a browser, or a fake one
in tests), are resampled onto a constant-rate clock and piped into ffmpeg as JPEGs.
Playwright is imported lazily: 32-bit ARM installs go without it.
"""

from __future__ import annotations

import asyncio
import base64
import os
import statistics
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

from sestudio.media import ffmpeg_binary

TV_SIZE = (1920, 1080)


def encode_command(
    ffmpeg: str,
    out: Path,
    height: int,
    fps: int,
    hls: bool = False,
    preset: str = "veryfast",
) -> list[str]:
    """ffmpeg reading JPEG frames from stdin at *fps*, scaled to *height*, H.264 into *out*."""
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-framerate", str(fps), "-c:v", "mjpeg", "-i", "-",
        "-vf", f"scale=-2:{height}:flags=fast_bilinear,format=yuv420p",
        "-c:v", "libx264", "-preset", preset, "-tune", "zerolatency",
        "-g", str(fps * 2), "-r", str(fps),
    ]  # fmt: skip
    if hls:
        cmd += [
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "6",
            "-hls_flags",
            "delete_segments",
        ]
    return [*cmd, str(out)]


def _pct(xs: list[float], p: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(len(s) * p))] if s else 0.0


@dataclass
class PumpStats:
    seconds: float = 0.0
    written: int = 0  # frames sent to the encoder (constant rate)
    fresh: int = 0  # distinct frames the source delivered
    arrivals: list[float] = field(default_factory=list)  # source frame timestamps
    late: list[float] = field(default_factory=list)  # how late each tick wrote, seconds

    def summary(self) -> dict[str, float]:
        gaps = [b - a for a, b in zip(self.arrivals, self.arrivals[1:], strict=False)]
        return {
            "seconds": round(self.seconds, 2),
            "capture_fps": round(self.fresh / self.seconds, 2) if self.seconds else 0,
            "output_fps": round(self.written / self.seconds, 2) if self.seconds else 0,
            "duplicated_pct": round(100 * (1 - self.fresh / self.written), 1)
            if self.written
            else 0,
            "gap_p50_ms": round(1000 * _pct(gaps, 0.5), 1),
            "gap_p95_ms": round(1000 * _pct(gaps, 0.95), 1),
            "gap_max_ms": round(1000 * max(gaps, default=0), 1),
            "gap_jitter_ms": round(1000 * statistics.pstdev(gaps), 1)
            if len(gaps) > 1
            else 0,
            "tick_late_p95_ms": round(1000 * _pct(self.late, 0.95), 1),
        }


async def pump(
    frames: AsyncIterator[bytes],
    write: Callable[[bytes], Awaitable[None]],
    fps: int,
    seconds: float,
    clock: Callable[[], float] = time.monotonic,
) -> PumpStats:
    """Write the latest frame to *write* at exactly *fps* for *seconds*, repeating one when the
    source is slower: the encoder reads the pipe as constant frame rate, so a short pipe would
    play fast."""
    st = PumpStats()
    latest: bytes | None = None
    fresh = False

    async def read() -> None:
        nonlocal latest, fresh
        async for f in frames:
            latest, fresh = f, True
            st.fresh += 1
            st.arrivals.append(clock())

    reader = asyncio.create_task(read())
    start = clock()
    n = round(seconds * fps)
    try:
        for i in range(n):
            due = start + i / fps
            if (wait := due - clock()) > 0:
                await asyncio.sleep(wait)
            st.late.append(max(0.0, clock() - due))
            if latest is None:
                continue  # nothing to show yet; the encoder just starts later
            fresh = False
            await write(latest)
            st.written += 1
    finally:
        reader.cancel()
        st.seconds = clock() - start
    return st


def _playwright():
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise SystemExit(
            "The station spike needs Playwright, which has no build for this machine "
            "(then `playwright install chromium` unless a system Chrome/Edge is used with --channel)."
        ) from exc
    return async_playwright


async def screencast_frames(
    page, width: int, height: int, quality: int
) -> AsyncIterator[bytes]:
    """JPEG frames from CDP `Page.startScreencast`, each acknowledged as it is taken."""
    cdp = await page.context.new_cdp_session(page)
    q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=4)

    def on_frame(ev: dict) -> None:
        asyncio.ensure_future(
            cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        )
        if q.full():
            q.get_nowait()  # a slow consumer sees the newest frame, not a backlog
        q.put_nowait(base64.b64decode(ev["data"]))

    cdp.on("Page.screencastFrame", on_frame)
    await cdp.send(
        "Page.startScreencast",
        {
            "format": "jpeg",
            "quality": quality,
            "maxWidth": width,
            "maxHeight": height,
            "everyNthFrame": 1,
        },
    )
    try:
        while True:
            yield await q.get()
    finally:
        await cdp.send("Page.stopScreencast")


async def screenshot_frames(page, quality: int) -> AsyncIterator[bytes]:
    """JPEG frames from back-to-back `page.screenshot` calls: as fast as the page allows."""
    while True:
        yield await page.screenshot(type="jpeg", quality=quality)


class Sampler:
    """CPU (% of one core, summed) and RSS of the browser tree and of ffmpeg, every second."""

    def __init__(self, ffmpeg_pid: int) -> None:
        import psutil

        self._ps = psutil
        self.ffmpeg = psutil.Process(ffmpeg_pid)
        self.known: dict[int, psutil.Process] = {}
        self.rows: list[dict[str, float]] = []
        self.ffmpeg.cpu_percent(None)

    def _browser(self) -> list:
        me = self._ps.Process(os.getpid())
        procs = []
        for p in me.children(recursive=True):
            try:
                if p.pid == self.ffmpeg.pid or "ffmpeg" in p.name().lower():
                    continue
                if p.name().lower().startswith("node"):
                    continue  # Playwright's own driver is not the renderer
                procs.append(self.known.setdefault(p.pid, p))
            except self._ps.Error:
                pass
        return procs

    def sample(self) -> None:
        row = {
            "browser_cpu": 0.0,
            "browser_rss_mb": 0.0,
            "ffmpeg_cpu": 0.0,
            "ffmpeg_rss_mb": 0.0,
        }
        for p in self._browser():
            try:
                row["browser_cpu"] += p.cpu_percent(None)
                row["browser_rss_mb"] += p.memory_info().rss / 1e6
            except self._ps.Error:
                pass
        try:
            row["ffmpeg_cpu"] = self.ffmpeg.cpu_percent(None)
            row["ffmpeg_rss_mb"] = self.ffmpeg.memory_info().rss / 1e6
        except self._ps.Error:
            pass
        self.rows.append(row)

    def summary(self) -> dict[str, float]:
        rows = self.rows[1:] or self.rows  # the first interval has no baseline
        out = {"cores": os.cpu_count() or 0}
        for k in rows[0] if rows else ():
            xs = [r[k] for r in rows]
            out[f"{k}_mean"] = round(statistics.fmean(xs), 1)
            out[f"{k}_max"] = round(max(xs), 1)
        return out


async def run(
    url: str,
    out: Path,
    seconds: float = 120,
    height: int = 720,
    fps: int = 30,
    method: str = "screencast",
    channel: str | None = None,
    executable_path: str | None = None,
    quality: int = 80,
    dsf: float = 1.0,
    css: str = "",
    hls: bool = False,
    preset: str = "veryfast",
    extra_args: list[str] | None = None,
) -> dict:
    """Render *url* at 1920x1080 for *seconds* and encode it at *height*p*fps* into *out*."""
    pw_cm = _playwright()
    width = round(height * 16 / 9)
    out.parent.mkdir(parents=True, exist_ok=True)
    async with pw_cm() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            channel=channel,
            executable_path=executable_path,
            args=extra_args or [],
        )
        page = await browser.new_page(
            viewport={"width": TV_SIZE[0], "height": TV_SIZE[1]},
            device_scale_factor=dsf,
        )
        await page.goto(url, wait_until="networkidle")
        if css:
            await page.add_style_tag(content=css)
        ff = await asyncio.create_subprocess_exec(
            *encode_command(ffmpeg_binary(), out, height, fps, hls, preset),
            stdin=asyncio.subprocess.PIPE,
        )
        sampler = Sampler(ff.pid)

        async def write(b: bytes) -> None:
            ff.stdin.write(b)
            await ff.stdin.drain()

        async def watch() -> None:
            while True:
                await asyncio.sleep(1)
                sampler.sample()

        frames = (
            screencast_frames(page, width, height, quality)
            if method == "screencast"
            else screenshot_frames(page, quality)
        )
        watcher = asyncio.create_task(watch())
        try:
            stats = await pump(frames, write, fps, seconds)
        finally:
            watcher.cancel()
            ff.stdin.close()
            await ff.wait()
            await browser.close()
    return {
        "method": method,
        "channel": channel or "bundled chromium",
        "height": height,
        "fps": fps,
        "pump": stats.summary(),
        "resources": sampler.summary(),
        "output": str(out),
    }
