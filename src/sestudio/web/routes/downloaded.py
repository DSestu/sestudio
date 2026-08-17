"""The downloaded library: what is on disk, and serving it back.

Listing merges two sources — the filesystem scan (:mod:`sestudio.downloaded`),
which decides what exists, and the ``downloaded_files`` manifest, which carries
what a path cannot say (the unsanitised series name, the poster, the page it
came from). Anything the tool did not download has no manifest row at all, so
the path is the whole of what is known about it.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

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


@router.api_route("/downloaded/file", methods=["GET", "HEAD"])
async def get_downloaded_file(path: str = Query(...)) -> FileResponse:
    """Stream a downloaded file.

    No ``filename`` is passed, so the response carries no ``Content-Disposition``
    and plays inline instead of downloading — the opposite of the job-file route.
    Range handling comes from FileResponse itself, which is what makes seeking
    work in the browser.

    HEAD is registered explicitly: a DLNA renderer probes with it before playing,
    and ``@router.get`` alone answers it with 405.
    """
    target = _resolved(path)
    return FileResponse(
        target,
        # By extension: a collection that predates this tool is full of mkv and
        # avi, and calling those mp4 would mislead every player that trusts it.
        media_type=downloaded.media_type_for(target),
        headers=_CORS_HEADERS,
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
