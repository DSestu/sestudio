"""What is actually on disk under the download root.

Downloads are written to a fixed shape by ``_episode_path`` in
:mod:`sestudio.web.routes.downloads`::

    <root>/<Series>/Season NN/<LANG>/S01E02 - Title.mp4   # episodes
    <root>/<films dirname>/<LANG>/Title.mp4               # films

so the tree itself is the index, and this module reads it back. What the path
cannot say — the real (unsanitised) series name, the poster, the site it came
from — is recorded separately at download time; see ``library.downloaded_files``.

The scan is deliberately shallow: only the two shapes above are recognised, so a
user's own folders under the same root are ignored rather than half-understood.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from sestudio.config import config_dir
from sestudio.media import ffmpeg_binary

# `S01E02`, the prefix written by `Episode.filename` — matched anywhere in the
# name, since a file from elsewhere usually carries the show's name in front of
# it. `1x02` is the other common spelling.
_EPISODE_RES = (
    re.compile(r"S(\d{1,3})[\s._-]*E(\d{1,3})", re.IGNORECASE),
    re.compile(r"(?<!\d)(\d{1,2})x(\d{1,2})(?!\d)", re.IGNORECASE),
)
# `Season 01`, and the `S01` a hand-made library tends to use instead.
_SEASON_RE = re.compile(r"^(?:Season|Saison|S)\s*(\d{1,3})$", re.IGNORECASE)

# Version folders, as `_episode_path` writes them.
_LANG_DIRS = frozenset({"vf", "vostfr", "vo", "vf-vostfr", "vfq", "vosta"})

# What counts as something to play. Everything else in the tree — artwork,
# subtitles, notes — is not the library's business.
_VIDEO_SUFFIXES = frozenset(
    {
        ".mp4",
        ".m4v",
        ".mkv",
        ".avi",
        ".mov",
        ".webm",
        ".ts",
        ".m2ts",
        ".wmv",
        ".flv",
        ".mpg",
        ".mpeg",
        ".ogv",
    }
)

_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".ts": "video/mp2t",
    ".m2ts": "video/mp2t",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
    ".mpg": "video/mpeg",
    ".mpeg": "video/mpeg",
}

# Deep enough for any sane arrangement, shallow enough that a stray mount or a
# link loop cannot turn a listing into a filesystem crawl.
_MAX_DEPTH = 6

# When loose files in one folder count as a single numbered show. Three files is
# enough to establish a pattern; a prefix shorter than four characters is more
# likely a coincidence than a title; and a run tolerates a few oddly-named
# strays (a special, an extra) without breaking apart.
_RUN_MIN_FILES = 3
_RUN_MIN_PREFIX = 4
_RUN_MIN_NUMERIC = 0.8

# The tree changes only when a download finishes, and the views refetch on focus,
# so a short cache is enough to keep repeated listings off the filesystem.
_CACHE_TTL = 10.0

_lock = threading.Lock()
_cache: dict[str, tuple[float, list["DownloadedFile"]]] = {}


@dataclass
class DownloadedFile:
    """One playable file, described by where it sits."""

    #: Path relative to the download root, POSIX separators. The id everywhere.
    path: str
    #: Folder name — sanitised, so not necessarily the title as the site spells it.
    series: str
    #: 0 for a film.
    season: int
    #: 0 when the name carries no SxxEyy prefix (films, and renamed files).
    number: int
    title: str
    #: Lower-cased folder name, or '' for a file stored without a language.
    lang: str
    #: Directory that names the title, relative to the root — season and
    #: language folders stripped. '' for a file loose in the root. The client
    #: cannot work this out from `path`, because only the scan knows which
    #: parts of it were consumed.
    folder: str
    size: int
    mtime: float

    @property
    def is_film(self) -> bool:
        return self.season == 0


def media_type_for(file: Path | str) -> str:
    """Content type for a stored file, by extension.

    Only mp4 and webm play in a browser; the rest are listed and served all the
    same, because a renderer on the network may well handle what a browser will
    not, and hiding a file you own would be worse than failing to play it.
    """
    return _MEDIA_TYPES.get(Path(file).suffix.lower(), "application/octet-stream")


def _walk(root: Path) -> Iterator[Path]:
    """Every video file under *root*, at any depth.

    A media folder is arranged however its owner arranged it: ours writes
    ``<Series>/Season NN/<LANG>/``, but a collection that predates this tool sits
    wherever it was put — often loose in the root. So the whole tree is walked
    and each file is read for what it says about itself, rather than only the
    shape this tool happens to write.
    """
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
                    # Depth-capped, and symlinked directories are not followed:
                    # a media root can be a network mount, and a link loop there
                    # would hang the scan.
                    if depth < _MAX_DEPTH and not entry.is_symlink():
                        stack.append((entry, depth + 1))
                elif (
                    entry.suffix.lower() in _VIDEO_SUFFIXES and entry.stat().st_size > 0
                ):
                    yield entry
            except OSError:
                continue


def _episode_of(stem: str) -> tuple[int, int, str] | None:
    """(season, number, title) read out of a filename, or None if it names no
    episode. The title is whatever follows the marker, which for our own files
    is the episode title and for a scene release is usually junk — either way it
    beats showing the raw filename."""
    for pattern in _EPISODE_RES:
        match = pattern.search(stem)
        if not match:
            continue
        rest = stem[match.end() :].strip(" -_.\u2013\u2014")
        return int(match.group(1)), int(match.group(2)), rest
    return None


def _describe(file: Path, root: Path) -> DownloadedFile:
    """Read a file's own path for what it says about itself.

    The directories above it are consumed from the bottom up — a version folder,
    then a season folder — and whatever remains directly above names the show. A
    film is named by the file instead: it may sit loose in the root, or inside a
    folder holding a hundred others, and neither names it.
    """
    rel = file.relative_to(root)
    dirs = list(rel.parts[:-1])
    stem = file.stem

    lang = ""
    if dirs and dirs[-1].lower() in _LANG_DIRS:
        lang = dirs.pop().lower()

    season = 0
    if dirs:
        match = _SEASON_RE.match(dirs[-1])
        if match:
            season = int(match.group(1))
            dirs.pop()

    number = 0
    title = stem
    episode = _episode_of(stem)
    if episode is not None:
        from_name, number, rest = episode
        # The folder wins when it gave one: `Season 02` is deliberate, whereas a
        # filename's `S01` is often left over from wherever the file came from.
        season = season or from_name
        title = rest or stem

    # An episode belongs to the folder above it; anything else stands alone.
    series = dirs[-1] if (season and dirs) else stem

    stat = file.stat()
    return DownloadedFile(
        path=rel.as_posix(),
        series=series,
        season=season,
        number=number,
        title=title,
        lang=lang,
        folder="/".join(dirs),
        size=stat.st_size,
        mtime=stat.st_mtime,
    )


def _common_prefix(values: list[str]) -> str:
    first, last = min(values), max(values)
    for i, ch in enumerate(first):
        if i >= len(last) or last[i] != ch:
            return first[:i]
    return first


def _numbered_run(stems: list[str]) -> str | None:
    """The shared prefix when these names differ only by a number, else None.

    This is what tells `One Piece/` (one show, a thousand files named alike)
    from `Movies/` (a thousand films named differently). Requiring the *whole*
    difference to be numeric is what keeps a trilogy apart: "The Matrix" and
    "The Matrix Reloaded" share a long prefix, but the remainder is a word.
    """
    if len(stems) < _RUN_MIN_FILES:
        return None
    lowered = [s.lower() for s in stems]
    prefix = _common_prefix(lowered)
    if len(prefix.strip(" -_.")) < _RUN_MIN_PREFIX:
        return None
    numeric = 0
    for stem in lowered:
        rest = re.sub(r"[^0-9a-z]+", "", stem[len(prefix) :])
        # Empty counts: one file may be exactly the prefix, the rest numbered.
        if not rest or rest.isdigit():
            numeric += 1
    return prefix if numeric >= len(stems) * _RUN_MIN_NUMERIC else None


def _trailing_number(stem: str, prefix: str, fallback: int) -> int:
    """The number that distinguishes this file within its run."""
    digits = re.findall(r"\d+", stem[len(prefix) :] or stem)
    return int(digits[-1]) if digits else fallback


def _regroup_run(films: list[DownloadedFile], folder: str) -> None:
    """Rewrite a numbered run of loose files as one series, named by its folder.

    Left alone they are a thousand separate "films", each named after a file and
    each asking TMDB about a name it has never heard of. Named by the folder
    they are one title, and the lookup is one TMDB actually answers.
    """
    prefix = _numbered_run([f.title for f in films])
    if prefix is None:
        return
    for index, film in enumerate(films, start=1):
        film.series = folder
        # Season 1 is a claim, but a modest one: the point is that these belong
        # together, and one flat folder gives nothing better to say.
        film.season = 1
        film.number = _trailing_number(film.title.lower(), prefix, index)


def _scan_uncached(root: Path) -> list[DownloadedFile]:
    if not root.is_dir():
        return []

    # Grouped by folder, because whether a loose file is a film or one episode
    # of something cannot be told from the file alone — only from what sits
    # beside it.
    by_folder: dict[Path, list[Path]] = {}
    for file in _walk(root):
        by_folder.setdefault(file.parent, []).append(file)

    found: list[DownloadedFile] = []
    for folder, files in by_folder.items():
        described = [_describe(file, root) for file in files]
        # Only files that came out as standalone films are candidates: anything
        # already carrying SxxEyy, or sitting under `Season NN`, has said what
        # it is. Files loose in the root have no folder to be named after.
        if folder != root:
            films = [d for d in described if d.season == 0]
            if len(films) == len(described):
                _regroup_run(films, folder.name)
        found.extend(described)
    return found


def scan(root: str | Path) -> list[DownloadedFile]:
    """Every video file under *root*. Cached briefly; see ``_CACHE_TTL``."""
    base = Path(root)
    key = str(base)
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1]
    files = _scan_uncached(base)
    with _lock:
        _cache[key] = (now, files)
    return files


def invalidate() -> None:
    """Drop the cache, so the next scan sees a just-written or deleted file."""
    with _lock:
        _cache.clear()


def _thumb_dir() -> Path:
    return config_dir() / "thumbs"


def thumbnail(file: Path, relative: str) -> Path | None:
    """A cached still from *file*, or None when one cannot be made.

    Most of a personal collection is not on TMDB — a rip with an odd name, a
    title that never had an English release — and a wall of blank posters is a
    poor shelf. A frame from the file itself is always available and always
    right, so it stands in wherever a real poster is missing.

    Cached under the file's path, size and mtime, so replacing a file makes a
    new still and nothing has to be invalidated by hand.
    """
    try:
        stat = file.stat()
    except OSError:
        return None
    key = hashlib.sha1(
        f"{relative}|{int(stat.st_mtime)}|{stat.st_size}".encode()
    ).hexdigest()
    out = _thumb_dir() / f"{key}.jpg"
    if out.is_file() and out.stat().st_size > 0:
        return out

    try:
        binary = ffmpeg_binary()
    except RuntimeError:
        return None  # no ffmpeg — the shelf falls back to a blank poster
    out.parent.mkdir(parents=True, exist_ok=True)

    # Two minutes in avoids studio logos and black cold-opens; a short file has
    # nothing there, so a five-second seek is tried before giving up.
    for offset in ("120", "5"):
        # Written aside and moved into place: several cards asking for the same
        # still at once should waste work at worst, never serve a torn file.
        # Keeps the .jpg on the end: ffmpeg picks its encoder from the output
        # extension, and a bare .tmp leaves it with nothing to choose.
        tmp = out.with_name(f"{key}.{os.getpid()}.{threading.get_ident()}.tmp.jpg")
        command = [
            binary,
            "-nostdin",
            "-loglevel",
            "error",
            # Before -i, so the seek is by keyframe and costs the same on a 40GB
            # file as on a small one.
            "-ss",
            offset,
            "-i",
            str(file),
            "-frames:v",
            "1",
            "-vf",
            "scale=400:-2",
            "-q:v",
            "5",
            "-y",
            str(tmp),
        ]
        try:
            subprocess.run(
                command,
                timeout=30,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if tmp.is_file() and tmp.stat().st_size > 0:
                os.replace(tmp, out)
                return out
        except (OSError, subprocess.SubprocessError):
            return None
        finally:
            tmp.unlink(missing_ok=True)
    return None


def resolve(root: str | Path, relative: str) -> Path:
    """Absolute path for a client-supplied relative path, confined to *root*.

    Raises ``ValueError`` for anything that escapes — this is the only place a
    caller-controlled filesystem path is turned into a real one, so the check
    lives here rather than in each route.
    """
    base = Path(root).resolve()
    target = (base / relative).resolve()
    if not target.is_relative_to(base):
        raise ValueError("path escapes the download root")
    return target
