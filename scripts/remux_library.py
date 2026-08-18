#!/usr/bin/env python3
"""Repair downloaded files whose container does not match their name.

An HLS download that was never remuxed holds MPEG-TS under an `.mp4` name (see
`--remux-video` in :mod:`sestudio.downloader`, which stops new ones happening).
Every browser refuses those outright, and the player has no way to say so — it
just never loads.

Nothing is re-downloaded. The streams inside are already what you want; only the
box around them is wrong, so this is a copy, not a re-encode: seconds per file,
bit-for-bit identical video and audio.

    python3 scripts/remux_library.py                          # report
    python3 scripts/remux_library.py --apply                  # repair
    python3 scripts/remux_library.py --root /media            # somewhere else

Each repair is written beside the original and moved into place only once ffmpeg
has succeeded and the result reports the same duration, so an interrupted run
leaves the original untouched.

Where it looks: the `output_root` recorded in the settings, so the folder set in
the app is the folder repaired and there is nothing to keep in step by hand.
`--root` overrides it; `--config` points at a settings file somewhere else (as
does `SESTUDIO_CONFIG`, for the same reason the app honours it).

STANDALONE BY DESIGN. A library usually lives on the machine that downloaded it,
which is not the machine you are reading this on, and remuxing across a network
mount would pull and push every byte for no reason. So this file depends on
nothing but Python 3 and an ffmpeg — no virtualenv, no checkout, not even the
package it ships with. Copy it to the server, run it there, and no video crosses
the network.

    scp scripts/remux_library.py you@server:/tmp/
    ssh you@server 'python3 /tmp/remux_library.py'          # reads its settings

It will use `ffmpeg` from PATH, or `--ffmpeg /path/to/ffmpeg` for one that isn't
there; from a checkout it falls back to the ffmpeg bundled with the app.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '…'` — ffmpeg lists every format the
# demuxer answers to, so the whole set is read and matched against the name.
_INPUT_RE = re.compile(r"^Input #0, ([^,]+(?:,[^,]+)*), from ", re.MULTILINE)
_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)")

# Containers each extension is allowed to hold. Only what this tool writes is
# listed: an .mkv or .avi in a hand-made collection is nobody's business.
_EXPECTED = {
    ".mp4": {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"},
    ".m4v": {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"},
}

# Deliberately duplicated from `sestudio.downloaded` rather than imported: this
# script has to run on a box with no checkout on it. Only the extensions that
# can be mismatched need listing, so this is the short list, not that one.
_VIDEO_SUFFIXES = frozenset(_EXPECTED)

# Deep enough for any sane arrangement, shallow enough that a stray mount cannot
# turn a scan into a filesystem crawl.
_MAX_DEPTH = 6

# A remux that loses more than this against the original is not a remux.
_DURATION_TOLERANCE = 1.0


def _walk(root: Path) -> list[Path]:
    """Every candidate file under *root*, depth-capped, symlinked dirs skipped."""
    found: list[Path] = []
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = sorted(directory.iterdir())
        except OSError:
            continue  # unreadable mount or permission — skip, don't fail the scan
        for entry in entries:
            if entry.name.startswith("."):
                continue
            try:
                if entry.is_dir():
                    if depth < _MAX_DEPTH and not entry.is_symlink():
                        stack.append((entry, depth + 1))
                elif (
                    entry.suffix.lower() in _VIDEO_SUFFIXES and entry.stat().st_size > 0
                ):
                    found.append(entry)
            except OSError:
                continue
    return found


def _resolve_ffmpeg(explicit: str | None) -> str:
    """The ffmpeg to use: the one asked for, then PATH, then the bundled one."""
    if explicit:
        return explicit
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    try:  # only available from a checkout with the package installed
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
        from sestudio.media import ffmpeg_binary

        return ffmpeg_binary()
    except Exception as exc:
        raise RuntimeError(
            "no ffmpeg on PATH; install one or pass --ffmpeg /path/to/ffmpeg"
        ) from exc


def _config_path(explicit: str | None) -> Path:
    """Where the settings live.

    Read directly rather than through :mod:`sestudio.config`, which would drag
    the package (and so a virtualenv) onto a server that only needs to run this
    one file. `SESTUDIO_CONFIG` is honoured for the same reason it is there —
    a second instance keeps its settings somewhere else.
    """
    if explicit:
        return Path(explicit)
    env = os.environ.get("SESTUDIO_CONFIG")
    return Path(env) if env else Path.home() / ".config" / "sestudio" / "config.json"


def _default_root(explicit_config: str | None) -> Path:
    """The download root recorded in the settings."""
    path = _config_path(explicit_config)
    if not path.is_file():
        raise RuntimeError(f"No settings at {path} — pass --root (or --config)")
    try:
        root = json.loads(path.read_text(encoding="utf-8")).get("output_root")
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Could not read {path}: {exc}") from exc
    if not root:
        raise RuntimeError(f"No output_root recorded in {path} — pass --root")
    print(f"Using the download root from {path}")
    return Path(str(root))


def _describe(binary: str, path: Path) -> tuple[set[str], float | None]:
    """(container formats, duration) as ffmpeg reports them for *path*.

    No output file: ffmpeg describes the input, complains, and exits — the same
    trick `downloaded.duration_of` uses, and for the same reason (there is no
    ffprobe alongside the bundled ffmpeg).
    """
    result = subprocess.run(
        [binary, "-nostdin", "-hide_banner", "-i", str(path)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    text = result.stderr.decode("utf-8", "replace")

    formats: set[str] = set()
    match = _INPUT_RE.search(text)
    if match:
        formats = {f.strip() for f in match.group(1).split(",")}

    duration: float | None = None
    stamp = _DURATION_RE.search(text)
    if stamp:
        hours, minutes, rest = stamp.groups()
        duration = int(hours) * 3600 + int(minutes) * 60 + float(rest)

    return formats, duration


def _mismatched(formats: set[str], suffix: str) -> bool:
    expected = _EXPECTED.get(suffix.lower())
    # An unreadable file (no formats) is left alone: this script repairs
    # containers, and a file ffmpeg cannot open has a different problem.
    return bool(expected and formats and not (formats & expected))


def _remux(binary: str, path: Path, duration: float | None) -> str:
    """Rewrite *path* into the container its name claims. Returns a verdict."""
    tmp = path.with_name(f"{path.stem}.remux.{os.getpid()}.tmp{path.suffix}")
    command = [
        binary,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(path),
        # Streams only: a timed_id3 data track rides along in HLS output and no
        # mp4 muxer will take it.
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-map",
        "0:s?",
        "-c",
        "copy",
        # Subtitles inside an mp4 must be mov_text; copying an HLS subtitle
        # track in verbatim is what makes the mux fail. A no-op with no subs.
        "-c:s",
        "mov_text",
        # Index at the front, so a player (and a DLNA renderer) can seek without
        # fetching the tail of the file first.
        "-movflags",
        "+faststart",
        str(tmp),
    ]
    try:
        result = subprocess.run(
            command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )
        if result.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
            detail = result.stderr.decode("utf-8", "replace").strip().splitlines()
            return f"FAILED ({detail[-1] if detail else 'ffmpeg error'})"

        _, after = _describe(binary, tmp)
        if duration and after and abs(after - duration) > _DURATION_TOLERANCE:
            return f"FAILED (duration {after:.0f}s != {duration:.0f}s, kept original)"

        os.replace(tmp, path)
        return "repaired"
    finally:
        tmp.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", help="Library root (default: the configured download root)"
    )
    parser.add_argument("--ffmpeg", help="ffmpeg to use (default: the one on PATH)")
    parser.add_argument(
        "--config",
        help="Settings file to read the download root from "
        "(default: $SESTUDIO_CONFIG, else ~/.config/sestudio/config.json)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually repair. Without it, only reports what would be repaired.",
    )
    args = parser.parse_args()

    try:
        root = Path(args.root) if args.root else _default_root(args.config)
        binary = _resolve_ffmpeg(args.ffmpeg)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 1

    files = _walk(root)
    print(f"Scanning {len(files)} file(s) under {root}\n")

    broken = 0
    repaired = 0
    for path in files:
        formats, duration = _describe(binary, path)
        if not _mismatched(formats, path.suffix):
            continue

        broken += 1
        found = ",".join(sorted(formats)) or "unreadable"
        print(f"  {path.relative_to(root)}\n      holds {found}, named {path.suffix}")
        if args.apply:
            verdict = _remux(binary, path, duration)
            print(f"      → {verdict}")
            if verdict == "repaired":
                repaired += 1
        # Flushed as it goes: a large library takes a while, and a silent
        # terminal for ten minutes is indistinguishable from a hang.
        sys.stdout.flush()

    if not broken:
        print("Nothing to repair — every file is in the container its name claims.")
        return 0

    if args.apply:
        print(f"\n{repaired}/{broken} repaired.")
        return 0 if repaired == broken else 1

    print(f"\n{broken} file(s) would be repaired. Re-run with --apply to do it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
