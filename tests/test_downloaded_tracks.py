"""Reading a stored file's audio and subtitle tracks.

The parser reads ffmpeg's human-readable report (there is no ffprobe beside the
bundled binary), so its input is fixed here as literal output: a change in that
format is exactly the thing that would silently empty every track menu.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from sestudio import downloaded

# An MKV as ffmpeg describes one: named tracks, two languages, forced subtitles.
# This is the shape a multi-audio release actually arrives in.
_MKV_REPORT = """\
Input #0, matroska,webm, from 'ep.mkv':
  Metadata:
    title           : Some Release Name
  Duration: 00:23:40.10, start: 0.000000, bitrate: 2937 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080, 23.98 fps
    Metadata:
      title           : Video Track
  Stream #0:1(fre): Audio: aac (LC), 48000 Hz, stereo, fltp (default)
    Metadata:
      title           : Français VF
  Stream #0:2(jpn): Audio: ac3, 48000 Hz, 5.1, fltp
    Metadata:
      title           : Japonais VO
  Stream #0:3(fre): Subtitle: subrip (default)
    Metadata:
      title           : Complet
  Stream #0:4(fre): Subtitle: hdmv_pgs_subtitle
    Metadata:
      title           : Forcés
"""


def _tracks():
    return downloaded._parse_streams(_MKV_REPORT)


def test_audio_tracks_are_indexed_for_ffmpeg_not_by_stream_number():
    """`-map 0:a:N` counts audio streams only; the video stream must not shift it."""
    audio = _tracks().audio

    assert [a.index for a in audio] == [0, 1]
    assert [a.codec for a in audio] == ["aac", "ac3"]


def test_track_names_and_languages_are_read():
    audio = _tracks().audio

    assert [a.lang for a in audio] == ["fre", "jpn"]
    assert [a.label for a in audio] == ["Français VF", "Japonais VO"]
    # Exactly one default, and it is the one ffmpeg marked.
    assert [a.default for a in audio] == [True, False]


def test_the_containers_own_title_is_not_taken_for_a_track():
    """A file-level `title` precedes every stream; attributing it to the first
    track would name the French audio after the release."""
    assert _tracks().audio[0].label != "Some Release Name"


def test_a_video_tracks_title_does_not_leak_onto_the_first_audio_track():
    """Titles follow the stream they belong to, so the parser has to close one
    stream before the next — otherwise every label is off by one."""
    assert _tracks().audio[0].label == "Français VF"


def test_picture_subtitles_are_reported_but_marked_untranslatable():
    """PGS is an image. It is listed so the reason is knowable, and flagged so
    nothing offers a WebVTT that could never be produced."""
    subs = _tracks().subtitles

    assert [s.codec for s in subs] == ["subrip", "hdmv_pgs_subtitle"]
    assert [s.text for s in subs] == [True, False]


def test_missing_language_is_empty_rather_than_und():
    """`und` is a muxer saying it does not know; offering it as a language would
    put "UND" in a menu."""
    report = "  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo\n"

    track = downloaded._parse_streams(report).audio[0]

    assert track.lang == ""
    # With no language and no title, the position is all that is left to show.
    assert track.label == "Track 1"


def test_a_file_with_one_audio_track_and_no_subtitles_reports_just_that():
    report = (
        "  Stream #0:0: Video: h264 (High), yuv420p, 864x488\n"
        "  Stream #0:1: Audio: aac (LC), 44100 Hz, stereo (default)\n"
    )

    tracks = downloaded._parse_streams(report)

    assert len(tracks.audio) == 1
    assert tracks.subtitles == []


def test_sidecar_subtitles_are_found_by_the_video_they_belong_to(tmp_path: Path):
    """The scan ignores subtitle files, so they are found from the video's stem —
    which is also what makes `<stem>.<lang>.vtt` the right thing to write."""
    video = tmp_path / "S01E04 - Accomplissement.mp4"
    video.write_bytes(b"x")
    (tmp_path / "S01E04 - Accomplissement.fr.vtt").write_text("WEBVTT\n")
    (tmp_path / "S01E04 - Accomplissement.en.vtt").write_text("WEBVTT\n")
    # Belongs to a different episode, and to no episode at all.
    (tmp_path / "S01E05 - Fuite.fr.vtt").write_text("WEBVTT\n")
    (tmp_path / "notes.txt").write_text("hello")

    found = downloaded.sidecar_subtitles(video)

    assert [lang for lang, _ in found] == ["en", "fr"]


def test_the_default_audio_track_builds_nothing(tmp_path: Path, monkeypatch):
    """Track 0 is the original file. Copying it would spend a minute and a
    gigabyte to produce something already on disk."""
    video = tmp_path / "ep.mkv"
    video.write_bytes(b"x")
    monkeypatch.setattr(
        downloaded,
        "tracks_of",
        lambda _f: downloaded.MediaTracks(
            audio=[
                downloaded.Track(0, "aac", "fra", "VF", True),
                downloaded.Track(1, "ac3", "jpn", "VO", False),
            ],
            subtitles=[],
        ),
    )
    # Would raise if it ever reached ffmpeg: nothing should be run for these.
    monkeypatch.setattr(
        downloaded.subprocess, "run", lambda *a, **k: pytest.fail("ran ffmpeg")
    )

    assert downloaded.alternate_audio(video, "ep.mkv", 0) is None
    assert downloaded.alternate_audio(video, "ep.mkv", 2) is None
    assert downloaded.alternate_audio(video, "ep.mkv", -1) is None


# --- what a browser will and will not open --------------------------------- #

# Real `ffmpeg -i` video lines, one per shape the parser has to survive: a bare
# codec, one with a profile, one with a profile and a tag, and a 10-bit encode.
VIDEO_LINES = {
    "xvid": "  Stream #0:0: Video: mpeg4 (Advanced Simple Profile) "
    "(XVID / 0x44495658), yuv420p, 720x408 [SAR 1:1 DAR 30:17], 1165 kb/s, 23.98 fps",
    "h264": "  Stream #0:0: Video: h264 (High), yuv420p(tv, bt709, progressive), "
    "1920x1036 [SAR 1:1 DAR 480:259], 25 fps, 25 tbr, 1k tbn (default)",
    "h264_tagged": "  Stream #0:0[0x1](und): Video: h264 (High) "
    "(avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 864x488, 1058 kb/s",
    "hevc10": "  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv), 1920x1080, "
    "SAR 1:1 DAR 16:9, 23.98 fps, 23.98 tbr, 1k tbn (default)",
}


@pytest.mark.parametrize(
    ("line", "codec", "pix_fmt"),
    [
        (VIDEO_LINES["xvid"], "mpeg4", "yuv420p"),
        (VIDEO_LINES["h264"], "h264", "yuv420p"),
        (VIDEO_LINES["h264_tagged"], "h264", "yuv420p"),
        (VIDEO_LINES["hevc10"], "hevc", "yuv420p10le"),
    ],
)
def test_the_video_stream_is_read_with_its_pixel_format(line, codec, pix_fmt):
    """The pixel format matters as much as the codec: a 10-bit encode reports
    `h264` like any other and plays in no browser."""
    tracks = downloaded._parse_streams(line)

    assert (tracks.video, tracks.video_pix_fmt) == (codec, pix_fmt)


@pytest.mark.parametrize(
    ("name", "video", "audio", "playable"),
    [
        ("film.mp4", VIDEO_LINES["h264"], "aac", True),
        ("film.mkv", VIDEO_LINES["h264"], "aac", True),
        # The container alone is enough to rule it out: Chrome will not open an
        # AVI whatever is inside it.
        ("film.avi", VIDEO_LINES["h264"], "aac", False),
        ("film.ts", VIDEO_LINES["h264"], "aac", False),
        # Right container, wrong stream.
        ("film.mp4", VIDEO_LINES["xvid"], "aac", False),
        ("film.mp4", VIDEO_LINES["hevc10"], "aac", False),
        ("film.mp4", VIDEO_LINES["h264"], "ac3", False),
    ],
)
def test_browser_can_play_reads_container_and_streams(
    tmp_path: Path, monkeypatch, name, video, audio, playable
):
    file = tmp_path / name
    file.write_bytes(b"x")
    report = f"{video}\n  Stream #0:1(fre): Audio: {audio}, 48000 Hz, stereo\n"
    monkeypatch.setattr(
        downloaded, "tracks_of", lambda _f: downloaded._parse_streams(report)
    )

    assert downloaded.browser_can_play(file) is playable


def test_a_file_with_no_audio_is_still_playable(tmp_path: Path, monkeypatch):
    """A silent rip has no audio track to disqualify it, and `tracks.audio[0]`
    would raise on the way to finding that out."""
    file = tmp_path / "silent.mp4"
    file.write_bytes(b"x")
    monkeypatch.setattr(
        downloaded,
        "tracks_of",
        lambda _f: downloaded._parse_streams(VIDEO_LINES["h264"]),
    )

    assert downloaded.browser_can_play(file) is True


# --- transcoded on the way out --------------------------------------------- #


def test_the_playlist_covers_the_whole_film(tmp_path: Path, monkeypatch):
    """Every segment is listed up front, which is what lets the player seek
    anywhere before a frame of it has been encoded."""
    file = tmp_path / "film.avi"
    file.write_bytes(b"x")
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 9006.99)

    durations = downloaded.hls_segment_durations(file)

    assert durations is not None
    assert len(durations) == 1502
    assert durations[0] == downloaded.HLS_SEGMENT_SECONDS
    # The remainder, not a full segment padded out past the end of the film.
    assert round(durations[-1], 2) == 0.99
    assert round(sum(durations), 2) == 9006.99


def test_no_playlist_without_a_duration(tmp_path: Path, monkeypatch):
    """Nothing can be listed for a file whose length is unknown, and claiming a
    length would put a scrub bar over a film that ends somewhere else."""
    file = tmp_path / "film.avi"
    file.write_bytes(b"x")
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: None)

    assert downloaded.hls_segment_durations(file) is None


def test_a_segment_is_encoded_for_its_own_place_in_the_film(
    tmp_path: Path, monkeypatch
):
    file = tmp_path / "film.avi"
    file.write_bytes(b"x")
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 600.0)
    monkeypatch.setattr(downloaded, "_hls_dir", lambda: tmp_path / "hls")
    monkeypatch.setattr(downloaded, "ffmpeg_binary", lambda: "ffmpeg")
    commands: list[list[str]] = []

    def fake_run(command, **_kwargs):
        commands.append(command)
        Path(command[-1]).write_bytes(b"segment")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(downloaded.subprocess, "run", fake_run)

    out = downloaded.hls_segment(file, "film.avi", 10, audio=1)

    assert out is not None and out.read_bytes() == b"segment"
    command = commands[0]
    # Seeks to its own start, runs one segment long, and is stamped with where
    # it sits so the player stitches the segments into one timeline.
    assert command[command.index("-ss") + 1] == "60.000"
    assert command[command.index("-t") + 1] == "6.000"
    assert command[command.index("-output_ts_offset") + 1] == "60.000"
    # The wanted audio track, optional so a file without one still yields video.
    assert "0:a:1?" in command
    # Output a browser will take: 8-bit, no B-frames, stereo.
    assert command[command.index("-pix_fmt") + 1] == "yuv420p"
    assert command[command.index("-bf") + 1] == "0"
    assert command[command.index("-ac") + 1] == "2"

    # Built once; asking again is served from disk without running ffmpeg.
    assert downloaded.hls_segment(file, "film.avi", 10, audio=1) == out
    assert len(commands) == 1


def test_there_is_no_segment_past_the_end(tmp_path: Path, monkeypatch):
    file = tmp_path / "film.avi"
    file.write_bytes(b"x")
    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 60.0)
    monkeypatch.setattr(
        downloaded.subprocess, "run", lambda *a, **k: pytest.fail("ran ffmpeg")
    )

    assert downloaded.hls_segment(file, "film.avi", 10) is None
    assert downloaded.hls_segment(file, "film.avi", -1) is None


def test_a_first_track_no_browser_plays_is_rebuilt(tmp_path: Path, monkeypatch):
    """A rip whose only audio is AC-3 played picture and no sound: track 0 was
    always "the original file". It is re-encoded like any other track now."""
    video = tmp_path / "film.mkv"
    video.write_bytes(b"x")
    monkeypatch.setattr(
        downloaded,
        "tracks_of",
        lambda _f: downloaded.MediaTracks(
            audio=[downloaded.Track(0, "ac3", "fra", "", True)], subtitles=[]
        ),
    )
    monkeypatch.setattr(downloaded, "_audio_dir", lambda: tmp_path / "audio")
    assert downloaded.cached_alternate_audio(video, "film.mkv", 0) is None

    monkeypatch.setattr(downloaded, "duration_of", lambda _f: 100.0)
    monkeypatch.setattr(downloaded, "ffmpeg_binary", lambda: "ffmpeg")
    commands: list[list[str]] = []
    seen: list[float | None] = []

    class FakeFfmpeg:
        """Reports two positions, then finishes. Progress is read mid-run."""

        def __init__(self, command, **_kwargs):
            commands.append(command)
            self.command = command

        @property
        def stdout(self):
            for line in (
                "out_time_us=25000000\n",
                "frame=1\n",
                "out_time_us=75000000\n",
            ):
                seen.append(downloaded.audio_progress(video, "film.mkv", 0))
                yield line

        def wait(self):
            Path(self.command[-1]).write_bytes(b"mp4")
            return 0

        def kill(self):  # pragma: no cover — only on the 30-minute watchdog
            pass

    monkeypatch.setattr(downloaded.subprocess, "Popen", FakeFfmpeg)

    out = downloaded.alternate_audio(video, "film.mkv", 0)

    assert out is not None and out.read_bytes() == b"mp4"
    assert commands[0][commands[0].index("-c:a") + 1] == "aac"
    # Read before each line: 0 at the start, a quarter after the first report,
    # unchanged by a non-position line — and gone once the run is over.
    assert seen == [0.0, 0.25, 0.25]
    assert downloaded.audio_progress(video, "film.mkv", 0) is None
    # Made once: from here on it is served from the cache.
    assert downloaded.cached_alternate_audio(video, "film.mkv", 0) == out


def test_a_stem_with_glob_characters_is_matched_literally(tmp_path: Path):
    """Titles contain brackets. Unescaped, `[HD]` is a character class and the
    file's own subtitles stop being found."""
    video = tmp_path / "Ep [HD] (1080p).mp4"
    video.write_bytes(b"x")
    (tmp_path / "Ep [HD] (1080p).fr.vtt").write_text("WEBVTT\n")

    assert [lang for lang, _ in downloaded.sidecar_subtitles(video)] == ["fr"]
