from __future__ import annotations

from pathlib import Path

from pytest_httpx import HTTPXMock

from sestudio.downloader import download_subtitles, subtitle_path
from sestudio.models import StreamSource, Subtitle

VTT = "WEBVTT\n\n00:01.000 --> 00:02.000\nBonjour\n"


def _source(*subs: Subtitle) -> StreamSource:
    return StreamSource(
        url="https://cdn.example/master.m3u8",
        referer="https://vidzy.org/",
        provider="vidzy",
        subtitles=list(subs),
    )


def test_names_sidecar_after_the_video(tmp_path: Path):
    video = tmp_path / "S01E01 - Title.mp4"
    assert subtitle_path(video, "fre").name == "S01E01 - Title.fre.vtt"


def test_sanitises_the_language_in_the_name(tmp_path: Path):
    """A hostile lang must not escape the video's own directory."""
    video = tmp_path / "Film.mp4"
    target = subtitle_path(video, "../etc")
    assert target.parent == tmp_path
    assert "/" not in target.name and ".." not in target.name


def test_writes_the_subtitle_next_to_the_video(httpx_mock: HTTPXMock, tmp_path: Path):
    httpx_mock.add_response(url="https://vidzy.org/srtproxy/a_fre.vtt", text=VTT)
    video = tmp_path / "Episode.mp4"
    video.write_bytes(b"video")

    written = download_subtitles(
        _source(
            Subtitle(
                url="https://vidzy.org/srtproxy/a_fre.vtt", lang="fre", label="French"
            )
        ),
        video,
    )

    assert written == [tmp_path / "Episode.fre.vtt"]
    assert written[0].read_text() == VTT


def test_sends_the_streams_referer(httpx_mock: HTTPXMock, tmp_path: Path):
    # The subtitle host rejects requests without it, exactly as the segments do.
    httpx_mock.add_response(url="https://vidzy.org/s.vtt", text=VTT)
    video = tmp_path / "Episode.mp4"

    download_subtitles(
        _source(Subtitle(url="https://vidzy.org/s.vtt", lang="fre", label="French")),
        video,
    )

    assert httpx_mock.get_requests()[0].headers["Referer"] == "https://vidzy.org/"


def test_a_failed_subtitle_does_not_fail_the_download(
    httpx_mock: HTTPXMock, tmp_path: Path
):
    httpx_mock.add_response(url="https://vidzy.org/gone.vtt", status_code=404)
    video = tmp_path / "Episode.mp4"

    assert (
        download_subtitles(
            _source(
                Subtitle(url="https://vidzy.org/gone.vtt", lang="fre", label="French")
            ),
            video,
        )
        == []
    )
    assert not (tmp_path / "Episode.fre.vtt").exists()


def test_one_bad_subtitle_does_not_stop_the_others(
    httpx_mock: HTTPXMock, tmp_path: Path
):
    httpx_mock.add_response(url="https://vidzy.org/gone.vtt", status_code=500)
    httpx_mock.add_response(url="https://vidzy.org/ok.vtt", text=VTT)
    video = tmp_path / "Episode.mp4"

    written = download_subtitles(
        _source(
            Subtitle(url="https://vidzy.org/gone.vtt", lang="eng", label="English"),
            Subtitle(url="https://vidzy.org/ok.vtt", lang="fre", label="French"),
        ),
        video,
    )

    assert written == [tmp_path / "Episode.fre.vtt"]


def test_no_subtitles_makes_no_requests(httpx_mock: HTTPXMock, tmp_path: Path):
    assert download_subtitles(_source(), tmp_path / "Episode.mp4") == []
    assert httpx_mock.get_requests() == []
