from __future__ import annotations

import logging
import re
import shutil
import subprocess
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
) -> bool:
    """Download a single stream via yt-dlp. Retries up to 3 times on 5xx/429. Returns True on success."""
    cmd: list[str] = [
        check_yt_dlp(),
        "--add-header", f"Referer: {source.referer}",
        "--merge-output-format", "mp4",
        "-o", str(output_path),
        "--no-warnings",
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
        for line in proc.stdout:
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
        if proc.returncode == 0:
            return True

        stderr = proc.stderr.read() if proc.stderr else ""
        stderr = stderr.strip()

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
