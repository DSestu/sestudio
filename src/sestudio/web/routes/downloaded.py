"""The downloaded library: what is on disk, and serving it back.

Listing merges two sources — the filesystem scan (:mod:`sestudio.downloaded`),
which decides what exists, and the ``downloaded_files`` manifest, which carries
what a path cannot say (the unsanitised series name, the poster, the page it
came from). Anything the tool did not download has no manifest row at all, so
the path is the whole of what is known about it.
"""

from __future__ import annotations

import asyncio
import subprocess
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse

from sestudio import downloaded, interpolate, library
from sestudio.config import load_config

router = APIRouter()

# Stills are made in the background, in their own small pool, and a request
# for one that is not made yet is answered at once with 404 rather than held
# open until ffmpeg is done. Held open, it cost more than its own wait: a
# browser allows six connections to a host, opening a folder in the explorer
# asks for a still per visible card, and a cold one is an ffmpeg run of several
# seconds — so the six were all sitting on stills when the player asked for
# the file, its request queued behind them, and its 8s decode check timed out
# with "No playable source" for a file that plays fine. The card retries a
# 404 a few times, so the shelf fills in as the pool gets to each one.
# ponytail: one pool for all clients; per-client fairness if it ever matters.
_THUMB_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="thumb")
# What is being made right now, so a card that asks again while it waits does
# not queue a second ffmpeg run for the same still.
_THUMBS_PENDING: dict[str, Future[Path | None]] = {}


# The Google Cast receiver refuses media served without CORS headers, exactly as
# for the stream proxy; DLNA renderers are indifferent. Harmless for browsers.
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
}


def _listing(root: str) -> list[dict[str, Any]]:
    """Downloaded files, grouped into titles.

    Grouping is by the folder-derived (series, season): that is what the
    filesystem can be trusted for. The manifest then supplies the display name
    and artwork for whichever files it knows about.
    """
    files = downloaded.scan(root)
    manifest = library.downloaded_files()

    groups: dict[tuple[str, int], dict[str, Any]] = {}
    for file in files:
        meta = manifest.get(file.path, {})
        key = (file.series, file.season)
        group = groups.get(key)
        if group is None:
            group = groups[key] = {
                "key": f"{file.series}|S{file.season}",
                # Falls back to the sanitised folder name for anything
                # downloaded before the manifest existed.
                "series": meta.get("series_name") or file.series,
                "season": file.season,
                # Where it lives, for the client's one-card-per-folder view.
                "folder": file.folder,
                "is_film": file.is_film,
                "poster_url": meta.get("poster_url", ""),
                "page_url": meta.get("page_url", ""),
                "source": meta.get("source", ""),
                "langs": [],
                "files": [],
                "size": 0,
                "mtime": 0.0,
            }
        # A later file may be the one carrying metadata, so fill any gaps.
        for field in ("poster_url", "page_url", "source"):
            if not group[field] and meta.get(field):
                group[field] = meta[field]
        if meta.get("series_name"):
            group["series"] = meta["series_name"]

        if file.lang and file.lang not in group["langs"]:
            group["langs"].append(file.lang)
        group["files"].append(
            {
                "path": file.path,
                "number": file.number,
                "title": file.title,
                "lang": file.lang,
                "size": file.size,
                "mtime": file.mtime,
            }
        )
        group["size"] += file.size
        group["mtime"] = max(group["mtime"], file.mtime)

    for group in groups.values():
        group["langs"].sort()
        group["files"].sort(key=lambda f: (f["number"], f["lang"]))
    # Newest first: what you just downloaded is what you most likely want.
    return sorted(groups.values(), key=lambda g: g["mtime"], reverse=True)


@router.get("/downloaded")
async def list_downloaded() -> list[dict[str, Any]]:
    cfg = load_config()
    return await asyncio.to_thread(_listing, cfg.output_root)


@router.get("/downloaded/season")
async def downloaded_season(series: str = "", season: int = 0) -> dict[str, Any]:
    """One downloaded title in the shape ``/season`` returns.

    So the watch view can open a title that exists only on disk — anything
    fetched before its page was recorded has no site page to go back to. Same
    payload shape, so the view, the playlist and the language switcher all work
    unchanged.

    ``embed_urls`` is empty by design: there is no host to resolve. The client
    pairs each episode with its file and plays that.
    """
    cfg = load_config()
    titles = await asyncio.to_thread(_listing, cfg.output_root)

    match = next(
        (t for t in titles if t["series"] == series and t["season"] == season), None
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Nothing downloaded for that title")

    # One entry per episode number, carrying every language it exists in — the
    # same contract the sites' pages provide.
    episodes: dict[int, dict[str, Any]] = {}
    for file in match["files"]:
        entry = episodes.setdefault(
            file["number"],
            {
                "number": file["number"],
                "title": file["title"],
                "filename": file["path"].rsplit("/", 1)[-1],
                "providers": [],
                "embed_urls": {},
                "langs": [],
            },
        )
        if file["lang"] and file["lang"] not in entry["langs"]:
            entry["langs"].append(file["lang"])

    return {
        "season": match["season"],
        "is_film": match["is_film"],
        "available_langs": match["langs"],
        "source": "downloaded",
        "provider_order": [],
        "episodes": [episodes[n] for n in sorted(episodes)],
    }


def _resolved(path: str) -> Any:
    """The absolute path for a client-supplied one, or 4xx.

    This is the only endpoint that turns a caller-controlled string into a real
    filesystem path, so the confinement check is not optional.
    """
    cfg = load_config()
    try:
        target = downloaded.resolve(cfg.output_root, path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside the download root")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="No such file")
    return target


def _npt_seconds(value: str) -> float | None:
    """Start position out of a ``TimeSeekRange.dlna.org: npt=…`` header.

    Renderers send either plain seconds or ``HH:MM:SS.mmm``, so both are read.
    """
    text = value.strip()
    if text.lower().startswith("npt="):
        text = text[4:]
    start = text.split("-", 1)[0].strip()
    if not start:
        return None
    try:
        if ":" in start:
            parts = [float(p) for p in start.split(":")]
            while len(parts) < 3:
                parts.insert(0, 0.0)
            return parts[-3] * 3600 + parts[-2] * 60 + parts[-1]
        return float(start)
    except ValueError:
        return None


def _from_offset(target: Path, offset: int) -> Iterator[bytes]:
    with target.open("rb") as handle:
        handle.seek(offset)
        while chunk := handle.read(64 * 1024):
            yield chunk


@router.api_route("/downloaded/file", methods=["GET", "HEAD"])
async def get_downloaded_file(
    request: Request, path: str = Query(...), audio: int | None = None
) -> Response:
    """Stream a downloaded file.

    No ``filename`` is passed, so the response carries no ``Content-Disposition``
    and plays inline instead of downloading — the opposite of the job-file route.
    Range handling comes from FileResponse itself, which is what makes seeking
    work in the browser.

    HEAD is registered explicitly: a DLNA renderer probes with it before playing,
    and ``@router.get`` alone answers it with 405.

    For a TV, byte ranges are not enough. A renderer decides whether to offer
    "jump to a timestamp" from what the server advertises, and answers a seek
    with ``TimeSeekRange.dlna.org`` — in time, not bytes. Told nothing, it works
    that out from the container alone, which is why seeking worked on some files
    and was refused on others.

    ``audio=N`` asks for the file carrying audio track N instead of its first.
    Answered by swapping in a derived file and serving it through everything
    below unchanged, so a chosen track seeks, byte-ranges, casts and time-seeks
    exactly as the original does — none of which would be true of a second,
    parallel endpoint.
    """
    target = _resolved(path)
    if audio is not None:
        # Built here if it is not yet — which waits for ffmpeg, minutes for a
        # re-encode. Only a TV asks for one now (a browser gets the track
        # encoded into its HLS segments), and it waits.
        alternate = await asyncio.to_thread(
            downloaded.alternate_audio, target, path, audio
        )
        if alternate is not None:
            target = alternate
        elif audio != 0:
            raise HTTPException(
                status_code=404, detail="No such audio track, or it could not be built"
            )
        # ``audio=0`` on a track that plays as it is: the original file is the
        # answer, and nothing was built.
    duration = await asyncio.to_thread(downloaded.duration_of, target)
    media_type = downloaded.media_type_for(target)
    headers = {
        **_CORS_HEADERS,
        "Accept-Ranges": "bytes",
        "contentFeatures.dlna.org": downloaded.content_features(duration is not None),
        # Renderers expect the transfer mode they asked for to be echoed.
        "transferMode.dlna.org": request.headers.get(
            "transferMode.dlna.org", "Streaming"
        ),
    }

    asked = request.headers.get("TimeSeekRange.dlna.org")
    start = _npt_seconds(asked) if asked else None
    if start is not None and duration and duration > 0:
        size = target.stat().st_size
        # Proportional: without an index there is nothing better to go on, and
        # every DLNA server does the same. Exact for constant bitrate, and off
        # by a little on variable — the renderer corrects itself as it plays.
        offset = min(max(0, int(size * (start / duration))), max(0, size - 1))
        last = size - 1
        headers |= {
            "Content-Range": f"bytes {offset}-{last}/{size}",
            "TimeSeekRange.dlna.org": (
                f"npt={start:.3f}-{duration:.3f}/{duration:.3f}"
                f" bytes={offset}-{last}/{size}"
            ),
            "Content-Length": str(size - offset),
        }
        if request.method == "HEAD":
            return Response(status_code=206, media_type=media_type, headers=headers)
        return StreamingResponse(
            _from_offset(target, offset),
            status_code=206,
            media_type=media_type,
            headers=headers,
        )

    return FileResponse(
        target,
        # By extension: a collection that predates this tool is full of mkv and
        # avi, and calling those mp4 would mislead every player that trusts it.
        media_type=media_type,
        headers=headers,
    )


#: An MPEG-TS packet, and the PID ffmpeg gives the first video stream.
_TS_PACKET = 188
_TS_VIDEO_PID = 0x100


def frame_starts(data: bytes) -> list[tuple[int, int]]:
    """Where each video frame starts in the whole MPEG-TS packets at the head
    of *data*, as (byte offset, timestamp at 90 kHz).

    Read off the bytes, as that is what a TV has been sent: an encode runs
    ahead of it, by more than any position ffmpeg reports.
    """
    found: list[tuple[int, int]] = []
    for at in range(0, len(data) - _TS_PACKET + 1, _TS_PACKET):
        packet = data[at : at + _TS_PACKET]
        pid = ((packet[1] & 0x1F) << 8) | packet[2]
        # A frame's first packet, for the video stream, with a payload.
        if packet[0] != 0x47 or pid != _TS_VIDEO_PID or not packet[1] & 0x40:
            continue
        control = (packet[3] >> 4) & 0x3
        if not control & 0x1:
            continue
        payload = 4 + (1 + packet[4] if control & 0x2 else 0)
        pes = packet[payload:]
        if len(pes) < 14 or pes[:3] != b"\x00\x00\x01" or not pes[7] & 0x80:
            continue
        pts = (
            ((pes[9] >> 1) & 0x07) << 30
            | pes[10] << 22
            | (pes[11] >> 1) << 15
            | pes[12] << 7
            | pes[13] >> 1
        )
        found.append((at, pts))
    return found


class _TvRun:
    """One encode of a TV stream from a point in the film: a single ffmpeg, or
    one decoding to raw frames, AI drawing those in between, and one encoding."""

    def __init__(
        self,
        encode: list[str],
        decode: list[str] | None = None,
        size: tuple[int, int] = (0, 0),
        source_fps: float = 0.0,
        fps: int = 0,
        hold: int = 0,
    ) -> None:
        self._fps = fps
        self._hold = hold
        self._dec: subprocess.Popen[bytes] | None = None
        if decode is None:
            self._enc = subprocess.Popen(
                encode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
            )
        else:
            self._dec = subprocess.Popen(
                decode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
            )
            self._enc = subprocess.Popen(
                encode,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            threading.Thread(
                target=self._feed, args=(size, source_fps), daemon=True
            ).start()

    def _feed(self, size: tuple[int, int], source_fps: float) -> None:
        from sestudio import interpolate

        assert self._dec is not None and self._dec.stdout is not None
        assert self._enc.stdin is not None
        try:
            frames = interpolate.read_frames(self._dec.stdout, *size)
            for frame in interpolate.frames_at(
                frames, source_fps, self._fps, 10**9, self._hold
            ):
                self._enc.stdin.write(frame.tobytes())
            self._enc.stdin.close()
        except (OSError, ValueError):  # stopped mid-write
            pass

    def read(self, size: int) -> bytes:
        assert self._enc.stdout is not None
        return self._enc.stdout.read(size)

    def stop(self) -> None:
        for proc in (self._enc, self._dec):
            if proc is not None:
                proc.kill()
                proc.wait()


#: How far into the film the TV stream has been sent, in seconds.
tv_sent = [0.0]


async def _live_piped(
    start: float,
    settings: Callable[[], TvSettings],
    run_from: Callable[[float, TvSettings], _TvRun],
) -> AsyncIterator[bytes]:
    """A TV stream, chunk by chunk, that follows its settings as they change.

    Each frame is held back until the next one starts, so the TV is only ever
    sent whole frames. *settings* is read between chunks; when it differs, the
    frame held is dropped, the run in progress stopped, and a new one started at
    that frame, its timestamps on the film's clock — the TV sees one stream go
    on: no reconnect, no black, no frame twice or missing. It shows once the TV
    has played what it had buffered.

    Async so a disconnect cancels it at the ``await`` and the ``finally`` runs
    there and then — a TV seeks by dropping the connection and opening another,
    and each one left running would be a 4K decode nobody is watching.
    """
    current = settings()
    tv_sent[0] = start
    run = await asyncio.to_thread(run_from, start, current)
    # Bytes from the frame being held on; this run's first frame's timestamp,
    # which is *start*; and the held frame's.
    held = b""
    first: int | None = None
    holding: int | None = None
    try:
        while chunk := await asyncio.to_thread(run.read, 64 * 1024):
            held += chunk
            starts = frame_starts(held)
            if starts and first is None:
                first = starts[0][1]
            if len(starts) > 1 or (starts and starts[0][0] > 0):
                at, holding = starts[-1]
                yield held[:at]
                held = held[at:]
                if first is not None:
                    tv_sent[0] = start + (holding - first) / 90_000
            wanted = settings()
            if wanted != current:
                if first is not None and holding is not None:
                    start += (holding - first) / 90_000
                await asyncio.to_thread(run.stop)
                current, held, first, holding = wanted, b"", None, None
                run = await asyncio.to_thread(run_from, start, current)
        if held:
            yield held  # the run's end: its last frame is whole
    finally:
        await asyncio.to_thread(run.stop)


#: What a TV is sent at: rung, frame rate, audio track, and the language of
#: the captions burnt in (None for none).
TvSettings = tuple[int, int, int, str | None]


def live_settings(
    request: Request,
    live: str | None,
    rung: int,
    fps: int,
    audio: int = 0,
    lang: str | None = None,
) -> Callable[[], TvSettings]:
    """What a cast with live id *live* is to be sent at now: its settings if
    they were changed while it played, else those it was asked for."""

    def now() -> TvSettings:
        changed = request.app.state.live.get(live) if live else None
        if not changed:
            return rung, fps, audio, lang
        return (
            rung if changed.get("rung") is None else changed["rung"],
            changed.get("fps", fps),
            changed.get("audio", audio),
            changed["lang"] if "lang" in changed else lang,
        )

    return now


def live_audio(request: Request, live: str | None, audio: int) -> int:
    """The audio track a cast with live id *live* is to hear now: changed
    while it played, or *audio* as its URL asks."""
    changed = request.app.state.live.get(live) if live else None
    return audio if not changed else changed.get("audio", audio)


def tv_run_from(
    file: Path | str,
    hdr: bool,
    source_fps: float,
    stream: downloaded.StreamProbe | None = None,
    subtitle_of: Callable[[str], downloaded.Track | Path | None] | None = None,
) -> Callable[[float, TvSettings], _TvRun]:
    """How to start a TV run of *file* from a point, at given settings: the
    captions burnt in are *subtitle_of* their language."""

    def run_from(start: float, settings: TvSettings) -> _TvRun:
        rung, asked, audio, lang = settings
        subtitle = subtitle_of(lang) if lang and subtitle_of else None
        fps, drawn = downloaded.tv_fps(asked, source_fps)
        if drawn:
            return _TvRun(
                downloaded.tv_drawn_encode(
                    file, start, audio, rung, fps, source_fps, stream
                ),
                downloaded.tv_stream_command(
                    file, start, audio, subtitle, hdr, rung, stream, raw=True
                ),
                downloaded.tv_frame(rung),
                source_fps,
                fps,
                load_config().ai_max_hold,
            )
        # Below the source's rate, frames are dropped; at it, nothing to do.
        drop = fps if fps and source_fps and fps < source_fps - 0.5 else 0
        return _TvRun(
            downloaded.tv_stream_command(
                file, start, audio, subtitle, hdr, rung, stream, fps=drop
            )
        )

    return run_from


@router.api_route("/downloaded/tv", methods=["GET", "HEAD"])
async def get_downloaded_tv(
    request: Request,
    path: str = Query(...),
    audio: int = Query(0, ge=0),
    lang: str | None = None,
    rung: int = Query(0, ge=0),
    fps: int = 0,
    live: str | None = None,
) -> Response:
    """A stored file re-encoded for a TV as it is watched, from where it is asked.

    For what a TV will not read as it is — 10-bit HEVC, Dolby Vision, TrueHD,
    old DivX — and for captions, which DLNA has no portable way to carry: the
    *lang* subtitle is burnt into the picture. Nothing is written; ffmpeg's
    output goes straight to the socket.

    Seeking is by time only. The TV asks with ``TimeSeekRange.dlna.org`` and a
    fresh encode starts there, which is why this answers in npt and not bytes.

    With *live*, the rung, frame rate, audio track and captions follow that
    cast's settings as they are changed, without the TV reconnecting (see
    ``_live_piped``).
    """
    target = _resolved(path)
    check_fps(fps)
    duration = await asyncio.to_thread(downloaded.duration_of, target)
    start, headers = tv_seek(request, duration)
    if request.method == "HEAD":
        return Response(media_type=downloaded.TV_MEDIA_TYPE, headers=headers)

    tracks = await asyncio.to_thread(downloaded.tracks_of, target)
    run_from = tv_run_from(
        target,
        tracks.video_hdr,
        tracks.video_fps,
        subtitle_of=lambda wanted: downloaded.tv_subtitle(target, wanted),
    )
    settings = live_settings(request, live, rung, fps, audio, lang)
    return tv_stream(request, start, settings, run_from, headers)


def tv_seek(request: Request, duration: float | None) -> tuple[float, dict[str, str]]:
    """Where a TV asked a re-encoded stream to start, and the DLNA headers that
    answer it."""
    asked = request.headers.get("TimeSeekRange.dlna.org")
    start = (_npt_seconds(asked) if asked else None) or 0.0
    headers = {
        **_CORS_HEADERS,
        "contentFeatures.dlna.org": downloaded.TV_CONTENT_FEATURES,
        "transferMode.dlna.org": request.headers.get(
            "transferMode.dlna.org", "Streaming"
        ),
    }
    if duration:
        start = min(start, max(0.0, duration - 1))
        if asked:
            headers["TimeSeekRange.dlna.org"] = (
                f"npt={start:.3f}-{duration:.3f}/{duration:.3f}"
            )
    return start, headers


def tv_stream(
    request: Request,
    start: float,
    settings: Callable[[], TvSettings],
    run_from: Callable[[float, TvSettings], _TvRun],
    headers: dict[str, str],
) -> StreamingResponse:
    """A TV stream from *start*, answered the way TVs want a seek answered."""
    try:
        downloaded.ffmpeg_binary()
    except RuntimeError as exc:  # no ffmpeg
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # LG webOS seeks with a byte range beside the time range, and drops an
    # answer that is not 206 as unseekable. The bytes are those of the asked
    # time, not that offset — the TV reads its position from the stream — and
    # the end is open, since the stream's length is not known until it ends.
    status = 200
    first = request.headers.get("Range", "").removeprefix("bytes=").split("-")[0]
    if first.isdigit() and int(first) > 0:
        status = 206
        headers["Content-Range"] = f"bytes {first}-{int(first) + 10**12 - 1}/*"
    return StreamingResponse(
        _live_piped(start, settings, run_from),
        status_code=status,
        media_type=downloaded.TV_MEDIA_TYPE,
        headers=headers,
    )


def _track_payload(track: downloaded.Track) -> dict[str, Any]:
    return {
        "index": track.index,
        "codec": track.codec,
        "lang": track.lang,
        "label": track.label,
        "default": track.default,
        "text": track.text,
    }


class Builds:
    """Segments being made in one pool, of each video at one setting at a time.

    Coalesced per segment, so a read-ahead, a retry and a playlist's warm-up
    never start the same encode twice. And the first segment asked for at new
    settings (a quality, a frame rate, a voice) calls off what is still being
    made of that video at others: the player has moved on, and AI frames nobody
    will watch would hold the GPU from the ones it is waiting for. Those not
    started yet answer None; one being drawn stops at its next frame.
    """

    def __init__(self, workers: int, name: str) -> None:
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=name)
        #: Each segment being built: its future, and the event that calls it off.
        self.pending: dict[
            tuple[str, tuple[int, ...], int],
            tuple[Future[Path | None], threading.Event],
        ] = {}
        #: Per video: the settings it was last asked at, its segments built at
        #: them, and which of those a player has been sent.
        self.built: dict[str, tuple[tuple[int, ...], dict[int, Path], set[int]]] = {}
        #: Segments that could not be built, and when: not tried again for
        #: ``RETRY_AFTER`` seconds (see ``failing``).
        self.failed: dict[tuple[str, tuple[int, ...], int], float] = {}

    def failing(self, media: str) -> bool:
        """Whether a segment of *media* failed lately: a host refusing, or a
        source gone. Then nothing more is read ahead of it, and one that failed
        answers None at once — every retry of a player, and each segment
        queued ahead, would otherwise start an encode the host refuses again."""
        now = time.monotonic()
        return any(
            other == media and now - at < RETRY_AFTER
            for (other, _, _), at in list(self.failed.items())
        )

    def queue(
        self,
        media: str,
        settings: tuple[int, ...],
        index: int,
        build: Callable[[], Path | None],
    ) -> Future[Path | None]:
        """The running build of segment *index*, started if it is not going."""
        key = (media, settings, index)
        found = self.pending.get(key)
        if found is not None and not found[1].is_set():
            return found[0]
        self.mark(media, settings)
        # Built already: answered at once rather than in line behind the others.
        # Failed lately: answered at once too, as it was.
        path = self.ready(media, settings, index)
        if path is not None or time.monotonic() - self.failed.get(key, 0) < RETRY_AFTER:
            made: Future[Path | None] = Future()
            made.set_result(path)
            return made
        stop = threading.Event()
        entry = (self.pool.submit(interpolate.cancellable, stop, build), stop)
        self.pending[key] = entry

        def forget(done: Future[Path | None]) -> None:
            # Not a later build of the same segment, started after this was stopped.
            if self.pending.get(key) is entry:
                del self.pending[key]
            built = self.built.get(media)
            path = None if done.exception() else done.result()
            if built and built[0] == settings and path:
                built[1][index] = path
            # Called off is not failed: the player moved on.
            if path is None and not stop.is_set():
                self.failed[key] = time.monotonic()
            else:
                self.failed.pop(key, None)

        entry[0].add_done_callback(forget)
        return entry[0]

    def mark(self, media: str, settings: tuple[int, ...]) -> None:
        """Take *settings* as those *media* is now played at."""
        if self.built.get(media, (None,))[0] == settings:
            return
        for (other, was, _), (_, stop) in list(self.pending.items()):
            if other == media and was != settings:
                stop.set()
        self.built[media] = (settings, {}, set())

    def keep(self, media: str, first: int, last: int) -> None:
        """Call off what is being made of *media* outside *first*..*last*: after
        a seek, the read-ahead of where the player was."""
        for (other, _, index), (_, stop) in list(self.pending.items()):
            if other == media and not first <= index <= last:
                stop.set()

    def call_off(self, media: str) -> None:
        """Call off everything being made of *media*, and forget what was."""
        self.keep(media, 0, -1)
        self.built.pop(media, None)

    def ready(self, media: str, settings: tuple[int, ...], index: int) -> Path | None:
        """Segment *index* of *media* at *settings*, if built and still there."""
        built = self.built.get(media)
        path = built[1].get(index) if built and built[0] == settings else None
        return path if path is not None and path.is_file() else None

    def ahead(self, media: str, position: float) -> float:
        """Seconds of *media* built from *position* on, one segment after another."""
        built = self.built.get(media, ((), {}, set()))[1]
        end = int(position // downloaded.HLS_SEGMENT_SECONDS)
        while end in built:
            end += 1
        return max(0.0, end * downloaded.HLS_SEGMENT_SECONDS - position)

    def beyond(self, media: str, position: float) -> float:
        """Seconds of *media* built past *position*, wherever they fall: drawn
        ones lie past what the player has buffered, not right after it."""
        built = self.built.get(media, ((), {}, set()))[1]
        step = downloaded.HLS_SEGMENT_SECONDS
        return sum(max(0.0, min(step, (i + 1) * step - position)) for i in built)

    def sent_within(self, media: str, start: float, end: float) -> float:
        """Seconds between *start* and *end* sent to the player from here."""
        sent = self.built.get(media, ((), {}, set()))[2]
        step = downloaded.HLS_SEGMENT_SECONDS
        return sum(
            max(0.0, min(end, (i + 1) * step) - max(start, i * step)) for i in sent
        )


#: Segments at the source's rate, scaled to the quality asked, as the player
#: asks for them and read ahead of it. Not on a GPU's queue: a segment is
#: about a second of work, and three at a time keep one viewer's read-ahead
#: from being serialised without letting two take the machine.
RAW = Builds(3, "hls")
#: The same segments at a rate above the source's, drawn by AI from those —
#: one at a time, nearest first. Drawn side by side they share the GPU and
#: each takes as many times longer: a GPU that keeps up overall still finishes
#: each one after the player has gone past it, and none is ever shown.
DRAWN = Builds(1, "hls-ai")

#: Seconds a segment that could not be built is not tried again.
RETRY_AFTER = 10.0

#: Segments made ahead of the one asked for, at the source's rate: the next
#: ones the player asks for answer at once, so its measure of the connection is
#: the connection's and not the encode's, and AI frames have their source at
#: hand. Half a minute, as much as a player buffers.
READ_AHEAD = 5
#: And drawn by AI: as many as the GPU can be asked to make before they are due.
DRAW_AHEAD = 3


#: Where each video plays and when that was said: (position, monotonic time).
PLAYHEAD: dict[str, tuple[float, float]] = {}
#: How long a playhead is believed for: the player says it every few seconds
#: while it waits for AI frames, and stops once they are on screen.
PLAYHEAD_FRESH = 5.0


def playing_segment(media: str) -> int | None:
    """The segment of *media* the player last said it plays, if lately."""
    found = PLAYHEAD.get(media)
    if found is None or time.monotonic() - found[1] > PLAYHEAD_FRESH:
        return None
    return int(found[0] // downloaded.HLS_SEGMENT_SECONDS)


def playhead(media: str, position: float) -> tuple[bool, float, bool]:
    """Note that *media* plays at *position*.

    Says whether to swap: the two segments after the one playing are drawn by
    AI, and the player was sent neither so — it is to fetch them again, and
    show AI frames from the next one on. Neither, not just the first: the
    player may keep that one as it was and refetch from the one after, and a
    swap that has happened must not be asked for again. And says how many
    seconds past the one playing are drawn one after another: as far as the
    player can read ahead without outrunning the GPU. And whether the one
    playing was sent drawn: whether AI frames are on screen.
    """
    PLAYHEAD[media] = (position, time.monotonic())
    index = int(position // downloaded.HLS_SEGMENT_SECONDS)
    built = DRAWN.built.get(media)
    if not built:
        return False, 0.0, False
    settings, _, sent = built
    end = index + 1
    while DRAWN.ready(media, settings, end) is not None:
        end += 1
    ready = (end - index - 1) * downloaded.HLS_SEGMENT_SECONDS
    swap = ready >= 2 * downloaded.HLS_SEGMENT_SECONDS and not (
        {index + 1, index + 2} & sent
    )
    return swap, ready, index in sent


def warm(
    media: str,
    settings: tuple[int, ...],
    draws: bool,
    count: int,
    raw: Callable[[int], Path | None],
) -> None:
    """Start the opening segments of *media* before they are asked for, at the
    source's rate. Not while it plays: a playlist read then — another quality's,
    as the player weighs a switch — would call off what is being made for where
    it plays."""
    if any(other == media for other, _, _ in list(RAW.pending)):
        return
    plain = (*settings[:-1], 0) if draws else settings
    for index in range(min(3, count)):
        RAW.queue(media, plain, index, lambda i=index: raw(i))


async def serve_segment(
    media: str,
    count: int,
    index: int,
    settings: tuple[int, ...],
    draws: bool,
    raw: Callable[[int], Path | None],
    drawn: Callable[[int], Path | None],
) -> Path | None:
    """Segment *index* of *media* (of *count*) for a player, at *settings* —
    whose last is the frame rate.

    With *draws* — a rate above the source's that this machine draws — it is
    the AI one when that is ready, and the source's rate otherwise, at once:
    the player never waits on the GPU, so it never stalls nor reads the wait
    as a slow connection and drops quality. A seek plays at once at the
    source's rate while the frames past it are drawn. The AI one is taken only
    with the next ready too, unless the last was AI already, so playback does
    not flick between the two each segment when the GPU barely keeps up.
    """
    last = min(count - 1, index + READ_AHEAD)
    RAW.keep(media, index - 1, last)
    # Drawn at any rate, from the same segments at the source's: switching
    # between AI rates keeps them.
    plain = (*settings[:-1], 0) if draws else settings

    def raw_build(j: int) -> Future[Path | None]:
        return RAW.queue(media, plain, j, lambda: raw(j))

    asked = raw_build(index)
    if RAW.failing(media):
        # Nothing more asked of a source that is refusing: just this one.
        return await asyncio.wrap_future(asked)
    for j in range(index + 1, last + 1):
        raw_build(j)
    if not draws:
        DRAWN.call_off(media)
        return await asyncio.wrap_future(asked)

    def drawn_build(j: int) -> Callable[[], Path | None]:
        sources = [raw_build(k) for k in (j, j + 1) if k < count]

        def build() -> Path | None:
            for source in sources:
                source.result()  # on disk, then drawn from there
            return drawn(j)

        return build

    DRAWN.mark(media, settings)
    # From just past what plays, where the player says (see ``playhead``): it
    # swaps what it buffered at the source's rate for these as they are ready.
    # Else from just past what it asked for.
    playing = playing_segment(media)
    first = (index if playing is None else min(index, playing)) + 1
    end = index + DRAW_AHEAD
    DRAWN.keep(media, first, end)
    for j in range(first, min(count, end + 1)):
        DRAWN.queue(media, settings, j, drawn_build(j))
    found = DRAWN.ready(media, settings, index)
    sent = DRAWN.built[media][2]
    if found and (
        index - 1 in sent
        or index + 1 >= count
        or DRAWN.ready(media, settings, index + 1)
    ):
        sent.add(index)
        return found
    sent.discard(index)
    return await asyncio.wrap_future(asked)


@router.get("/downloaded/hls")
async def get_downloaded_hls(
    request: Request,
    path: str = Query(...),
    audio: int = 0,
    rung: int | None = None,
    fps: int = 0,
    live: str | None = None,
) -> Response:
    """A playlist for a downloaded file, transcoded as it is played.

    Without *rung*, the master: one entry per quality (see
    ``downloaded.hls_variants``), so the player can drop to a lighter one when
    the link slows and climb back when it recovers. With it, that quality's own
    list of segments.

    A third of a collection put together over years is XviD in an AVI or a
    recording in MPEG-TS, and Chrome will not so much as open the container.
    Converting them all in advance would mean hours of encoding and hundreds of
    gigabytes, so playback goes through HLS instead: this lists every segment of
    the film with its duration, and each one is transcoded only when the player
    actually asks for it.

    Listing them all up front is what makes seeking work. The player knows the
    whole timeline before a frame has been encoded, so a jump to any point
    fetches that one segment rather than waiting for everything before it.
    """
    target = _resolved(path)
    check_fps(fps)
    durations = await asyncio.to_thread(downloaded.hls_segment_durations, target)
    if durations is None:
        raise HTTPException(status_code=404, detail="Length of that file is unknown")
    quoted = quote(path)
    # Only when asked for, so the URLs of the source's own rate stay as they were.
    rate = f"&fps={fps}" if fps else ""
    # A cast's id, carried down to its segments (see ``segment_settings``).
    rate += f"&live={quote(live)}" if live else ""
    variants = await asyncio.to_thread(downloaded.hls_variants, target)
    if rung is None:
        tracks = await asyncio.to_thread(downloaded.tracks_of, target)
        return master_playlist(
            variants,
            f"hls?path={quoted}&audio={audio}{rate}",
            fps,
            tracks.video_fps,
        )
    rung = offered_rung(variants, rung)
    response = media_playlist(
        durations, f"segment?path={quoted}&audio={audio}&rung={rung}{rate}"
    )

    # The opening segments, started now rather than when they are asked for.
    # The player wants the first one within a moment of reading this, and a cold
    # one is most of a second — long enough that its own first attempt at
    # playing gives up for want of data. Begun while the client is still parsing
    # a playlist of a thousand-odd lines, it is usually ready in time.
    # Warmed here rather than on the master, so it is the rung the player
    # actually picked that gets a head start.
    # At a live id's settings, if changed: others would call off its builds.
    rung, fps = await segment_settings(request, live, rung, fps, lambda: variants)
    audio = live_audio(request, live, audio)
    tracks = await asyncio.to_thread(downloaded.tracks_of, target)
    warm(
        path,
        (audio, rung, fps),
        downloaded.draws(fps, tracks.video_fps),
        len(durations),
        lambda i: downloaded.hls_segment(target, path, i, audio, rung, fps),
    )
    return response


async def segment_settings(
    request: Request,
    live: str | None,
    rung: int,
    fps: int,
    variants: Callable[[], list[tuple[int, int, int, int]]],
) -> tuple[int, int]:
    """The rung and frame rate one segment of a cast is made at: those its URL
    asks for, or the cast's own once they have been changed while it plays.

    This is what changes a Chromecast's quality without reloading it: the
    playlists it holds stay as they are, and the next segments it fetches come
    out at the new settings. A changed rung is taken to the nearest this source
    has (*variants*); none leaves the receiver's own choice from the master.
    """
    changed = request.app.state.live.get(live) if live else None
    if not changed:
        return rung, fps
    if changed.get("rung") is not None:
        # None to compare with (a stream that would not probe): as asked.
        if offered := await asyncio.to_thread(variants):
            rung = offered_rung(offered, changed["rung"])
    return rung, changed.get("fps", fps)


FOREVER = "public, max-age=31536000"
LIVE_CACHE = "no-store"


def check_fps(fps: int) -> None:
    if fps and fps not in downloaded.FRAME_RATES:
        raise HTTPException(status_code=422, detail="No such frame rate")


def master_playlist(
    variants: list[tuple[int, int, int, int]],
    uri: str,
    fps: int = 0,
    source_fps: float = 0.0,
) -> Response:
    """An HLS master: one entry per quality, each *uri* with its `&rung=`.

    At an *fps* above *source_fps* each is priced higher, as it is encoded, so
    the player's choice of quality allows for the frames drawn in between.
    """
    rate = fps or source_fps
    scale = (fps / source_fps) ** 0.5 if fps and source_fps and fps > source_fps else 1
    lines = ["#EXTM3U"]
    for step, width, height, bandwidth in variants:
        size = f",RESOLUTION={width}x{height}" if width and height else ""
        frames = f",FRAME-RATE={rate:.3f}" if rate else ""
        lines.append(
            f"#EXT-X-STREAM-INF:BANDWIDTH={int(bandwidth * scale)}{size}{frames}"
        )
        lines.append(f"{uri}&rung={step}")
    return _playlist(lines)


def offered_rung(variants: list[tuple[int, int, int, int]], rung: int) -> int:
    """*rung* if the master offers it, else the nearest it offers below it.

    A fixed choice on a Chromecast asks for 720p of a 480p film. Compared by
    real height, so the source counts at its own size.
    """
    if rung in [step for step, *_ in variants]:
        return rung
    fits = [(height, step) for step, _w, height, _b in variants if height <= rung]
    return max(fits)[1] if fits else variants[-1][0]


def media_playlist(durations: list[float], uri: str) -> Response:
    """Every segment up front, each *uri* with its `&index=`."""
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        f"#EXT-X-TARGETDURATION:{int(downloaded.HLS_SEGMENT_SECONDS) + 1}",
        "#EXT-X-MEDIA-SEQUENCE:0",
        # Says the whole film is there and will not grow, which is what lets the
        # player offer a scrub bar over the full duration.
        "#EXT-X-PLAYLIST-TYPE:VOD",
    ]
    for index, seconds in enumerate(durations):
        lines.append(f"#EXTINF:{seconds:.3f},")
        lines.append(f"{uri}&index={index}")
    lines.append("#EXT-X-ENDLIST")
    return _playlist(lines)


def _playlist(lines: list[str]) -> Response:
    return Response(
        content="\n".join(lines) + "\n",
        media_type="application/vnd.apple.mpegurl",
        headers=dict(_CORS_HEADERS),
    )


@router.api_route("/downloaded/segment", methods=["GET", "HEAD"])
async def get_downloaded_segment(
    request: Request,
    path: str = Query(...),
    index: int = Query(..., ge=0),
    audio: int = 0,
    rung: int = 0,
    fps: int = 0,
    live: str | None = None,
) -> Response:
    """One segment of the playlist above, transcoded now if it is not cached.

    Waited on rather than deferred: the player is asking for the next second of
    what it is playing. Coalesced per segment, so read-ahead and a retry do not
    start the same encode twice.
    """
    target = _resolved(path)
    check_fps(fps)
    rung, fps = await segment_settings(
        request, live, rung, fps, lambda: downloaded.hls_variants(target)
    )
    audio = live_audio(request, live, audio)
    durations = await asyncio.to_thread(downloaded.hls_segment_durations, target)
    tracks = await asyncio.to_thread(downloaded.tracks_of, target) if fps else None
    segment = await serve_segment(
        path,
        len(durations or ()),
        index,
        (audio, rung, fps),
        bool(tracks and downloaded.draws(fps, tracks.video_fps)),
        lambda i: downloaded.hls_segment(target, path, i, audio, rung, fps),
        lambda i: downloaded.hls_drawn(target, path, i, audio, rung, fps),
    )
    if segment is None:
        raise HTTPException(status_code=404, detail="No such segment")
    return FileResponse(
        segment,
        media_type="video/mp2t",
        # Keyed on the file's identity, so a hit stays good until the file
        # itself changes — at which point the segment's own URL changes too.
        # Not under a live id: the same URL comes at another rate once changed.
        headers={**_CORS_HEADERS, "Cache-Control": LIVE_CACHE if live else FOREVER},
    )


@router.get("/downloaded/tracks")
async def get_downloaded_tracks(path: str = Query(...)) -> dict[str, Any]:
    """What is inside one stored file: its audio and subtitle tracks.

    Its own endpoint rather than part of the listing, because each answer costs
    an ffmpeg probe: a shelf of two hundred titles would pay for two hundred
    probes to draw cards that show none of this. Asked for when an episode is
    actually opened, and cached from then on.

    Subtitles come from two places and are returned as one list — tracks inside
    the container, and the `.vtt` files written beside it, which the filesystem
    scan deliberately ignores. Whether a subtitle was muxed in or downloaded
    separately is not something the player should have to care about.
    """
    target = _resolved(path)
    tracks = await asyncio.to_thread(downloaded.tracks_of, target)
    sidecars = await asyncio.to_thread(downloaded.sidecar_subtitles, target)

    subtitles = [
        {
            **_track_payload(track),
            "url": f"/api/downloaded/subtitle?path={quote(path)}&index={track.index}",
            "embedded": True,
        }
        for track in tracks.subtitles
    ]
    subtitles += [
        {
            "index": len(tracks.subtitles) + i,
            "codec": "webvtt",
            "lang": lang,
            "label": lang.upper(),
            "default": False,
            "text": True,
            "url": (
                f"/api/downloaded/subtitle?path={quote(path)}&sidecar={quote(lang)}"
            ),
            "embedded": False,
        }
        for i, (lang, _file) in enumerate(sidecars)
    ]

    return {
        "audio": [_track_payload(track) for track in tracks.audio],
        "subtitles": subtitles,
        # Whether a browser plays the file as it is, its first voice included:
        # then the source's own quality needs no re-encoding at all.
        "playable": await asyncio.to_thread(downloaded.browser_can_play, target),
    }


@router.get("/downloaded/subtitle")
async def get_downloaded_subtitle(
    path: str = Query(...), index: int | None = None, sidecar: str | None = None
) -> FileResponse:
    """One subtitle track as WebVTT, ready for a `<track>` element.

    A sidecar is served as it lies; an embedded track is extracted and cached.
    """
    target = _resolved(path)

    if sidecar is not None:
        match = next(
            (
                file
                for lang, file in await asyncio.to_thread(
                    downloaded.sidecar_subtitles, target
                )
                if lang == sidecar
            ),
            None,
        )
        if match is None:
            raise HTTPException(status_code=404, detail="No such subtitle file")
        return FileResponse(match, media_type="text/vtt", headers=dict(_CORS_HEADERS))

    if index is None:
        raise HTTPException(status_code=400, detail="Pass index= or sidecar=")

    vtt = await asyncio.to_thread(downloaded.extracted_subtitle, target, path, index)
    if vtt is None:
        raise HTTPException(
            status_code=415,
            detail=(
                "That track cannot be shown as text — a picture-based subtitle "
                "(PGS or VOBSUB) can only be burnt into the video."
            ),
        )
    return FileResponse(
        vtt,
        media_type="text/vtt",
        headers={
            **_CORS_HEADERS,
            # Keyed on the file's mtime, size and track, so a hit is good until
            # the file changes — at which point the key, and the URL, change too.
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )


@router.get("/downloaded/thumb")
async def get_downloaded_thumb(path: str = Query(...)) -> FileResponse:
    """A still from a stored file, for a title TMDB has no poster for.

    Generated in the background on first request and cached on disk from then
    on, so a shelf of unmatched titles costs one ffmpeg run each, once. Until it
    is made the answer is 404 with ``Retry-After``; see ``_THUMB_POOL``.
    """
    target = _resolved(path)
    thumb = downloaded.cached_thumbnail(target, path)
    if thumb is None:
        if path not in _THUMBS_PENDING:
            future = _THUMB_POOL.submit(downloaded.thumbnail, target, path)
            _THUMBS_PENDING[path] = future
            future.add_done_callback(lambda _f, p=path: _THUMBS_PENDING.pop(p, None))
        raise HTTPException(
            status_code=404,
            detail="Still not made yet",
            headers={"Retry-After": "3", "Cache-Control": "no-store"},
        )
    return FileResponse(
        thumb,
        media_type="image/jpeg",
        # Keyed on the file's mtime and size, so a hit is good until the file
        # itself changes — at which point the key, and the URL, change too.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.delete("/downloaded/file")
async def delete_downloaded_file(path: str = Query(...)) -> dict[str, str]:
    """Delete one downloaded file, and forget what was recorded about it."""
    # Checked here and not only by hiding the button: anything that can reach
    # the API could otherwise delete from the collection.
    if not load_config().allow_file_deletion:
        raise HTTPException(
            status_code=403, detail="Deleting files is turned off in Settings"
        )
    target = _resolved(path)
    await asyncio.to_thread(target.unlink)
    await asyncio.to_thread(library.delete_downloaded_file, path)
    downloaded.invalidate()
    return {"status": "ok"}
