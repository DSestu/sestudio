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
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse

from sestudio import library, downloaded
from sestudio.config import load_config

router = APIRouter()

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
    if audio:
        alternate = await asyncio.to_thread(
            downloaded.alternate_audio, target, path, audio
        )
        if alternate is None:
            raise HTTPException(
                status_code=404, detail="No such audio track, or it could not be built"
            )
        target = alternate
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

    Generated on first request and cached on disk from then on, so a shelf of
    unmatched titles costs one ffmpeg run each, once.
    """
    target = _resolved(path)
    thumb = await asyncio.to_thread(downloaded.thumbnail, target, path)
    if thumb is None:
        raise HTTPException(status_code=404, detail="No still could be made")
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
