import logging
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from fstream_dl.models import StreamSource

logger = logging.getLogger(__name__)


def _yt_dlp_path() -> str:
    path = shutil.which("yt-dlp")
    if not path:
        raise RuntimeError("yt-dlp not found in PATH. Install it with: pip install yt-dlp")
    return path


def download(source: StreamSource, output_path: Path) -> bool:
    """Download a single stream via yt-dlp. Returns True on success."""
    cmd = [
        _yt_dlp_path(),
        "--add-header", f"Referer: {source.referer}",
        "--merge-output-format", "mp4",
        "-o", str(output_path),
        "--no-warnings",
        "--quiet",
        source.url,
    ]
    logger.debug("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error("yt-dlp failed for %s: %s", output_path.name, result.stderr.strip())
        return False
    return True


def download_many(
    jobs: list[tuple[StreamSource, Path]],
    concurrency: int = 20,
) -> dict[str, bool]:
    """Download multiple streams concurrently. Returns filename -> success map."""
    results: dict[str, bool] = {}

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        future_to_name = {
            pool.submit(download, source, path): path.name
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
