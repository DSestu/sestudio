"""A folder browser for picking a music library: directories only, never file contents."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from sestudio import downloaded
from sestudio.config import load_config
from sestudio.music import libraries

#: The audio count of a folder stops at this many entries looked at: a hint, not a crawl.
SCAN_CAP = 500
_HIDDEN, _SYSTEM = 2, 4  # Windows file attributes


class Unreadable(ValueError):
    pass


def _skipped(entry: os.DirEntry[str]) -> bool:
    if entry.name.startswith((".", "$")) or entry.name == "lost+found":
        return True
    try:
        attrs = getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0)
    except OSError:
        return False
    return bool(attrs & (_HIDDEN | _SYSTEM))


def _is_dir(entry: os.DirEntry[str]) -> bool:
    try:
        return entry.is_dir()
    except OSError:
        return False


def _subdirs(path: str) -> list[os.DirEntry[str]]:
    with os.scandir(path) as it:
        return [e for e in it if _is_dir(e) and not _skipped(e)]


def _audio(path: str) -> tuple[int, bool]:
    """(audio files under *path*, whether the scan stopped at the cap)."""
    seen = count = 0
    stack = [path]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    seen += 1
                    if seen > SCAN_CAP:
                        return count, True
                    if _is_dir(e):
                        if not _skipped(e):
                            stack.append(e.path)
                    elif Path(e.name).suffix.lower() in downloaded._AUDIO_SUFFIXES:
                        count += 1
        except OSError:
            continue
    return count, False


def browse(path: str) -> dict[str, Any]:
    """The subfolders of *path* with their audio counts, and how to get back up."""
    folder = Path(path).expanduser()
    if not folder.is_absolute() or not folder.is_dir():
        raise Unreadable("That folder does not exist on this machine")
    parent = folder.parent
    chain = reversed([folder, *folder.parents])
    out: dict[str, Any] = {
        "path": str(folder),
        "parent": "" if parent == folder else str(parent),
        "crumbs": [{"name": p.name or str(p), "path": str(p)} for p in chain],
        "readable": True,
        "folders": [],
    }
    try:
        subs = _subdirs(str(folder))
    except OSError:
        out["readable"] = False
        return out
    for e in sorted(subs, key=lambda e: e.name.lower()):
        row: dict[str, Any] = {"name": e.name, "path": e.path, "readable": True}
        try:
            row["has_children"] = bool(_subdirs(e.path))
        except OSError:
            row |= {"readable": False, "has_children": False}
        row["audio"], row["capped"] = _audio(e.path) if row["readable"] else (0, False)
        out["folders"].append(row)
    return out


def roots() -> list[dict[str, str]]:
    """Starting points: the Android app's storage, Music, downloads, home, drives."""
    found = [(x["label"], x["path"]) for x in libraries.android_storage()["roots"]]
    home = Path.home()
    found += [
        ("Music", str(home / "Music")),
        ("Downloads", load_config().output_root),
        ("Home", str(home)),
    ]
    if sys.platform == "win32":
        found += [(f"{c}:", f"{c}:\\") for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    else:
        found.append(("Root", "/"))
        user = os.environ.get("USER") or "-"
        for base in (Path("/mnt"), Path("/media"), Path("/media") / user):
            try:
                found += [
                    (d.name, str(d)) for d in sorted(base.iterdir()) if d.is_dir()
                ]
            except OSError:
                pass
    seen: set[str] = set()
    out = []
    for label, p in found:
        if p not in seen and Path(p).is_dir():
            seen.add(p)
            out.append({"label": label, "path": p})
    return out
