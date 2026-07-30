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

from fstream_dl.models import StreamSource

logger = logging.getLogger(__name__)

_PROGRESS_RE = re.compile(
    r"\[download\]\s+([\d.]+)%\s+of\s+~?\s*[\d.]+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)"
)


@dataclass
class ProgressEvent:
    percent: float
    speed: str
    eta: str


def check_yt_dlp() -> str:
    """Return the path to yt-dlp or raise RuntimeError if not found."""
    path = shutil.which("yt-dlp")
    if not path:
        raise RuntimeError("yt-dlp not found in PATH. Install it with: pip install yt-dlp")
    return path


_RETRYABLE = re.compile(r"HTTP Error 5\d\d|429|Too Many|Service Unavailable", re.IGNORECASE)
_MAX_RETRIES = 3
_RETRY_BACKOFF = (10, 30, 60)  # seconds between attempts


def download(
    source: StreamSource,
    output_path: Path,
    on_progress: Callable[[ProgressEvent], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> bool:
    """Download a single stream via yt-dlp. Retries up to 3 times on 5xx/429. Returns True on success."""
    cmd: list[str] = [
        check_yt_dlp(),
        "--add-header", f"Referer: {source.referer}",
    ]
    # Some CDNs (e.g. vidzy) 403 requests without a browser User-Agent; use the
    # one the provider resolved with so the download matches the embed fetch.
    if source.user_agent:
        cmd += ["--user-agent", source.user_agent]
    cmd += [
        "--merge-output-format", "mp4",
        "-o", str(output_path),
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
                    on_progress(ProgressEvent(
                        percent=float(m.group(1)),
                        speed=m.group(2),
                        eta=m.group(3),
                    ))

        proc.wait()
        stderr_thread.join()

        if proc.returncode == 0:
            _MIN_SIZE = 5 * 1024 * 1024  # 5 MB
            if output_path.exists() and output_path.stat().st_size >= _MIN_SIZE:
                return True
            actual = output_path.stat().st_size if output_path.exists() else 0
            logger.warning(
                "yt-dlp exited 0 but output is too small (%d bytes) for %s", actual, output_path.name
            )

        # Clean up any partial/empty file left by yt-dlp before retrying or giving up
        _cleanup(output_path)

        stderr = "\n".join(stderr_lines).strip()

        if attempt < _MAX_RETRIES - 1 and _RETRYABLE.search(stderr):
            wait = _RETRY_BACKOFF[attempt]
            logger.warning(
                "yt-dlp transient error for %s (attempt %d/%d), retrying in %ds: %s",
                output_path.name, attempt + 1, _MAX_RETRIES, wait, stderr,
            )
            time.sleep(wait)
            continue

        logger.error("yt-dlp failed for %s: %s", output_path.name, stderr)
        return False

    return False


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
                (lambda n: lambda ev: on_progress(n, ev))(path.name) if on_progress else None,
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
