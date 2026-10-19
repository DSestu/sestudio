"""The downloaded library: what is on disk, and serving it back.

Listing merges two sources — the filesystem scan (:mod:`sestudio.downloaded`),
which decides what exists, and the ``downloaded_files`` manifest, which carries
what a path cannot say (the unsanitised series name, the poster, the page it
came from). Anything the tool did not download has no manifest row at all, so
the path is the whole of what is known about it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse

from sestudio import library, downloaded
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

# Rebuilt-audio copies likewise: one at a time, because a re-encode is a CPU
# core for minutes and two at once would only make both slower. The browser
# polls ``/downloaded/audio`` and plays once the copy exists.
_AUDIO_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="audio")
_AUDIO_PENDING: dict[str, Future[Path | None]] = {}

# On-the-fly segments for a file no browser will open. Unlike the two pools
# above these are waited on rather than answered with a 404: the player has
# asked for bytes it is about to play, and a segment is under a second of work.
# Three at a time, so one viewer's read-ahead is not serialised and two viewers
# cannot take the machine.
_HLS_POOL = ThreadPoolExecutor(max_workers=3, thread_name_prefix="hls")
_HLS_PENDING: dict[str, Future[Path | None]] = {}

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
        # re-encode. The browser asks ``/downloaded/audio`` first and only comes
        # here once that says ready; a renderer that comes straight here waits.
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


def _track_payload(track: downloaded.Track) -> dict[str, Any]:
    return {
        "index": track.index,
        "codec": track.codec,
        "lang": track.lang,
        "label": track.label,
        "default": track.default,
        "text": track.text,
    }


@router.get("/downloaded/audio")
async def get_downloaded_audio_ready(
    path: str = Query(...), index: int = Query(..., ge=0)
) -> dict[str, Any]:
    """Whether the copy carrying audio track *index* exists yet — and if not,
    start making it in the background.

    The file route builds the copy itself when asked, but that means waiting on
    ffmpeg inside the request: seconds for a copy, minutes for the re-encode an
    AC-3 track needs, and the player's decode check gives up long before. So the
    browser asks here, polls until ``ready``, and only then loads the file.
    A first track that plays as it is needs no copy and is ready at once.
    """
    target = _resolved(path)
    tracks = await asyncio.to_thread(downloaded.tracks_of, target)
    if index >= len(tracks.audio):
        raise HTTPException(status_code=404, detail="No such audio track")
    if index == 0 and downloaded.browser_plays(tracks.audio[0].codec):
        return {"ready": True, "failed": False, "progress": None}
    if downloaded.cached_alternate_audio(target, path, index) is not None:
        return {"ready": True, "failed": False, "progress": None}
    key = f"{path}|{index}"
    future = _AUDIO_PENDING.get(key)
    if future is None:
        future = _AUDIO_POOL.submit(downloaded.alternate_audio, target, path, index)
        _AUDIO_PENDING[key] = future
        # A build that worked is forgotten here: the file on disk is its record,
        # and if that is ever cleared the next ask rebuilds it. One that failed
        # stays on record, or the next poll would queue the same doomed encode
        # again, every few seconds, for ever.
        future.add_done_callback(
            lambda f, k=key: f.result() is not None and _AUDIO_PENDING.pop(k, None)
        )
    failed = future.done() and future.result() is None
    return {
        "ready": False,
        "failed": failed,
        # 0..1 while ffmpeg runs; None while it is still queued behind another.
        "progress": downloaded.audio_progress(target, path, index),
    }


def _queue_segment(
    target: Path, path: str, index: int, audio: int
) -> Future[Path | None]:
    """The running build for one segment, started if it is not already going.

    Coalesced per segment, so a read-ahead, a retry and the warm-up below never
    start the same encode twice.
    """
    key = f"{path}|{index}|{audio}"
    future = _HLS_PENDING.get(key)
    if future is None:
        future = _HLS_POOL.submit(downloaded.hls_segment, target, path, index, audio)
        _HLS_PENDING[key] = future
        future.add_done_callback(lambda _f, k=key: _HLS_PENDING.pop(k, None))
    return future


@router.get("/downloaded/hls")
async def get_downloaded_hls(path: str = Query(...), audio: int = 0) -> Response:
    """A playlist for a file a browser cannot open, transcoded as it is played.

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
    durations = await asyncio.to_thread(downloaded.hls_segment_durations, target)
    if durations is None:
        raise HTTPException(status_code=404, detail="Length of that file is unknown")
    quoted = quote(path)
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
        lines.append(f"segment?path={quoted}&index={index}&audio={audio}")
    lines.append("#EXT-X-ENDLIST")

    # The opening segments, started now rather than when they are asked for.
    # The player wants the first one within a moment of reading this, and a cold
    # one is most of a second — long enough that its own first attempt at
    # playing gives up for want of data. Begun while the client is still parsing
    # a playlist of a thousand-odd lines, it is usually ready in time.
    for index in range(min(3, len(durations))):
        _queue_segment(target, path, index, audio)
    return Response(
        content="\n".join(lines) + "\n",
        media_type="application/vnd.apple.mpegurl",
        headers=dict(_CORS_HEADERS),
    )


@router.api_route("/downloaded/segment", methods=["GET", "HEAD"])
async def get_downloaded_segment(
    path: str = Query(...), index: int = Query(..., ge=0), audio: int = 0
) -> Response:
    """One segment of the playlist above, transcoded now if it is not cached.

    Waited on rather than deferred: the player is asking for the next second of
    what it is playing. Coalesced per segment, so read-ahead and a retry do not
    start the same encode twice.
    """
    target = _resolved(path)
    segment = await asyncio.wrap_future(_queue_segment(target, path, index, audio))
    if segment is None:
        raise HTTPException(status_code=404, detail="No such segment")
    return FileResponse(
        segment,
        media_type="video/mp2t",
        # Keyed on the file's identity, so a hit stays good until the file
        # itself changes — at which point the segment's own URL changes too.
        headers={**_CORS_HEADERS, "Cache-Control": "public, max-age=31536000"},
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
        # Whether playback has to go through the HLS route above rather than
        # the file itself. Answered here because the view already asks for this
        # before it plays anything, so it costs no extra round trip.
        "needs_hls": not downloaded.browser_can_play(target),
        "audio": [
            {
                **_track_payload(track),
                # Whether a browser plays the codec as it is. False means the
                # track is only heard through the rebuilt copy (see
                # ``/downloaded/audio``), so the client asks for that instead.
                "native": downloaded.browser_plays(track.codec),
            }
            for track in tracks.audio
        ],
        "subtitles": subtitles,
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
    target = _resolved(path)
    await asyncio.to_thread(target.unlink)
    await asyncio.to_thread(library.delete_downloaded_file, path)
    downloaded.invalidate()
    return {"status": "ok"}
