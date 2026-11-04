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
from typing import Any

from sestudio import downloaded
from sestudio.music import analysis, genres, libraries, store

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


def status() -> dict[str, Any]:
    with _lock:
        out: dict[str, Any] = {"done": _done, "total": _total, "running": _running}
    return out | genres.status()


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


def reanalyse(library_id: str | None, root: str | Path) -> int:
    """Analyse every file of one library of files on this machine (all of them with
    None) again, in the background; returns how many files that is."""
    ids = [
        f.track_id
        for lib, folder in libraries.folder_roots()
        if library_id in (None, lib) and folder.is_dir()
        for f in downloaded.audio_files(folder, lib)
    ]
    with _lock:
        for i in ids:
            _failed.pop(i, None)
    store.forget(ids)
    kick(root)
    return len(ids)


def _loop(root: str) -> None:
    global _running, _again
    try:
        while True:
            run_once(root)
            for library, folder in libraries.folder_roots()[1:]:
                run_once(folder, library=library)
            with _lock:
                if not _again:
                    _running = False
                    return
                _again = False
    except Exception:
        logger.exception("Music analysis stopped")
        with _lock:
            _running = False


def _upgrade_v2(base: Path, files: list, workers: int) -> int:
    """Profile (key, genre, energy, structure) tracks analysed before v2, from their stored row."""
    old = set(store.pending_v2())
    todo = [f for f in files if f.track_id in old]

    def one(f) -> None:
        raw = store.load_raw(f.track_id)
        if raw is not None:
            store.set_extra(f.track_id, analysis.upgrade(str(base / f.path), raw))

    n = 0
    with ThreadPoolExecutor(workers, thread_name_prefix="profile") as ex:
        for future in as_completed([ex.submit(one, f) for f in todo]):
            try:
                future.result()
                n += 1
            except Exception:
                logger.warning("Could not profile a track", exc_info=True)
    return n


def _decide_genres(base: Path, files: list, workers: int) -> None:
    """Pick each track's genre: its file tag, else the model, else the rules (SPEC-music §9)."""
    todo = store.pending_genre(genres.model_enabled())
    mine = [f for f in files if f.track_id in todo]

    def one(f) -> None:
        extra, duration = todo[f.track_id]
        path = base / f.path
        tag = genres.normalise(downloaded.audio_genre(path))
        new = genres.decide(extra, str(path), duration, tag)
        if new != extra:
            store.set_extra(f.track_id, new)

    with ThreadPoolExecutor(min(workers, 2), thread_name_prefix="genre") as ex:
        for future in as_completed([ex.submit(one, f) for f in mine]):
            try:
                future.result()
            except Exception:
                logger.warning("Could not decide a genre", exc_info=True)


def run_once(
    root: str | Path,
    workers: int | None = None,
    library: str = downloaded.LOCAL_LIBRARY,
) -> int:
    """Analyse every pending audio file under *root*; returns how many succeeded."""
    global _total, _done
    base = Path(root)
    files = downloaded.audio_files(base, library)
    known = store.stamps()
    pending = [
        f for f in files
        if known.get(f.track_id) != (f.mtime, f.size)
        and _failed.get(f.track_id) != (f.mtime, f.size)
    ]  # fmt: skip
    with _lock:
        _total, _done = len(files), len(files) - len(pending)
    workers = workers or max(1, min(4, (os.cpu_count() or 2) // 2))
    ok = _upgrade_v2(base, files, workers)
    if not pending:
        _decide_genres(base, files, workers)
        return ok
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
    _decide_genres(base, files, workers)
    return ok
