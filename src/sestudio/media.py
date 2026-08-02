from __future__ import annotations

import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)


def ffmpeg_binary() -> str:
    """Absolute path to an ffmpeg executable (system first, else bundled).

    Unlike :func:`ffmpeg_location` (a directory for yt-dlp's flag), this is the
    executable itself, for running ffmpeg directly — e.g. remuxing an HLS
    stream to MP4 on the fly.
    """
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
    except ImportError as exc:  # pragma: no cover — packaging guarantees it
        raise RuntimeError("No ffmpeg available (system or bundled)") from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def ffmpeg_location() -> str | None:
    """Directory to pass to yt-dlp's ``--ffmpeg-location``, or None.

    Prefer a system ffmpeg when one is on PATH: yt-dlp then also finds a real
    ffprobe and a fuller codec set, and we add no flag (returns None). Otherwise
    fall back to the static ffmpeg bundled by imageio-ffmpeg so `uvx sestudio`
    works with no manually installed ffmpeg. ffprobe is not required for the
    HLS->mp4 download path.
    """
    if shutil.which("ffmpeg"):
        return None
    try:
        import imageio_ffmpeg
    except ImportError:
        logger.warning("No system ffmpeg on PATH and imageio-ffmpeg is not installed")
        return None
    return str(Path(imageio_ffmpeg.get_ffmpeg_exe()).parent)
