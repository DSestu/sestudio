"""The background job that analyses new and changed audio files.

One thread works through the library's audio files a few at a time and exits
when nothing is left; ``kick`` starts it again, so it is cheap to call whenever
a listing happens. Requests never wait on it.
"""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from sestudio import downloaded
from sestudio.music import analysis, store

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_running = False
_again = False
_total = 0
_done = 0
#: Files that failed to analyse, so a bad file is not retried on every kick.
_failed: dict[str, tuple[float, int]] = {}


def enabled() -> bool:
    value = os.environ.get("SESTUDIO_MUSIC_ANALYSIS", "1").strip().casefold()
    return value not in ("0", "false", "no", "off")


def status() -> dict[str, int | bool]:
    with _lock:
        return {"done": _done, "total": _total, "running": _running}


def kick(root: str | Path) -> None:
    """Analyse whatever under *root* lacks an up-to-date analysis, in the background."""
    global _running, _again
    if not enabled():
        return
    with _lock:
        if _running:
            _again = True
            return
        _running = True
    threading.Thread(
        target=_loop, args=(str(root),), daemon=True, name="music-analysis"
    ).start()


def _loop(root: str) -> None:
    global _running, _again
    try:
        while True:
            run_once(root)
            with _lock:
                if not _again:
                    _running = False
                    return
                _again = False
    except Exception:
        logger.exception("Music analysis stopped")
        with _lock:
            _running = False


def run_once(root: str | Path, workers: int | None = None) -> int:
    """Analyse every pending audio file under *root*; returns how many succeeded."""
    global _total, _done
    base = Path(root)
    files = [f for f in downloaded.scan(base) if f.kind == "audio"]
    known = store.stamps()
    pending = [
        f for f in files
        if known.get(f.track_id) != (f.mtime, f.size)
        and _failed.get(f.track_id) != (f.mtime, f.size)
    ]  # fmt: skip
    with _lock:
        _total, _done = len(files), len(files) - len(pending)
    if not pending:
        return 0
    workers = workers or max(1, min(4, (os.cpu_count() or 2) // 2))
    ok = 0
    with ThreadPoolExecutor(workers, thread_name_prefix="analyse") as ex:
        futures = {
            ex.submit(analysis.analyse_file, str(base / f.path)): f for f in pending
        }
        for future in as_completed(futures):
            f = futures[future]
            try:
                store.save(f.track_id, f.mtime, f.size, future.result())
                ok += 1
            except Exception:
                logger.warning("Could not analyse %s", f.path, exc_info=True)
                _failed[f.track_id] = (f.mtime, f.size)
            with _lock:
                _done += 1
    store.renormalise_if_needed()
    return ok
