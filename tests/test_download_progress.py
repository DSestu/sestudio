from __future__ import annotations

import pytest

from sestudio.downloader import _POSTPROCESS_RE, _PROGRESS_RE, _known, _short


def parse(line: str):
    m = _PROGRESS_RE.search(line)
    if not m:
        return None
    return {
        "pct": float(m.group("pct")),
        "size": _known(m.group("size")),
        "speed": _known(m.group("speed")),
        "eta": _known(m.group("eta")),
        "frag": m.group("frag") or "",
    }


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        # The classic fully-populated line.
        (
            "[download]  12.3% of ~ 412.53MiB at 1.20MiB/s ETA 05:12",
            {
                "pct": 12.3,
                "size": "412.53MiB",
                "speed": "1.20MiB/s",
                "eta": "05:12",
                "frag": "",
            },
        ),
        # HLS: carries a fragment counter.
        (
            "[download]   3.1% of ~ 250.00MiB at 900.00KiB/s ETA 04:40 (frag 42/318)",
            {
                "pct": 3.1,
                "size": "250.00MiB",
                "speed": "900.00KiB/s",
                "eta": "04:40",
                "frag": "42/318",
            },
        ),
        # Unknown speed/ETA must still yield a percentage (previously matched
        # nothing at all, so the UI's progress appeared frozen).
        (
            "[download]  99.9% of ~ 412.53MiB at Unknown B/s ETA Unknown",
            {"pct": 99.9, "size": "412.53MiB", "speed": "", "eta": "", "frag": ""},
        ),
        # Bare percentage, no trailing fields.
        (
            "[download]  50.0%",
            {"pct": 50.0, "size": "", "speed": "", "eta": "", "frag": ""},
        ),
        # Completion line uses "in", not "ETA".
        (
            "[download] 100% of 412.53MiB in 00:03:21",
            {"pct": 100.0, "size": "412.53MiB", "speed": "", "eta": "", "frag": ""},
        ),
    ],
)
def test_progress_lines_parse(line, expected):
    assert parse(line) == expected


def test_non_progress_line_ignored():
    assert parse("[info] Downloading 1 format(s): hls-1080") is None


@pytest.mark.parametrize(
    ("line", "tool"),
    [
        ('[Merger] Merging formats into "S01E01.mp4"', "Merger"),
        ("[ffmpeg] Fixing malformed AAC bitstream", "ffmpeg"),
        ("[FixupM3u8] Fixing MPEG-TS in MP4 container", "FixupM3u8"),
    ],
)
def test_postprocessing_lines_detected(line, tool):
    """These run after the bar hits 100%, which otherwise looks like a stall."""
    m = _POSTPROCESS_RE.match(line)
    assert m is not None
    assert m.group(1) == tool


def test_short_prefers_the_error_line():
    stderr = (
        "WARNING: some noise\n"
        "ERROR: unable to download video data: HTTP Error 403: Forbidden\n"
        "trailing noise"
    )
    assert _short(stderr) == (
        "ERROR: unable to download video data: HTTP Error 403: Forbidden"
    )


def test_short_falls_back_to_last_line_and_truncates():
    assert _short("only line") == "only line"
    assert _short("") == ""
    assert len(_short("x" * 500)) == 300
