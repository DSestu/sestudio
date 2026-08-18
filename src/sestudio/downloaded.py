"""What is actually on disk under the download root.

Downloads are written to a fixed shape by ``_episode_path`` in
:mod:`sestudio.web.routes.downloads`::

    <root>/<Series>/Season NN/<LANG>/S01E02 - Title.mp4   # episodes
    <root>/<films dirname>/<LANG>/Title.mp4               # films

but that is only the shape *this* tool writes. A collection older than the tool
sits wherever its owner put it — loose in the root, or under an arrangement of
their own — so the whole tree is walked and every file is read for what its own
path says about it.

What the path cannot say — the real (unsanitised) series name, the poster, the
site it came from — is recorded separately at download time; see
``library.downloaded_files``. Anything the tool did not download has no such
record, so the path is the whole of what is known about it.
"""

from __future__ import annotations

import glob
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

# A file stored outside any language folder — hand-placed, or fetched before the
# app sorted them — still has to be playable. It gets its own language rather
# than none: the watch view pairs an episode with a file by language, so a file
# with no language could never be matched, and its row stayed unclickable.
UNKNOWN_LANG = "other"

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
    #: Lower-cased folder name, or ``UNKNOWN_LANG`` for a file stored without
    #: one. Never empty, so every file can be matched by language.
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

    lang = UNKNOWN_LANG
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


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)")
_durations: dict[tuple[str, int, float], float | None] = {}

# `  Stream #0:1[0x2](fra): Audio: aac (LC) (mp4a / …), 44100 Hz, stereo, …`
# The language is in brackets when the muxer recorded one; `und` (or nothing) is
# what a file assembled by a downloader usually carries.
_STREAM_RE = re.compile(
    r"^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\((?P<lang>[^)]*)\))?: "
    r"(?P<kind>Audio|Subtitle): (?P<codec>[A-Za-z0-9_]+)"
)
# `      title           : VF` inside a stream's own Metadata block. This is what
# a human named the track, and it beats "Track 2" whenever it is there.
_TITLE_RE = re.compile(r"^\s+title\s*:\s*(.+?)\s*$")

# Subtitles a browser can be given as text. Everything else in this list's place
# — PGS and VOBSUB — is a picture of a subtitle, and converting one to WebVTT is
# not a conversion but an OCR job, so those are reported and not offered.
_TEXT_SUBTITLE_CODECS = frozenset(
    {
        "subrip",
        "srt",
        "ass",
        "ssa",
        "mov_text",
        "webvtt",
        "text",
        "eia_608",
        "subviewer",
    }
)

_tracks: dict[tuple[str, int, float], "MediaTracks"] = {}


@dataclass
class Track:
    """One audio or subtitle stream inside a file."""

    #: Index among streams of this kind — what ffmpeg's `-map 0:a:N` wants, and
    #: not the absolute stream number, which counts video too.
    index: int
    codec: str
    #: ISO-ish language as the container spells it, '' when it records none.
    lang: str
    #: The track's own name, when it has one.
    title: str
    default: bool
    #: Subtitles only: whether this can be served as WebVTT at all.
    text: bool = True

    @property
    def label(self) -> str:
        """What to show in a track menu.

        The title if the file names one, else the language, else the position —
        a menu of "Track 1 / Track 2" is poor but still better than blank rows.
        """
        return self.title or self.lang.upper() or f"Track {self.index + 1}"


@dataclass
class MediaTracks:
    audio: list[Track]
    subtitles: list[Track]


def _parse_streams(text: str) -> MediaTracks:
    """Read ffmpeg's own report of a file into its audio and subtitle tracks.

    Parsed from the human-readable output rather than ffprobe's JSON for the
    reason ``duration_of`` gives: there is no ffprobe beside the bundled ffmpeg.
    Titles arrive *after* the stream line they belong to, so the current track is
    held open until the next stream (or the end) closes it.
    """
    audio: list[Track] = []
    subtitles: list[Track] = []
    current: Track | None = None

    for line in text.splitlines():
        match = _STREAM_RE.match(line)
        if match:
            kind = match.group("kind")
            lang = (match.group("lang") or "").strip()
            codec = match.group("codec").lower()
            bucket = audio if kind == "Audio" else subtitles
            current = Track(
                index=len(bucket),
                codec=codec,
                # `und` is the muxer's way of saying it does not know, which is
                # not a language and should not be offered as one.
                lang="" if lang.lower() in ("", "und") else lang,
                title="",
                default="(default)" in line,
                text=kind == "Audio" or codec in _TEXT_SUBTITLE_CODECS,
            )
            bucket.append(current)
            continue
        if current is not None:
            title = _TITLE_RE.match(line)
            if title:
                current.title = title.group(1)
                current = None  # one title per stream; don't take the next one's

    return MediaTracks(audio=audio, subtitles=subtitles)


def tracks_of(file: Path) -> MediaTracks:
    """The audio and subtitle tracks inside *file*.

    Cached on the file's identity like ``duration_of``, because the answer only
    changes when the file does, and a probe costs a process.
    """
    try:
        stat = file.stat()
    except OSError:
        return MediaTracks(audio=[], subtitles=[])
    key = (str(file), stat.st_size, stat.st_mtime)
    if key in _tracks:
        return _tracks[key]

    found = MediaTracks(audio=[], subtitles=[])
    try:
        binary = ffmpeg_binary()
        result = subprocess.run(
            [binary, "-nostdin", "-hide_banner", "-i", str(file)],
            timeout=30,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        found = _parse_streams(result.stderr.decode("utf-8", "replace"))
    except (RuntimeError, OSError, subprocess.SubprocessError):
        pass  # no ffmpeg, or an unreadable file: no tracks to offer

    _tracks[key] = found
    return found


def sidecar_subtitles(file: Path) -> list[tuple[str, Path]]:
    """`(language, path)` for the `.vtt` files sitting beside *file*.

    ``download_subtitles`` and yt-dlp's ``--write-subs`` both write
    ``<stem>.<lang>.vtt`` here, so the language is read back off the name. These
    are why the scan can ignore subtitle files and still find them: they are
    found from the video they belong to, not by walking for them.
    """
    found: list[tuple[str, Path]] = []
    for candidate in sorted(file.parent.glob(f"{glob.escape(file.stem)}.*.vtt")):
        # `<stem>.<lang>.vtt` — whatever sits between the stem and the suffix.
        middle = candidate.name[len(file.stem) + 1 : -len(".vtt")]
        if middle:
            found.append((middle, candidate))
    return found


def _subtitle_dir() -> Path:
    return config_dir() / "subs"


def _audio_dir() -> Path:
    return config_dir() / "audio"


# Audio a browser and a TV will both take as-is inside an mp4. Anything else —
# AC-3, E-AC-3, DTS, TrueHD, and the FLAC an anime release often carries — is
# re-encoded to AAC. Chrome plays none of those (I checked: `canPlayType` for
# ac-3 and ec-3 both answer ""), so copying them through would produce a file
# that plays picture and no sound, which is worse than waiting for an encode.
_BROWSER_SAFE_AUDIO = frozenset({"aac", "mp3"})


def alternate_audio(file: Path, relative: str, index: int) -> Path | None:
    """*file* rebuilt with audio track *index* as its only audio, cached on disk.

    This is the whole of "switch audio track" in a browser. No browser implements
    `HTMLMediaElement.audioTracks`, so the track cannot be chosen client-side; the
    server has to hand over a file that already carries the wanted one. Jellyfin
    does the same thing, and for the same reason.

    The video is always copied, never re-encoded, so this costs about a second
    for a whole episode. The audio is copied too unless its codec would not play
    (see ``_BROWSER_SAFE_AUDIO``), which is the only case that spends real time.

    Cached under the file's identity and the track index, so switching back and
    forth pays once. Returns None when there is no such track, and for the
    default track — that one is the original file, and a copy of it would be
    pure waste.
    """
    tracks = tracks_of(file)
    if index <= 0 or index >= len(tracks.audio):
        return None
    try:
        stat = file.stat()
    except OSError:
        return None

    codec = tracks.audio[index].codec
    key = hashlib.sha1(
        f"{relative}|{int(stat.st_mtime)}|{stat.st_size}|a{index}|{codec}".encode()
    ).hexdigest()
    out = _audio_dir() / f"{key}.mp4"
    if out.is_file() and out.stat().st_size > 0:
        return out

    try:
        binary = ffmpeg_binary()
    except RuntimeError:
        return None
    out.parent.mkdir(parents=True, exist_ok=True)

    audio_args = (
        ["-c:a", "copy"]
        if codec in _BROWSER_SAFE_AUDIO
        else ["-c:a", "aac", "-b:a", "192k"]
    )
    tmp = out.with_name(f"{key}.{os.getpid()}.{threading.get_ident()}.tmp.mp4")
    try:
        result = subprocess.run(
            [
                binary,
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(file),
                "-map",
                "0:v:0",
                "-map",
                f"0:a:{index}",
                "-c:v",
                "copy",
                *audio_args,
                # Index at the front: this file is served with byte ranges and
                # cast to renderers, both of which need to seek without first
                # fetching the tail.
                "-movflags",
                "+faststart",
                str(tmp),
            ],
            # Generous: a copy takes a second, but re-encoding the audio of a
            # long film is minutes, and dying half way would leave the track
            # permanently unavailable.
            timeout=1800,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0 and tmp.is_file() and tmp.stat().st_size > 0:
            os.replace(tmp, out)
            return out
        return None
    except (OSError, subprocess.SubprocessError):
        return None
    finally:
        tmp.unlink(missing_ok=True)


def extracted_subtitle(file: Path, relative: str, index: int) -> Path | None:
    """A subtitle track lifted out of *file* as WebVTT, cached on disk.

    Needed because no browser exposes the subtitle tracks inside a container:
    they have to become the sidecar files a `<track>` element can load. Cached
    under the file's identity and the track index, exactly as ``thumbnail`` is,
    so this costs one ffmpeg run per track, once.

    Returns None when the track cannot be text — a PGS or VOBSUB track is an
    image and only burning it into the video would show it.
    """
    tracks = tracks_of(file)
    if index >= len(tracks.subtitles) or not tracks.subtitles[index].text:
        return None
    try:
        stat = file.stat()
    except OSError:
        return None

    key = hashlib.sha1(
        f"{relative}|{int(stat.st_mtime)}|{stat.st_size}|{index}".encode()
    ).hexdigest()
    out = _subtitle_dir() / f"{key}.vtt"
    if out.is_file() and out.stat().st_size > 0:
        return out

    try:
        binary = ffmpeg_binary()
    except RuntimeError:
        return None
    out.parent.mkdir(parents=True, exist_ok=True)

    # Written aside and moved into place, so two players asking for the same
    # track at once waste work at worst and never read a half-written file.
    tmp = out.with_name(f"{key}.{os.getpid()}.{threading.get_ident()}.tmp.vtt")
    try:
        result = subprocess.run(
            [
                binary,
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(file),
                "-map",
                f"0:s:{index}",
                "-f",
                "webvtt",
                str(tmp),
            ],
            timeout=120,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0 and tmp.is_file() and tmp.stat().st_size > 0:
            os.replace(tmp, out)
            return out
        return None
    except (OSError, subprocess.SubprocessError):
        return None
    finally:
        tmp.unlink(missing_ok=True)


def duration_of(file: Path) -> float | None:
    """Length in seconds, or None when it cannot be determined.

    Read from ffmpeg's own report rather than ffprobe: there is no ffprobe
    alongside the bundled ffmpeg, and asking ffmpeg to describe a file it will
    not convert costs a fraction of a second.

    Needed for DLNA: a renderer will only offer "jump to a timestamp" for media
    the server says it can seek by time, and time cannot be turned into a byte
    offset without knowing how long the file runs.
    """
    try:
        stat = file.stat()
    except OSError:
        return None
    key = (str(file), stat.st_size, stat.st_mtime)
    if key in _durations:
        return _durations[key]

    seconds: float | None = None
    try:
        binary = ffmpeg_binary()
        # No output file: ffmpeg describes the input, complains, and exits.
        result = subprocess.run(
            [binary, "-nostdin", "-hide_banner", "-i", str(file)],
            timeout=30,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        match = _DURATION_RE.search(result.stderr.decode("utf-8", "replace"))
        if match:
            hours, minutes, rest = match.groups()
            seconds = int(hours) * 3600 + int(minutes) * 60 + float(rest)
    except (RuntimeError, OSError, subprocess.SubprocessError):
        seconds = None

    _durations[key] = seconds
    return seconds


def content_features(time_seekable: bool) -> str:
    """The ``contentFeatures.dlna.org`` value for a stored file.

    ``DLNA.ORG_OP`` is two flags: time-seek then byte-seek. Byte-seek is always
    true here — the file is served with Range support. Time-seek is claimed only
    when the duration is known, because claiming it without being able to answer
    a ``TimeSeekRange`` request is what makes a renderer sit there doing nothing.

    Advertising this at all is the point: told nothing, a renderer decides for
    itself whether the media can be seeked, and for anything it cannot index —
    an mp4 with its moov at the end, a container it half-knows — it decides no,
    and the TV reports the action as unavailable.
    """
    op = "11" if time_seekable else "01"
    # Streaming transfer mode, plus the usual background-transfer and
    # connection-stall flags every DLNA server sends.
    return f"DLNA.ORG_OP={op};DLNA.ORG_FLAGS=01700000000000000000000000000000"


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
