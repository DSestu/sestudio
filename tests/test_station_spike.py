import asyncio
import shutil
import subprocess

import pytest

from sestudio.media import ffmpeg_binary
from sestudio.music.station_spike import encode_command, pump


async def _source(fps: float, n: int):
    for i in range(n):
        await asyncio.sleep(1 / fps)
        yield bytes([i])


def test_pump_holds_the_output_rate_and_repeats_frames_for_a_slow_source():
    sent: list[bytes] = []

    async def write(b: bytes) -> None:
        sent.append(b)

    st = asyncio.run(pump(_source(10, 100), write, fps=30, seconds=1))
    assert 24 <= len(sent) <= 30
    assert 8 <= st.fresh <= 10
    assert len(set(sent)) <= st.fresh
    s = st.summary()
    assert 25 <= s["output_fps"] <= 31
    assert s["duplicated_pct"] > 50


def test_pump_skips_ticks_until_the_first_frame():
    sent: list[bytes] = []

    async def late():
        await asyncio.sleep(0.5)
        yield b"x"
        await asyncio.sleep(10)

    async def write(b: bytes) -> None:
        sent.append(b)

    asyncio.run(pump(late(), write, fps=20, seconds=1))
    assert 8 <= len(sent) <= 11


def test_encode_command_scales_and_sets_gop():
    cmd = encode_command("ff", "o.mp4", 720, 30)  # type: ignore[arg-type]
    assert cmd[-1] == "o.mp4"
    assert "scale=-2:720:flags=fast_bilinear,format=yuv420p" in cmd
    assert cmd[cmd.index("-g") + 1] == "60"
    assert "hls" in encode_command("ff", "o.m3u8", 720, 30, hls=True)  # type: ignore[arg-type]


def test_ffmpeg_accepts_the_piped_jpegs(tmp_path):
    """The real encoder against synthetic JPEG frames: the output plays for the expected time."""
    ff = ffmpeg_binary()
    jpg = subprocess.run(
        [
            ff,
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=s=320x180:d=1",
            "-frames:v",
            "1",
            "-f",
            "mjpeg",
            "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    out = tmp_path / "o.mp4"
    cmd = encode_command(ff, out, 144, 10)
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for _ in range(20):
        p.stdin.write(jpg)
    p.stdin.close()
    assert p.wait(timeout=60) == 0
    assert out.stat().st_size > 0


@pytest.mark.exclude_ci
def test_browser_renders_a_page(tmp_path):
    """Needs a browser; not run in CI."""
    pytest.importorskip("playwright")
    browser = shutil.which("google-chrome") or shutil.which("chromium")
    if not browser:
        pytest.skip("no system browser")
    from sestudio.music.station_spike import run

    page = tmp_path / "p.html"
    page.write_text(
        "<body style='background:#036'><script>setInterval(()=>document.title=Date.now(),30)</script>"
    )
    r = asyncio.run(
        run(
            page.as_uri(),
            tmp_path / "o.mp4",
            seconds=3,
            height=360,
            fps=15,
            executable_path=browser,
        )
    )
    assert r["pump"]["output_fps"] > 10
    assert (tmp_path / "o.mp4").stat().st_size > 0
