"""Reading a stored file's audio and subtitle tracks.

The parser reads ffmpeg's human-readable report (there is no ffprobe beside the
bundled binary), so its input is fixed here as literal output: a change in that
format is exactly the thing that would silently empty every track menu.
"""

from __future__ import annotations

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


def test_a_stem_with_glob_characters_is_matched_literally(tmp_path: Path):
    """Titles contain brackets. Unescaped, `[HD]` is a character class and the
    file's own subtitles stop being found."""
    video = tmp_path / "Ep [HD] (1080p).mp4"
    video.write_bytes(b"x")
    (tmp_path / "Ep [HD] (1080p).fr.vtt").write_text("WEBVTT\n")

    assert [lang for lang, _ in downloaded.sidecar_subtitles(video)] == ["fr"]
