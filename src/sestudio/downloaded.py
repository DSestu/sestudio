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

import functools
import glob
import contextlib
import hashlib
import io
import os
import re
import subprocess
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from sestudio.config import config_dir, load_config
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
# The video stream, for deciding whether a browser can play the file at all.
# Its codec is followed by any number of parenthesised notes — `(High)`,
# `(avc1 / 0x31637661)` — and then the pixel format, which matters as much as
# the codec: Chrome plays 8-bit H.264 and not the 10-bit High 10 profile an
# anime release often carries, and both report `h264`.
_VIDEO_STREAM_RE = re.compile(
    r"^\s*Stream #0:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: (?P<codec>[A-Za-z0-9_]+)"
    r"(?:\s*\([^)]*\))*,\s*(?P<pix_fmt>[a-z0-9]+)"
)
# `, 1920x1080` on that same line. Searched for rather than matched in place:
# the pixel format's own notes, `(tv, bt709, progressive)`, sit in between.
_FRAME_SIZE_RE = re.compile(r",\s*(\d{2,5})x(\d{2,5})\b")
# `, 23.98 fps` — the stream's frame rate, there when ffmpeg knows it.
_FPS_RE = re.compile(r",\s*(\d+(?:\.\d+)?)\s*fps\b")

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
    #: Codec of the first video stream, '' when the file has none.
    video: str = ""
    #: Its pixel format, e.g. `yuv420p` or `yuv420p10le`. See `_VIDEO_STREAM_RE`.
    video_pix_fmt: str = ""
    #: PQ or HLG transfer: shown on an SDR picture without tone-mapping, washed out.
    video_hdr: bool = False
    #: Frame size of the first video stream, 0 when unknown.
    video_width: int = 0
    video_height: int = 0
    #: Its frame rate, 0 when unknown.
    video_fps: float = 0.0


def _parse_streams(text: str) -> MediaTracks:
    """Read ffmpeg's own report of a file into its audio and subtitle tracks.

    Parsed from the human-readable output rather than ffprobe's JSON for the
    reason ``duration_of`` gives: there is no ffprobe beside the bundled ffmpeg.
    Titles arrive *after* the stream line they belong to, so the current track is
    held open until the next stream (or the end) closes it.
    """
    audio: list[Track] = []
    subtitles: list[Track] = []
    video = pix_fmt = ""
    hdr = False
    width = height = 0
    fps = 0.0
    current: Track | None = None

    for line in text.splitlines():
        if not video and (found := _VIDEO_STREAM_RE.match(line)):
            video, pix_fmt = found.group("codec").lower(), found.group("pix_fmt")
            # `yuv420p10le(tv, bt2020nc/bt2020/smpte2084)` — the transfer is last.
            hdr = "smpte2084" in line or "arib-std-b67" in line
            if size := _FRAME_SIZE_RE.search(line):
                width, height = int(size.group(1)), int(size.group(2))
            if rate := _FPS_RE.search(line):
                fps = float(rate.group(1))
            current = None  # a title after it belongs to the video, not a track
            continue
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

    return MediaTracks(
        audio=audio,
        subtitles=subtitles,
        video=video,
        video_pix_fmt=pix_fmt,
        video_hdr=hdr,
        video_width=width,
        video_height=height,
        video_fps=fps,
    )


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


def browser_plays(codec: str) -> bool:
    """Whether a browser takes this audio codec as-is (see ``_BROWSER_SAFE_AUDIO``)."""
    return codec in _BROWSER_SAFE_AUDIO


# Containers a browser will open. Matroska is on the list because Chrome demuxes
# it (WebM is a subset); AVI, MPEG-TS, ASF and FLV are not, and no codec inside
# them changes that — Chrome answers `DEMUXER_ERROR_COULD_NOT_OPEN` before it
# ever looks at a stream.
_BROWSER_CONTAINERS = frozenset({".mp4", ".m4v", ".webm", ".mkv", ".mov", ".ogv"})

# Video a browser decodes. HEVC is deliberately absent: support for it depends on
# the machine's hardware, so a file that plays here would fail on the phone.
_BROWSER_SAFE_VIDEO = frozenset({"h264", "vp8", "vp9", "av1"})

# 8-bit 4:2:0 only. `yuv420p10le` is the High 10 profile an anime release often
# carries, which reports `h264` and plays in no browser.
_BROWSER_SAFE_PIX_FMTS = frozenset({"yuv420p", "yuvj420p", ""})


def browser_can_play(file: Path) -> bool:
    """Whether a browser can play *file* as it sits on disk.

    False means playback has to go through :func:`hls_segment` instead, which is
    the whole reason that exists: a third of a collection assembled over years is
    XviD in an AVI, or a TV recording in MPEG-TS, and none of it opens in a tab.
    """
    if file.suffix.lower() not in _BROWSER_CONTAINERS:
        return False
    tracks = tracks_of(file)
    if tracks.video and (
        tracks.video not in _BROWSER_SAFE_VIDEO
        or tracks.video_pix_fmt not in _BROWSER_SAFE_PIX_FMTS
    ):
        return False
    return not tracks.audio or browser_plays(tracks.audio[0].codec)


def _audio_path(file: Path, relative: str, index: int) -> Path | None:
    """Where the rebuilt file for audio track *index* lives, made or not.

    None when there is no such track, or when it is the first track and plays
    as it is — then the original file is the answer and nothing is built.
    """
    tracks = tracks_of(file)
    if index < 0 or index >= len(tracks.audio):
        return None
    codec = tracks.audio[index].codec
    if index == 0 and browser_plays(codec):
        return None
    try:
        stat = file.stat()
    except OSError:
        return None
    key = hashlib.sha1(
        f"{relative}|{int(stat.st_mtime)}|{stat.st_size}|a{index}|{codec}".encode()
    ).hexdigest()
    return _audio_dir() / f"{key}.mp4"


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
    forth pays once. Returns None when there is no such track, and for a first
    track that already plays — that one is the original file, and a copy of it
    would be pure waste. A first track that does *not* play (AC-3 in a rip) is
    rebuilt like any other: without that, the file plays picture and no sound.
    """
    out = _audio_path(file, relative, index)
    if out is None:
        return None
    if out.is_file() and out.stat().st_size > 0:
        return out
    key = out.stem
    codec = tracks_of(file).audio[index].codec

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
            # Generous: a copy takes a second, but re-encoding the audio of a long
            # film is minutes, and dying half way would leave the track permanently
            # unavailable.
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
        # Windows can hold a file a moment past its writer (an antivirus scan):
        # left for the cache's pruning rather than failing the segment.
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)


#: Segment length. Six seconds is the usual HLS compromise: short enough that a
#: seek costs one transcode, long enough that process startup is not most of it.
HLS_SEGMENT_SECONDS = 6.0

#: Ceiling on the segment cache, evicted oldest-first.
# ponytail: one global cap; per-title budgets if one film ever starves another.
_HLS_CACHE_BYTES = 4 * 1024**3


def _hls_dir() -> Path:
    return config_dir() / "hls"


#: Hardware H.264 encoders, tried in order before falling back to libx264.
_GPU_ENCODERS = ("h264_nvenc", "h264_qsv", "h264_amf")


def _h264_args(encoder: str, quality: int, kbps: int = 0) -> list[str]:
    """ffmpeg flags encoding 8-bit 4:2:0 H.264 with *encoder* at about *quality* (CRF scale).

    A *kbps* caps the bitrate there too, which is the point of a lighter rung:
    on a slow link the cap, not the quality, is what has to hold.
    """
    q = str(quality)
    cap = ["-maxrate", f"{kbps}k", "-bufsize", f"{2 * kbps}k"] if kbps else []
    # QSV's and AMF's constant-quality modes ignore a cap, so a capped rung
    # runs them in their peak-constrained VBR mode instead.
    if kbps and encoder == "h264_qsv":
        return [
            "-c:v",
            encoder,
            "-preset",
            "veryfast",
            "-b:v",
            f"{kbps}k",
            *cap,
            "-pix_fmt",
            "nv12",
        ]
    if kbps and encoder == "h264_amf":
        return [
            "-c:v",
            encoder,
            "-quality",
            "speed",
            "-rc",
            "vbr_peak",
            "-b:v",
            f"{kbps}k",
            *cap,
            "-pix_fmt",
            "yuv420p",
        ]
    if encoder == "h264_nvenc":
        return [
            "-c:v",
            encoder,
            "-preset",
            "p4",
            "-rc",
            "vbr",
            "-cq",
            q,
            "-b:v",
            "0",
            *cap,
            "-pix_fmt",
            "yuv420p",
        ]
    if encoder == "h264_qsv":
        # QSV takes nv12, not yuv420p; both are the same 8-bit 4:2:0 once encoded.
        return [
            "-c:v",
            encoder,
            "-preset",
            "veryfast",
            "-global_quality",
            q,
            "-pix_fmt",
            "nv12",
        ]
    if encoder == "h264_amf":
        return [
            "-c:v",
            encoder,
            "-quality",
            "speed",
            "-rc",
            "cqp",
            "-qp_i",
            q,
            "-qp_p",
            q,
            "-pix_fmt",
            "yuv420p",
        ]
    return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        q,
        *cap,
        "-pix_fmt",
        "yuv420p",
    ]


@functools.cache
def h264_encoder() -> str:
    """The first GPU encoder that actually encodes here, else ``libx264``.

    `ffmpeg -encoders` lists NVENC on a machine with no NVIDIA card, so each is
    tried on a tenth of a second of black instead. Probed once per process.
    """
    try:
        binary = ffmpeg_binary()
    except RuntimeError:
        return "libx264"
    for encoder in _GPU_ENCODERS:
        try:
            result = subprocess.run(
                [
                    binary,
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=black:s=256x256:d=0.1",
                    "-frames:v",
                    "1",
                    *_h264_args(encoder, 23),
                    "-f",
                    "null",
                    "-",
                ],
                timeout=15,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0:
            return encoder
    return "libx264"


#: Lighter renditions offered beside the source, as (height, video kb/s). The
#: classic YouTube steps, at about the bitrate YouTube streams them at (its
#: upload recommendations are five to eight times this, too much for a slow link).
HLS_LADDER = (
    (2160, 16000),
    (1440, 9000),
    (1080, 5000),
    (720, 2500),
    (480, 1200),
    (360, 700),
    (240, 400),
    (144, 200),
)


#: Frame rates a viewer can ask for. Above the source's own, the frames in
#: between are drawn by AI; below it, frames are dropped.
FRAME_RATES = (30, 60, 70, 90, 120, 144)


def ladder(width: int, height: int) -> list[tuple[int, int, int, int]]:
    """The renditions to offer of a *width* x *height* picture, best first:
    (rung, width, height, b/s).

    Rung 0 is the source's own size; the rest are the ``HLS_LADDER`` steps below
    it, by height. Only the source when the frame size is unknown, since a step
    has to know what it is smaller than.
    """
    # shortcut: the source rung's bandwidth is a guess from the next step up
    # (it is encoded at a quality, not a rate); measure it if hls.js misjudges.
    above = [kbps for h, kbps in HLS_LADDER if height and h >= height] or [
        HLS_LADDER[0][1]
    ]
    variants = [(0, width, height, int(min(above) * 1.5 + 160) * 1000)]
    for rung, kbps in HLS_LADDER:
        if rung < height:
            # Even, as H.264 4:2:0 needs, and in the source's own shape. The
            # audio counts too: the player budgets the whole stream.
            audio = 96 if kbps <= 700 else 160
            variants.append(
                (
                    rung,
                    round(width * rung / height / 2) * 2,
                    rung,
                    (kbps + audio) * 1000,
                )
            )
    return variants


def hls_variants(file: Path) -> list[tuple[int, int, int, int]]:
    """The renditions of *file* to offer (see :func:`ladder`)."""
    tracks = tracks_of(file)
    return ladder(tracks.video_width, tracks.video_height)


def segment_durations(total: float | None) -> list[float] | None:
    """Length of each segment of something *total* seconds long, or None when
    its duration is unknown.

    This is the whole trick behind seeking: the playlist built from this lists
    every segment of the film up front, so the player knows the full timeline
    before a single frame has been encoded. Jumping an hour in asks for one
    segment rather than waiting for an hour of video to be transcoded.
    """
    if not total or total <= 0:
        return None
    whole = int(total // HLS_SEGMENT_SECONDS)
    last = total - whole * HLS_SEGMENT_SECONDS
    return [HLS_SEGMENT_SECONDS] * whole + ([last] if last > 0.01 else [])


def hls_segment_durations(file: Path) -> list[float] | None:
    """Length of each segment of *file* (see :func:`segment_durations`)."""
    return segment_durations(duration_of(file))


def _rung_kbps(rung: int, source_height: int) -> int | None:
    """The bitrate cap for *rung*, 0 for the source, None for a rung that is not
    on the ladder or would scale the picture up."""
    kbps = dict(HLS_LADDER).get(rung, 0)
    if rung and (not kbps or rung >= (source_height or rung)):
        return None
    return kbps


def hls_segment(
    file: Path, relative: str, index: int, audio: int = 0, rung: int = 0, fps: int = 0
) -> Path | None:
    """One transcoded segment of *file*, cached on disk. None if there is no such
    segment, or it could not be built.

    *rung* is a height from ``HLS_LADDER`` to scale down to and cap the bitrate
    at, or 0 for the source's own size. Every rung is cut at the same times, so
    the player can change rung at any segment boundary. *fps* is a frame rate
    below the source's to drop to; any other plays at the source's own, and
    :func:`hls_drawn` draws the frames above it from this segment.
    """
    durations = hls_segment_durations(file)
    if durations is None or not 0 <= index < len(durations):
        return None
    # The probe only when something has to be compared with the source.
    tracks = tracks_of(file) if rung or fps else MediaTracks(audio=[], subtitles=[])
    fps = _dropped(fps, tracks.video_fps)
    kbps = _rung_kbps(rung, tracks.video_height)
    if kbps is None:
        return None
    try:
        stat = file.stat()
    except OSError:
        return None

    key = hashlib.sha1(
        f"{relative}|{int(stat.st_mtime)}|{stat.st_size}"
        f"|s{index}|a{audio}|{HLS_SEGMENT_SECONDS}"
        # Only on a lighter rung or another frame rate, so the source's segments
        # cached before there were either keep their names.
        f"{f'|r{rung}' if rung else ''}{f'|f{fps}' if fps else ''}".encode()
    ).hexdigest()
    # `?` so a file with no audio, or a missing track, still yields a segment
    # rather than failing the whole run.
    maps = ["-map", "0:v:0", "-map", f"0:a:{audio}?"]
    return _encode_segment(
        [],
        str(file),
        maps,
        key,
        index,
        durations[index],
        rung,
        kbps,
        fps,
        tracks.video_fps,
    )


def _encode_segment(
    input_opts: list[str],
    source: str,
    maps: list[str],
    key: str,
    index: int,
    seconds: float,
    rung: int,
    kbps: int,
    fps: int = 0,
    source_fps: float = 0.0,
) -> Path | None:
    """Segment *index* of *source* (a file, or a URL ffmpeg reads), cached
    under *key*, at *fps* if that is below *source_fps* (frames dropped).

    Each is encoded on its own from the source, which is what makes a seek cheap
    and is why they are independently decodable: a fresh encode opens on a
    keyframe. ``-output_ts_offset`` stamps the segment with its real position, so
    the player stitches them into one timeline instead of a run of clips.

    The video is always re-encoded, even when the codec would have played, since
    cutting a stream with ``-c:v copy`` only works on the source's own keyframes.
    Paying for the encode buys segment boundaries we choose.
    """
    out = _hls_dir() / f"{key}.ts"
    if out.is_file() and out.stat().st_size > 0:
        # Touched so eviction reads it as recently used, not merely old.
        out.touch()
        return out

    try:
        binary = ffmpeg_binary()
    except RuntimeError:
        return None
    out.parent.mkdir(parents=True, exist_ok=True)
    start = index * HLS_SEGMENT_SECONDS
    dropped = bool(fps and source_fps and fps < source_fps - 0.5)

    # Before -i: ffmpeg seeks by keyframe and then decodes forward to the exact
    # position, which costs the same at two hours in as at the start. After -i
    # it would decode the whole film to get there. None at all for the first:
    # on an HLS stream whose clock starts past zero (1.4 s is usual), `-ss 0`
    # shifts that segment's video two seconds late and its audio a second early.
    seek = ["-ss", f"{start:.3f}"] if start else []
    head = [binary, "-nostdin", "-hide_banner", "-loglevel", "error"]
    tmp = out.with_name(f"{key}.{os.getpid()}.{threading.get_ident()}.tmp.ts")
    tail = [
        # Pixel format forced, not inherited: a 10-bit source (the x265 anime
        # rips) would otherwise be encoded 10-bit again, which is the High 10
        # profile no browser decodes — the very thing being fixed here.
        *_h264_args(h264_encoder(), 23, kbps),
        # No B-frames, so decode order matches presentation order. Each segment
        # here is encoded on its own rather than cut from one long run, and with
        # reordering on, the frames at a boundary carry decode timestamps that
        # run backwards against the segment before them. The browser rejects the
        # append outright: `CHUNK_DEMUXER_ERROR_APPEND_FAILED: Parsed buffers not
        # in DTS sequence`, twenty milliseconds into playback.
        "-bf",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        # Thinner on the lowest rungs, where 160k would be a third of it.
        "96k" if kbps and kbps <= 700 else "160k",
        # Downmixed, because a 5.1 AAC track inside MPEG-TS is rejected by Media
        # Source Extensions: hls.js reports `bufferAppendError` and nothing
        # plays. Stereo is what a browser is going to output anyway.
        "-ac",
        "2",
        # Where this segment sits on the film's timeline.
        "-output_ts_offset",
        f"{start:.3f}",
        "-muxdelay",
        "0",
        "-muxpreload",
        "0",
        "-f",
        "mpegts",
        "-y",
        str(tmp),
    ]
    filters = [f"scale=-2:{rung}"] if rung else []
    if dropped:
        filters.append(f"fps={fps}")
    try:
        result = subprocess.run(
            [
                *head,
                *seek,
                *input_opts,
                "-i",
                source,
                "-t",
                f"{seconds:.3f}",
                *maps,
                "-sn",
                *(["-vf", ",".join(filters)] if filters else []),
                *tail,
            ],
            # A segment is a second of work; a minute means something is
            # wrong and the player is better told so than left waiting.
            timeout=120,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0 and tmp.is_file() and tmp.stat().st_size > 0:
            os.replace(tmp, out)
            _prune_hls_cache()
            return out
        return None
    except (OSError, subprocess.SubprocessError):
        return None
    finally:
        # Windows can hold a file a moment past its writer (an antivirus scan):
        # left for the cache's pruning rather than failing the segment.
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)


def _drawable(fps: int, source_fps: float) -> int:
    """*fps*, or 0 for the source's own when it would need AI frames this
    machine cannot draw fast enough (no GPU): drawing would fall far behind
    playback. Decided before the cache key, so a segment is only ever cached
    under the rate it really has."""
    from sestudio import interpolate

    if fps and source_fps and fps > source_fps + 0.5:
        return fps if interpolate.status().get("gpu") else 0
    return fps


def _dropped(fps: int, source_fps: float) -> int:
    """*fps* if it is below *source_fps*, so frames are dropped; else 0, the
    source's own. Frames above it are drawn apart, by :func:`hls_drawn`."""
    return fps if fps and source_fps and fps < source_fps - 0.5 else 0


def draws(fps: int, source_fps: float) -> bool:
    """Whether *fps* is above *source_fps* and this machine can draw it."""
    return bool(fps and source_fps and fps > source_fps + 0.5) and bool(
        _drawable(fps, source_fps)
    )


def _rung_size(rung: int, width: int, height: int) -> tuple[int, int]:
    """The picture size of *rung* (0 for the source's own), even both ways."""
    if rung and height:
        return round(width * rung / height / 2) * 2, rung
    return width // 2 * 2, height // 2 * 2


_SAR_RE = re.compile(r"\bSAR (\d+):(\d+)")


def _sar_of(segment: Path) -> str | None:
    """The pixel shape of *segment*'s picture, as `setsar` takes it ("159/160"),
    or None when square or unknown."""
    try:
        text = subprocess.run(
            [ffmpeg_binary(), "-hide_banner", "-i", str(segment)],
            capture_output=True,
            text=True,
            timeout=15,
        ).stderr
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return None
    found = _SAR_RE.search(text)
    if not found or found.group(1) == found.group(2):
        return None
    return f"{found.group(1)}/{found.group(2)}"


def _last_frames(segment: Path, size: tuple[int, int], count: int, fps: float) -> list:
    """The last *count* frames of *segment* at *size*, as :func:`_draw_segment`
    reads its own: none if they cannot be read."""
    from sestudio import interpolate

    width, height = size
    try:
        out = subprocess.run(
            [
                ffmpeg_binary(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-sseof",
                f"-{(count + 1) / fps:.3f}",
                "-i",
                str(segment),
                "-map",
                "0:v:0",
                "-vf",
                f"scale={width}:{height},format=rgb24",
                "-f",
                "rawvideo",
                "pipe:1",
            ],
            capture_output=True,
            timeout=30,
        ).stdout
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return []
    return list(interpolate.read_frames(io.BytesIO(out), width, height))[-count:]


def _draw_segment(
    raw: Path,
    following: Path | None,
    index: int,
    seconds: float,
    fps: int,
    source_fps: float,
    size: tuple[int, int],
    kbps: int,
    previous: Path | None = None,
    hold: int = 0,
) -> Path | None:
    """Segment *index* at *fps*, with the frames in between drawn by AI.

    Made from *raw* — the same segment at the source's rate, already at the size
    and quality being sent — and *following*, the next, which gives its last
    frames a right-hand neighbour. Read from disk rather than the source, so
    drawing never waits on a host, and from a picture already scaled down: a
    lighter rung is cheaper to draw. The audio is *raw*'s, copied.

    With *hold* (see ``AppConfig.ai_max_hold``), held drawings are drawn across
    as one: *previous*, the segment before, says where one held into this
    segment started, and *following* where the last one ends.
    """
    from sestudio import interpolate

    out = _hls_dir() / f"{raw.stem}-f{fps}{f'-h{hold}' if hold else ''}.ts"
    if out.is_file() and out.stat().st_size > 0:
        out.touch()
        return out
    try:
        binary = ffmpeg_binary()
    except RuntimeError:
        return None
    out.parent.mkdir(parents=True, exist_ok=True)
    width, height = size
    # Raw frames carry no pixel shape: the source's, put back, or a film with
    # non-square pixels would widen a little each time AI frames take over.
    sar = _sar_of(raw)
    if kbps:
        # More frames need more bits to look the same; not twice as many, as
        # the frames drawn in between are close to their neighbours.
        kbps = int(kbps * (fps / source_fps) ** 0.5)
    head = [binary, "-nostdin", "-hide_banner", "-loglevel", "error"]
    tmp = out.with_name(f"{out.stem}.{os.getpid()}.{threading.get_ident()}.tmp.ts")
    decode = [
        *head,
        "-i",
        f"concat:{raw}|{following}" if following else str(raw),
        "-t",
        # Past the end, so the last in-betweens have their right side: a
        # drawing held up to *hold* frames needs as many more.
        f"{seconds + (hold + 2) / source_fps:.3f}",
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-vf",
        f"scale={width}:{height},format=rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
    ]
    encode = [
        *head,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-i",
        "pipe:0",
        "-i",
        str(raw),
        "-map",
        "0:v",
        "-map",
        "1:a?",
        "-t",
        f"{seconds:.3f}",
        "-sn",
        # RGB back to the BT.709 YUV an HD picture is tagged as.
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv" + (f",setsar={sar}" if sar else ""),
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        *_h264_args(h264_encoder(), 23, kbps),
        # No B-frames, as in _encode_segment.
        "-bf",
        "0",
        "-c:a",
        "copy",
        "-output_ts_offset",
        f"{index * HLS_SEGMENT_SECONDS:.3f}",
        "-muxdelay",
        "0",
        "-muxpreload",
        "0",
        "-f",
        "mpegts",
        "-y",
        str(tmp),
    ]
    before = _last_frames(previous, size, hold, source_fps) if previous and hold else []
    try:
        # Generous: drawn frames cost far more than encoded ones, and a GPU that
        # cannot keep up should still finish rather than leave a hole.
        ok = interpolate.run_pipeline(
            decode, encode, width, height, source_fps, fps,
            round(seconds * fps), timeout=600, hold=hold, before=before,
        )  # fmt: skip
        if ok and tmp.is_file() and tmp.stat().st_size > 0:
            os.replace(tmp, out)
            _prune_hls_cache()
            return out
        return None
    except OSError:
        return None
    finally:
        # Windows can hold a file a moment past its writer (an antivirus scan):
        # left for the cache's pruning rather than failing the segment.
        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)


def hls_drawn(
    file: Path, relative: str, index: int, audio: int = 0, rung: int = 0, fps: int = 0
) -> Path | None:
    """Segment *index* of *file* at *fps*, above the source's rate, drawn from
    :func:`hls_segment`'s at the source's rate. None where this machine cannot
    draw, or there is no such segment."""
    durations = hls_segment_durations(file)
    if durations is None or not 0 <= index < len(durations):
        return None
    tracks = tracks_of(file)
    kbps = _rung_kbps(rung, tracks.video_height)
    if kbps is None or not draws(fps, tracks.video_fps):
        return None
    raw = hls_segment(file, relative, index, audio, rung)
    last = index + 1 >= len(durations)
    following = None if last else hls_segment(file, relative, index + 1, audio, rung)
    if raw is None:
        return None
    hold = load_config().ai_max_hold
    previous = (
        hls_segment(file, relative, index - 1, audio, rung) if hold and index else None
    )
    size = _rung_size(rung, tracks.video_width, tracks.video_height)
    return _draw_segment(
        raw, following, index, durations[index], fps, tracks.video_fps, size, kbps,
        previous, hold,
    )  # fmt: skip


@dataclass
class StreamProbe:
    """What ffmpeg reports of a stream it reads over HTTP."""

    duration: float
    width: int
    height: int
    #: The best picture, by height, among the video streams; an HLS master
    #: lists one per variant, and the first is often the smallest.
    video: int
    #: The audio beside it: the same position when every variant carries its
    #: own, else the first (a shared audio rendition).
    audio: int
    hdr: bool
    hls: bool
    #: The best picture's frame rate, 0 when unknown.
    fps: float = 0.0


_probes: dict[str, StreamProbe | None] = {}


@functools.cache
def _extension_picky() -> bool:
    """Whether this ffmpeg's HLS reader refuses segments by file extension.

    Since 7.1 it does, and proxied segment URLs carry none (hosts that disguise
    segments as `.png` would fail anyway), so the check is turned off where it
    exists. Asked of the binary, since the option is an error where it is not.
    """
    try:
        result = subprocess.run(
            [ffmpeg_binary(), "-hide_banner", "-h", "demuxer=hls"],
            timeout=15,
            check=False,
            capture_output=True,
        )
    except (RuntimeError, OSError, subprocess.SubprocessError):
        return False
    return b"extension_picky" in result.stdout


def stream_input_opts(probe: StreamProbe | None, *, hls: bool) -> list[str]:
    """ffmpeg input options for reading a stream over HTTP."""
    # A stalled upstream fails the run rather than hanging the player on it.
    opts = ["-rw_timeout", "30000000"]
    if (probe.hls if probe else hls) and _extension_picky():
        opts += ["-extension_picky", "0"]
    return opts


def probe_stream(url: str, *, hls: bool) -> StreamProbe | None:
    """Length, picture size and best streams of *url*; None when unreadable.

    Cached per URL: the probe reads the playlist (or the mp4's index) over the
    network, which is seconds, and every segment would otherwise repeat it.
    """
    if url in _probes:
        return _probes[url]
    found: StreamProbe | None = None
    try:
        result = subprocess.run(
            [
                ffmpeg_binary(),
                "-nostdin",
                "-hide_banner",
                *stream_input_opts(None, hls=hls),
                "-i",
                url,
            ],
            timeout=60,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        found = _parse_stream_probe(result.stderr.decode("utf-8", "replace"), hls)
    except (RuntimeError, OSError, subprocess.SubprocessError):
        found = None
    # A failure is not cached: the host may only have been slow this once.
    if found is not None:
        _probes[url] = found
    return found


def _parse_stream_probe(text: str, hls: bool) -> StreamProbe | None:
    duration = _DURATION_RE.search(text)
    if not duration:
        return None
    hours, minutes, rest = duration.groups()
    videos: list[tuple[int, int, bool, float]] = []
    audios = 0
    for line in text.splitlines():
        if _VIDEO_STREAM_RE.match(line):
            size = _FRAME_SIZE_RE.search(line)
            w, h = (int(size.group(1)), int(size.group(2))) if size else (0, 0)
            rate = _FPS_RE.search(line)
            hdr = "smpte2084" in line or "arib-std-b67" in line
            videos.append((w, h, hdr, float(rate.group(1)) if rate else 0.0))
        elif (match := _STREAM_RE.match(line)) and match.group("kind") == "Audio":
            audios += 1
    if not videos:
        return None
    best = max(range(len(videos)), key=lambda i: videos[i][1])
    width, height, hdr, fps = videos[best]
    return StreamProbe(
        duration=int(hours) * 3600 + int(minutes) * 60 + float(rest),
        width=width,
        height=height,
        video=best,
        audio=best if audios == len(videos) else 0,
        hdr=hdr,
        hls=hls,
        fps=fps,
    )


def stream_segment(
    url: str, index: int, rung: int, *, hls: bool, fps: int = 0
) -> Path | None:
    """One transcoded segment of the stream at *url*, as :func:`hls_segment`
    is of a file. None if there is no such segment, or it could not be built.

    *url* is the server's own proxy of a provider's stream, which carries the
    headers the host wants and decrypts nothing itself: ffmpeg's HLS reader
    fetches the keys through the same proxy and decrypts as it goes.
    """
    probe = probe_stream(url, hls=hls)
    durations = segment_durations(probe.duration if probe else None)
    if probe is None or durations is None or not 0 <= index < len(durations):
        return None
    kbps = _rung_kbps(rung, probe.height)
    if kbps is None:
        return None
    fps = _dropped(fps, probe.fps)
    # shortcut: keyed on the URL, which for a host that signs its links changes
    # each time the episode is resolved; key on the embed if re-watches matter.
    key = hashlib.sha1(
        f"{url}|s{index}|{HLS_SEGMENT_SECONDS}|r{rung}|f{fps}".encode()
    ).hexdigest()
    maps = ["-map", f"0:v:{probe.video}", "-map", f"0:a:{probe.audio}?"]
    return _encode_segment(
        stream_input_opts(probe, hls=hls),
        url,
        maps,
        key,
        index,
        durations[index],
        rung,
        kbps,
        fps,
        probe.fps,
    )


def stream_drawn(
    url: str, index: int, rung: int, *, hls: bool, fps: int = 0
) -> Path | None:
    """Segment *index* of the stream at *url* at *fps*, as :func:`hls_drawn`
    is of a file: drawn from the segments :func:`stream_segment` made."""
    probe = probe_stream(url, hls=hls)
    durations = segment_durations(probe.duration if probe else None)
    if probe is None or durations is None or not 0 <= index < len(durations):
        return None
    kbps = _rung_kbps(rung, probe.height)
    if kbps is None or not draws(fps, probe.fps):
        return None
    raw = stream_segment(url, index, rung, hls=hls)
    last = index + 1 >= len(durations)
    following = None if last else stream_segment(url, index + 1, rung, hls=hls)
    if raw is None:
        return None
    hold = load_config().ai_max_hold
    previous = stream_segment(url, index - 1, rung, hls=hls) if hold and index else None
    size = _rung_size(rung, probe.width, probe.height)
    return _draw_segment(
        raw, following, index, durations[index], fps, probe.fps, size, kbps,
        previous, hold,
    )  # fmt: skip


def _prune_hls_cache() -> None:
    """Drop the oldest segments once the cache passes its ceiling.

    Watching a film through leaves about a gigabyte behind, and it is worth
    keeping: a re-watch, or a seek back to a scene, then costs nothing. Worth
    keeping, but not for ever.
    """
    try:
        files = [
            (f.stat().st_mtime, f.stat().st_size, f) for f in _hls_dir().glob("*.ts")
        ]
    except OSError:
        return
    total = sum(size for _, size, _ in files)
    if total <= _HLS_CACHE_BYTES:
        return
    for _, size, path in sorted(files):
        try:
            path.unlink()
        except OSError:  # pragma: no cover — raced with another prune
            continue
        total -= size
        # To 90%, so this does not run again on the very next segment.
        if total <= _HLS_CACHE_BYTES * 0.9:
            return


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
        # Windows can hold a file a moment past its writer (an antivirus scan):
        # left for the cache's pruning rather than failing the segment.
        with contextlib.suppress(OSError):
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


#: What the TV stream is sent as. MPEG-TS is the one container every DLNA TV
#: takes, and the only one that can be written front to back to a pipe and
#: still be joined part way through.
TV_MEDIA_TYPE = "video/mpeg"

#: Time-seek only (OP=10): there are no bytes to range over in a stream that
#: does not exist yet. CI=1 says it is converted, so the TV expects no index.
TV_CONTENT_FEATURES = (
    "DLNA.ORG_OP=10;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=01700000000000000000000000000000"
)

#: Height of the frame a TV is sent by default. A rung is its own frame, above
#: this too when the source is bigger.
TV_HEIGHT = 1080


def tv_frame(rung: int) -> tuple[int, int]:
    """The 16:9 frame for *rung* (a height from ``HLS_LADDER``), 1080p for 0."""
    height = rung if rung > 0 else TV_HEIGHT
    return round(height * 16 / 9 / 2) * 2, height


def _tv_fit(width: int, height: int) -> str:
    # Into a fixed frame, letterboxed, the way the TV would show it anyway. A
    # fixed frame is also what a picture subtitle's canvas is drawn against.
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
        f"pad={width}:{height}:-1:-1"
    )


# HDR to SDR. Without it a PQ picture on an SDR stream is grey and flat.
_TV_TONEMAP = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
)


def _same_lang(a: str, b: str) -> bool:
    # shortcut: two-letter prefix, so fr/fre/fra meet but de/ger do not; map the
    # ISO 639-2 B/T pairs if a language that differs between them turns up.
    a, b = a.lower(), b.lower()
    return bool(a) and bool(b) and (a == b or a[:2] == b[:2])


def tv_subtitle(file: Path, lang: str) -> Track | Path | None:
    """The subtitle to burn into the TV stream for *lang*.

    An embedded track first — text or picture, since burning in takes either —
    else a `.vtt` beside the file. None when the file has nothing in *lang*.
    """
    for track in tracks_of(file).subtitles:
        if _same_lang(track.lang, lang):
            return track
    for found, path in sidecar_subtitles(file):
        if _same_lang(found, lang):
            return path
    return None


def _filter_value(value: str) -> str:
    """*value* escaped for a filter option inside a filtergraph.

    ffmpeg unescapes twice — once for the graph, once for the option — so a
    Windows drive colon or an apostrophe in a title has to survive both.
    """
    for special in ("\\", "'", ":"):
        value = value.replace(special, "\\" + special)
    for special in ("\\", "'", "[", "]", ",", ";"):
        value = value.replace(special, "\\" + special)
    return value


def tv_stream_command(
    file: Path | str,
    start: float,
    audio: int,
    subtitle: Track | Path | None,
    hdr: bool,
    rung: int = 0,
    stream: StreamProbe | None = None,
    fps: int = 0,
    raw: bool = False,
) -> list[str]:
    """ffmpeg, re-encoding *file* from *start* for a TV, to stdout.

    H.264 and stereo AAC in MPEG-TS at 1080p: what every DLNA TV decodes, and
    what one core keeps ahead of playback even from a 4K HDR source. Nothing is
    written to disk — seeking is a new run from the new *start*.

    A *rung* sends that rung's frame capped at its bitrate: smaller for a TV on
    a link that cannot keep up, larger than 1080p when the source is.

    With *stream*, *file* is a URL of a provider's stream that it describes, and
    its best picture and the audio beside it are what is sent.

    An *fps* below the source's drops frames down to it. With *raw*, the
    picture is written as raw RGB frames instead, picture only, for frames to
    be drawn between them (see :func:`tv_drawn_encode`).
    """
    width, height = tv_frame(rung)
    kbps = dict(HLS_LADDER).get(height, 0) if rung else 0
    # None from the very start, as for a segment (see ``_encode_segment``).
    seek = ["-ss", f"{start:.3f}"] if start else []
    opts = stream_input_opts(stream, hls=False) if stream else []
    v = stream.video if stream else 0
    audio = stream.audio if stream else audio
    inputs = [*seek, *opts, "-i", str(file)]
    video = (
        f"{_tv_fit(width, height)},{_TV_TONEMAP + ',' if hdr else ''}"
        f"{f'fps={fps},' if fps else ''}format={'rgb24' if raw else 'yuv420p'}"
    )
    if isinstance(subtitle, Track) and not subtitle.text:
        # A picture subtitle is overlaid from a second reading of the same file.
        # Read from the first, its sparse packets stall the demuxer behind the
        # audio: a TrueHD film then encodes at a fifth of real time.
        inputs += [*seek, "-i", str(file)]
        graph = (
            f"[0:v:{v}]{video}[b];[1:s:{subtitle.index}]scale={width}:{height}[s];"
            "[b][s]overlay=eof_action=pass[v]"
        )
    elif subtitle is not None:
        source = file if isinstance(subtitle, Track) else subtitle
        # Forward slashes: ffmpeg takes them on Windows, and they need no escape.
        name = _filter_value(str(source).replace("\\", "/"))
        index = f":si={subtitle.index}" if isinstance(subtitle, Track) else ""
        # The input seek restarts the clock at zero, and libass times cues by it,
        # so the film's own time is put back for the render and taken off after.
        graph = (
            f"[0:v:{v}]setpts=PTS+{start:.3f}/TB,{video},"
            f"subtitles=filename={name}{index},setpts=PTS-STARTPTS[v]"
        )
    else:
        graph = f"[0:v:{v}]{video}[v]"
    head = [ffmpeg_binary(), "-nostdin", "-hide_banner", "-loglevel", "error"]
    if raw:
        return [
            *head,
            *inputs,
            "-filter_complex",
            graph,
            "-map",
            "[v]",
            "-an",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
    return [
        *head,
        *inputs,
        "-filter_complex",
        graph,
        "-map",
        "[v]",
        "-map",
        f"0:a:{audio}?",
        *_h264_args(h264_encoder(), 21, kbps),
        # Frames in display order, so a change mid-stream can continue right
        # after the last one sent (see routes/downloaded.py `_live_piped`).
        "-bf",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "96k" if kbps and kbps <= 700 else "192k",
        "-ac",
        "2",
        # Timestamps on the film's own clock, so a seek reads as that position.
        "-output_ts_offset",
        f"{start:.3f}",
        "-f",
        "mpegts",
        "pipe:1",
    ]


def tv_drawn_encode(
    file: Path | str,
    start: float,
    audio: int,
    rung: int,
    fps: int,
    source_fps: float,
    stream: StreamProbe | None = None,
) -> list[str]:
    """ffmpeg encoding raw RGB frames on stdin at *fps* — the picture of
    :func:`tv_stream_command` with ``raw``, frames drawn between — with the
    audio read again from *file*, for a TV, to stdout."""
    width, height = tv_frame(rung)
    kbps = dict(HLS_LADDER).get(height, 0) if rung else 0
    if kbps:
        kbps = int(kbps * (fps / source_fps) ** 0.5)
    seek = ["-ss", f"{start:.3f}"] if start else []
    opts = stream_input_opts(stream, hls=False) if stream else []
    audio = stream.audio if stream else audio
    return [
        ffmpeg_binary(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-i",
        "pipe:0",
        *seek,
        *opts,
        "-i",
        str(file),
        "-map",
        "0:v",
        "-map",
        f"1:a:{audio}?",
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        *_h264_args(h264_encoder(), 21, kbps),
        # Frames in display order, so a change mid-stream can continue right
        # after the last one sent (see routes/downloaded.py `_live_piped`).
        "-bf",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "96k" if kbps and kbps <= 700 else "192k",
        "-ac",
        "2",
        "-output_ts_offset",
        f"{start:.3f}",
        "-f",
        "mpegts",
        "pipe:1",
    ]


def tv_fps(fps: int, source_fps: float) -> tuple[int, bool]:
    """The rate a TV is sent for an asked *fps*, and whether it is drawn by AI.

    The source's own (0) where it would be drawn on a machine that cannot draw
    fast enough. Not capped at what a TV decodes: that is the viewer's call.
    """
    fps = _drawable(fps, source_fps)
    return fps, bool(fps and source_fps and fps > source_fps + 0.5)


def _thumb_dir() -> Path:
    return config_dir() / "thumbs"


def _thumb_path(file: Path, relative: str) -> Path | None:
    """Where the still for *file* lives, made or not; None if the file is gone.

    Keyed on the file's path, size and mtime, so replacing a file makes a new
    still and nothing has to be invalidated by hand.
    """
    try:
        stat = file.stat()
    except OSError:
        return None
    key = hashlib.sha1(
        f"{relative}|{int(stat.st_mtime)}|{stat.st_size}".encode()
    ).hexdigest()
    return _thumb_dir() / f"{key}.jpg"


def cached_thumbnail(file: Path, relative: str) -> Path | None:
    """The still for *file* if it has already been made, else None. No ffmpeg."""
    out = _thumb_path(file, relative)
    if out is not None and out.is_file() and out.stat().st_size > 0:
        return out
    return None


def thumbnail(file: Path, relative: str) -> Path | None:
    """A cached still from *file*, or None when one cannot be made.

    Most of a personal collection is not on TMDB — a rip with an odd name, a
    title that never had an English release — and a wall of blank posters is a
    poor shelf. A frame from the file itself is always available and always
    right, so it stands in wherever a real poster is missing.
    """
    out = _thumb_path(file, relative)
    if out is None:
        return None
    if out.is_file() and out.stat().st_size > 0:
        return out
    key = out.stem

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
