"""The yt-dlp command line itself.

Worth asserting because a wrong flag here is invisible: yt-dlp exits 0, the file
lands at the name it was asked for, and nothing goes wrong until a player tries
to decode it.
"""

from __future__ import annotations

from pathlib import Path

from sestudio import downloader
from sestudio.models import StreamSource


class _FakeProc:
    """Enough of Popen for `download` to run: no output, exits non-zero."""

    def __init__(self) -> None:
        self.stdout: list[str] = []
        self.stderr: list[str] = []
        self.returncode = 1

    def wait(self) -> int:
        return self.returncode


def _argv_for(url: str, tmp_path: Path, monkeypatch) -> list[str]:
    captured: list[list[str]] = []

    def fake_popen(cmd, **_kwargs):
        captured.append(list(cmd))
        return _FakeProc()

    monkeypatch.setattr(downloader, "check_yt_dlp", lambda: "yt-dlp")
    # Keeps the fake Popen to the one call under test: resolving ffmpeg shells
    # out too, and would otherwise be answered by it.
    monkeypatch.setattr(downloader, "ffmpeg_location", lambda: None)
    monkeypatch.setattr(downloader.subprocess, "Popen", fake_popen)
    # No sleeping between the retries this failure provokes.
    monkeypatch.setattr(downloader.time, "sleep", lambda _s: None)

    source = StreamSource(url=url, referer="https://example.test/", provider="vidzy")
    assert downloader.download(source, tmp_path / "S01E01 - Pilot.mp4") is False
    assert captured
    return captured[0]


def test_hls_download_is_remuxed_into_the_container_its_name_claims(
    tmp_path, monkeypatch
):
    """An HLS manifest yields MPEG-TS unless yt-dlp is told to remux.

    `--merge-output-format` does not cover this: it governs *merging* separate
    audio and video streams, so a single stream was written in its native
    container under an `.mp4` name. Browsers refused it outright
    (MEDIA_ERR_SRC_NOT_SUPPORTED) while the player sat on a spinner, and the
    extension misled every client that types media by it.
    """
    argv = _argv_for("https://cdn.example.test/hls/master.m3u8", tmp_path, monkeypatch)

    assert "--remux-video" in argv
    assert argv[argv.index("--remux-video") + 1] == "mp4"


def test_output_path_is_passed_through_unchanged(tmp_path, monkeypatch):
    """Remuxing must not cost the caller control of where the file lands."""
    argv = _argv_for("https://cdn.example.test/hls/master.m3u8", tmp_path, monkeypatch)

    assert argv[argv.index("-o") + 1] == str(tmp_path / "S01E01 - Pilot.mp4")
