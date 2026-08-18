from __future__ import annotations

import logging
import re
import shutil
import subprocess
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from sestudio.http_client import new_client
from sestudio.media import ffmpeg_location
from sestudio.models import StreamSource, sanitize_path_component

logger = logging.getLogger(__name__)

# Tolerant progress parser: yt-dlp drops the size/speed/ETA fields when they
# aren't known yet (common for HLS), so everything after the percentage is
# optional — otherwise progress would appear frozen for the whole download.
_PROGRESS_RE = re.compile(
    r"\[download\]\s+(?P<pct>[\d.]+)%"
    r"(?:\s+of\s+~?\s*(?P<size>\S+))?"
    r"(?:\s+at\s+(?P<speed>\S+))?"
    r"(?:\s+ETA\s+(?P<eta>\S+))?"
    r"(?:.*?\(frag\s+(?P<frag>\d+/\d+)\))?"
)

# Post-processing steps worth surfacing — the download bar sits at 100% while
# these run, which otherwise looks like a stall on large files.
_POSTPROCESS_RE = re.compile(r"^\[(Merger|ffmpeg|FixupM3u8|VideoConvertor)\]\s*(.*)")


@dataclass
class ProgressEvent:
    percent: float
    speed: str
    eta: str
    total_size: str = ""
    fragment: str = ""


def check_yt_dlp() -> str:
    """Return the path to yt-dlp or raise RuntimeError if not found."""
    path = shutil.which("yt-dlp")
    if not path:
        raise RuntimeError(
            "yt-dlp not found in PATH. Install it with: pip install yt-dlp"
        )
    return path


_RETRYABLE = re.compile(
    r"HTTP Error 5\d\d|429|Too Many|Service Unavailable", re.IGNORECASE
)
_MAX_RETRIES = 3
_RETRY_BACKOFF = (10, 30, 60)  # seconds between attempts


def download(
    source: StreamSource,
    output_path: Path,
    on_progress: Callable[[ProgressEvent], None] | None = None,
    cancel_event: threading.Event | None = None,
    on_status: Callable[[str, str], None] | None = None,
) -> bool:
    """Download a single stream via yt-dlp. Retries up to 3 times on 5xx/429.

    ``on_status(phase, detail)`` reports what the job is doing beyond the
    percentage — post-processing, retries, and the real failure reason — so the
    UI doesn't have to guess during the gaps.

    Returns True on success.
    """

    def status(phase: str, detail: str = "") -> None:
        if on_status:
            on_status(phase, detail)

    cmd: list[str] = [
        check_yt_dlp(),
        "--add-header",
        f"Referer: {source.referer}",
        # Some CDN nodes (e.g. vidzy's u*.vidzy.cc) 403 requests lacking the
        # Sec-Fetch-* headers a browser sends — match them here too.
        "--add-header",
        "Sec-Fetch-Dest: empty",
        "--add-header",
        "Sec-Fetch-Mode: cors",
        "--add-header",
        "Sec-Fetch-Site: cross-site",
    ]
    # Some CDNs (e.g. vidzy) 403 requests without a browser User-Agent; use the
    # one the provider resolved with so the download matches the embed fetch.
    if source.user_agent:
        cmd += ["--user-agent", source.user_agent]
    # Point yt-dlp at a bundled ffmpeg when the system has none (returns None
    # when a system ffmpeg is on PATH, so yt-dlp uses that instead).
    ffmpeg_dir = ffmpeg_location()
    if ffmpeg_dir:
        cmd += ["--ffmpeg-location", ffmpeg_dir]
    cmd += [
        # Subtitles the manifest itself advertises. yt-dlp names them
        # `<stem>.<lang>.vtt`, matching where download_subtitles puts the sidecar
        # ones, so both kinds land in the same place. A no-op when there are none.
        "--write-subs",
        "--sub-langs",
        "all",
        "--sub-format",
        "vtt",
        "--merge-output-format",
        "mp4",
        # `--merge-output-format` only governs *merging* separate audio and video
        # streams; a single HLS stream is written in its native container, so an
        # `.mp4` from a TS-segment manifest held MPEG-TS and no browser would
        # play it (MEDIA_ERR_SRC_NOT_SUPPORTED, and the file's own name lied
        # about it to every client that trusts the extension). Remuxing puts the
        # stream in the container the name claims; it is a copy, not a re-encode.
        "--remux-video",
        "mp4",
        "-o",
        str(output_path),
        "--progress",
        "--newline",
        source.url,
    ]
    logger.debug("Running: %s", " ".join(cmd))

    for attempt in range(_MAX_RETRIES):
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        assert proc.stdout is not None
        stderr_lines: list[str] = []

        def _drain_stderr(_proc: subprocess.Popen = proc) -> None:  # type: ignore[type-arg]
            if _proc.stderr:
                for line in _proc.stderr:
                    stripped = line.rstrip()
                    if stripped:
                        stderr_lines.append(stripped)
                        logger.debug("yt-dlp stderr: %s", stripped)

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

        for line in proc.stdout:
            if cancel_event and cancel_event.is_set():
                proc.terminate()
                proc.wait()
                stderr_thread.join()
                _cleanup(output_path)
                return False
            line = line.rstrip()
            if on_progress:
                m = _PROGRESS_RE.search(line)
                if m:
                    on_progress(
                        ProgressEvent(
                            percent=float(m.group("pct")),
                            speed=_known(m.group("speed")),
                            eta=_known(m.group("eta")),
                            total_size=_known(m.group("size")),
                            fragment=m.group("frag") or "",
                        )
                    )
                    continue
            post = _POSTPROCESS_RE.match(line)
            if post:
                status("processing", post.group(2) or post.group(1))

        proc.wait()
        stderr_thread.join()

        if proc.returncode == 0:
            _MIN_SIZE = 5 * 1024 * 1024  # 5 MB
            if output_path.exists() and output_path.stat().st_size >= _MIN_SIZE:
                # Only once the video is known good, so a discarded attempt does
                # not leave orphaned subtitles behind.
                download_subtitles(source, output_path)
                return True
            actual = output_path.stat().st_size if output_path.exists() else 0
            logger.warning(
                "yt-dlp exited 0 but output is too small (%d bytes) for %s",
                actual,
                output_path.name,
            )

        # Clean up any partial/empty file left by yt-dlp before retrying or giving up
        _cleanup(output_path)

        stderr = "\n".join(stderr_lines).strip()

        if attempt < _MAX_RETRIES - 1 and _RETRYABLE.search(stderr):
            wait = _RETRY_BACKOFF[attempt]
            logger.warning(
                "yt-dlp transient error for %s (attempt %d/%d), retrying in %ds: %s",
                output_path.name,
                attempt + 1,
                _MAX_RETRIES,
                wait,
                stderr,
            )
            status(
                "retrying",
                f"attempt {attempt + 2}/{_MAX_RETRIES} in {wait}s — {_short(stderr)}",
            )
            time.sleep(wait)
            continue

        logger.error("yt-dlp failed for %s: %s", output_path.name, stderr)
        status("failed", _short(stderr) or "yt-dlp exited without a usable file")
        return False

    return False


def subtitle_path(output_path: Path, lang: str) -> Path:
    """Where a sidecar subtitle for *output_path* is written.

    ``<video stem>.<lang>.vtt`` — the convention VLC and mpv look for, so an
    external player picks it up with no configuration, and one the library can
    find by globbing the stem.
    """
    safe = sanitize_path_component(lang) or "sub"
    return output_path.with_suffix("").with_name(f"{output_path.stem}.{safe}.vtt")


def download_subtitles(source: StreamSource, output_path: Path) -> list[Path]:
    """Fetch the stream's sidecar subtitles alongside the finished video.

    These are the ones lifted out of the embed page (vidzy's `/srtproxy/` VTTs
    and the like); yt-dlp cannot see them, because they are never referenced by
    the manifest it is given. Subtitles carried *inside* the manifest are a
    separate matter, left to yt-dlp's own ``--write-subs``.

    Failures are logged and skipped rather than raised: the video is the
    download, and losing its subtitles should not fail the job or delete it.
    """
    written: list[Path] = []
    if not source.subtitles:
        return written

    headers = {"User-Agent": source.user_agent, "Referer": source.referer}
    with new_client(headers=headers) as client:
        for sub in source.subtitles:
            target = subtitle_path(output_path, sub.lang)
            try:
                resp = client.get(sub.url)
                resp.raise_for_status()
                target.write_bytes(resp.content)
            except Exception as exc:  # noqa: BLE001 — best effort, see docstring
                logger.warning("Could not fetch subtitle %s: %s", sub.url[:80], exc)
                continue
            logger.debug("Wrote subtitle %s (%d bytes)", target.name, len(resp.content))
            written.append(target)
    return written


def _known(value: str | None) -> str:
    """Drop yt-dlp's "Unknown" placeholders so the UI shows nothing instead."""
    if not value or value.startswith("Unknown") or value == "N/A":
        return ""
    return value


def _short(text: str, limit: int = 300) -> str:
    """Last meaningful line of a stderr blob, trimmed for display."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return ""
    # yt-dlp puts the actionable message on the last ERROR line when there is one.
    errors = [ln for ln in lines if "ERROR" in ln]
    msg = (errors or lines)[-1]
    return msg[:limit]


def _cleanup(path: Path) -> None:
    """Remove output file and any .part sibling left by a failed yt-dlp run."""
    for p in [path, path.with_suffix(path.suffix + ".part")]:
        try:
            if p.exists():
                p.unlink()
                logger.debug("Removed partial file: %s", p)
        except OSError:
            pass


def download_many(
    jobs: list[tuple[StreamSource, Path]],
    concurrency: int = 20,
    on_progress: Callable[[str, ProgressEvent], None] | None = None,
) -> dict[str, bool]:
    """Download multiple streams concurrently. Returns filename -> success map."""
    results: dict[str, bool] = {}

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        future_to_name = {
            pool.submit(
                download,
                source,
                path,
                (lambda n: lambda ev: on_progress(n, ev))(path.name)
                if on_progress
                else None,
            ): path.name
            for source, path in jobs
        }
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            try:
                results[name] = future.result()
            except Exception as exc:
                logger.error("Unexpected error downloading %s: %s", name, exc)
                results[name] = False

    return results
