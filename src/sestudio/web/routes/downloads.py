from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import urllib.parse
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from sestudio.config import load_config
from sestudio.http_client import BROWSER_UA, new_client
from sestudio.models import StreamSource, sanitize_path_component
from sestudio.providers.base import ProviderError
from sestudio.sites import ContentSite, SiteError, StreamCandidate, site_for
from sestudio.web.proxy import TokenError, verify
from sestudio.web.worker import DownloadJob

logger = logging.getLogger(__name__)
router = APIRouter()


class DownloadRequest(BaseModel):
    embed_url: str
    provider: str
    episode_name: str
    series_name: str
    season: int
    lang: str = ""  # VF / VOSTFR / VO — becomes a subfolder in the output path
    # All available providers for this episode, in priority order
    all_providers: dict[str, str] = {}
    # Download for the browser to collect afterwards instead of into the
    # library: the file goes to a temp dir and is served by /downloads/{id}/file.
    to_device: bool = False
    # Id of the ContentSite that produced the embeds; it owns their resolution.
    source: str = "fstream"


def _episode_path(root: str, item: DownloadRequest, site: ContentSite) -> Path:
    """Build the output file path, with a per-language subfolder.

    ``<root>/<Series>/Season NN/<LANG>/<file>`` for episodes, or
    ``<root>/<site films dir>/<LANG>/<file>`` for films. The language folder is
    omitted when no language is given (e.g. CLI downloads).
    """
    safe_ep = sanitize_path_component(item.episode_name)
    if item.season == 0:
        parts = [root, site.films_dirname]
    else:
        parts = [
            root,
            sanitize_path_component(item.series_name),
            f"Season {item.season:02d}",
        ]
    if item.lang:
        parts.append(sanitize_path_component(item.lang.upper()))
    return Path(*parts) / safe_ep


def _job_to_dict(job: DownloadJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "episode_name": job.episode_name,
        "status": job.status,
        "progress": job.progress,
        "speed": job.speed,
        "eta": job.eta,
        "error": job.error,
        "phase": job.phase,
        "detail": job.detail,
        "total_size": job.total_size,
        "fragment": job.fragment,
        "provider": job.source.provider,
        "to_device": job.to_device,
    }


def _attachment_headers(filename: str) -> dict[str, str]:
    """Content-Disposition per RFC 6266: ASCII fallback + UTF-8 full name."""
    ascii_name = filename.encode("ascii", "replace").decode("ascii").replace('"', "")
    return {
        "Content-Disposition": (
            f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{urllib.parse.quote(filename)}"
        )
    }


@router.get("/downloads/{job_id}/file")
def download_job_file(job_id: str, request: Request) -> FileResponse:
    """Serve a finished device-bound job's file to the browser.

    HLS can't be relayed as a single file on the fly, so those downloads run as
    a normal server job first (real progress, provider fallback, retries) and
    the browser fetches the result here once it's done.
    """
    store = request.app.state.job_store
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "done":
        raise HTTPException(
            status_code=409, detail=f"Job is not finished (status: {job.status})"
        )
    if not job.output_path.exists():
        raise HTTPException(status_code=410, detail="File is no longer available")
    return FileResponse(
        job.output_path,
        media_type="video/mp4",
        headers=_attachment_headers(job.episode_name),
    )


@router.get("/downloads/stream")
def download_stream(token: str, filename: str, request: Request) -> StreamingResponse:
    """Forward an already-resolved stream to the client as a file download.

    "Download to this device": the browser can't fetch provider streams itself
    (they need the provider Referer/UA the server injects), so this endpoint
    relays the bytes with a ``Content-Disposition: attachment`` header. The
    stream is identified by the same HMAC-sealed token the play proxy uses, so
    the raw upstream URL never reaches the client and only URLs this process
    resolved can be downloaded.

    HLS sources need an ffmpeg remux to become a single file — not supported
    yet, so they get a 501 (the UI offers a server download instead).
    """
    secret = request.app.state.proxy_secret
    try:
        payload = verify(secret, token)
    except TokenError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    target_url: str = payload["u"]
    referer: str = payload["r"]

    safe_name = sanitize_path_component(filename).strip() or "video.mp4"
    if not safe_name.lower().endswith(".mp4"):
        safe_name += ".mp4"

    # HLS is a playlist of segments, not a file — it can't be relayed directly.
    # The UI routes those through a server job instead (see /downloads/{id}/file).
    if ".m3u8" in urllib.parse.urlparse(target_url).path.lower():
        raise HTTPException(
            status_code=409,
            detail="HLS sources are downloaded via a server job, not relayed",
        )

    upstream_headers = {
        "User-Agent": BROWSER_UA,
        "Referer": referer,
        "Accept-Encoding": "identity",
        # Mirrors the play proxy: some CDNs 403 without browser-like headers.
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
    }
    client = new_client(headers=upstream_headers)
    req = client.build_request("GET", target_url)
    upstream = client.send(req, stream=True)
    if upstream.status_code >= 400:
        upstream.close()
        client.close()
        raise HTTPException(
            status_code=502, detail=f"Upstream returned HTTP {upstream.status_code}"
        )

    relay = {
        **_attachment_headers(safe_name),
        "Content-Type": upstream.headers.get("content-type", "video/mp4"),
    }
    if "content-length" in upstream.headers:
        relay["Content-Length"] = upstream.headers["content-length"]

    def body() -> Iterator[bytes]:
        try:
            yield from upstream.iter_bytes()
        finally:
            upstream.close()
            client.close()

    return StreamingResponse(body(), status_code=200, headers=relay)


@router.post("/downloads/check")
async def check_downloads(items: list[DownloadRequest], request: Request) -> list[str]:
    """Return episode_names that already exist on disk."""
    cfg = load_config()
    sites = request.app.state.sites
    existing: list[str] = []
    for item in items:
        out_path = _episode_path(cfg.output_root, item, site_for(sites, item.source))
        if out_path.exists() and out_path.stat().st_size > 0:
            existing.append(item.episode_name)
    return existing


@router.post("/downloads")
async def post_downloads(
    items: list[DownloadRequest],
    request: Request,
) -> list[dict[str, Any]]:
    store = request.app.state.job_store
    cfg = load_config()
    results: list[dict[str, Any]] = []

    providers = store._providers
    sites = request.app.state.sites

    for item in items:
        site = site_for(sites, item.source)
        # Build ordered candidate list: primary provider first, then the rest
        # in the site's preference order.
        candidates = [
            c
            for c in site.stream_candidates(item.all_providers)
            if c.provider != item.provider
        ]
        if item.provider and item.embed_url:
            candidates.insert(0, StreamCandidate(item.provider, item.embed_url))

        source: StreamSource | None = None
        last_error: str = "No supported provider available"
        tried: list[str] = []
        for cand in candidates:
            try:
                source = await asyncio.to_thread(
                    site.resolve_candidate, cand, providers
                )
                tried.append(cand.provider)
                logger.debug("Resolved %s via %s", item.episode_name, cand.provider)
                break
            except (ProviderError, SiteError) as exc:
                last_error = str(exc)
                tried.append(cand.provider)
                logger.warning(
                    "Provider %s failed for %s: %s — trying next",
                    cand.provider,
                    item.episode_name,
                    exc,
                )

        if source is None:
            logger.warning("Could not resolve %s: %s", item.episode_name, last_error)
            results.append({"episode_name": item.episode_name, "error": last_error})
            continue

        safe_ep = sanitize_path_component(item.episode_name)
        if item.to_device:
            # Staged in a temp dir for the browser to collect; never treated as
            # part of the library, so the "already downloaded" check is skipped.
            out_path = Path(tempfile.mkdtemp(prefix="sestudio-device-")) / safe_ep
        else:
            out_path = _episode_path(cfg.output_root, item, site)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if not item.to_device:
            if out_path.exists() and out_path.stat().st_size > 0:
                logger.info(
                    "Skipping %s: already exists at %s", item.episode_name, out_path
                )
                results.append(
                    {
                        "episode_name": item.episode_name,
                        "status": "skipped",
                        "error": None,
                    }
                )
                continue

            # Remove any 0-byte remnant from a previous failed attempt
            if out_path.exists():
                out_path.unlink()

        # Pass all_providers so the worker can fall back if the initial download fails
        remaining_providers = {
            k: v for k, v in item.all_providers.items() if k not in tried
        }
        job = store.submit(
            source,
            out_path,
            safe_ep,
            all_providers=remaining_providers,
            to_device=item.to_device,
            site_id=site.id,
        )
        results.append(_job_to_dict(job))

    return results


@router.get("/downloads")
async def get_downloads(request: Request) -> list[dict[str, Any]]:
    store = request.app.state.job_store
    return [_job_to_dict(j) for j in store.all_jobs()]


@router.delete("/downloads")
async def clear_history(request: Request) -> dict[str, Any]:
    store = request.app.state.job_store
    count = store.clear_terminal()
    return {"cleared": count}


@router.delete("/downloads/{job_id}")
async def cancel_download(job_id: str, request: Request) -> dict[str, Any]:
    store = request.app.state.job_store
    found = store.cancel(job_id)
    if not found:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Job not found or already terminal")
    return {"id": job_id, "status": "cancelled"}


@router.get("/downloads/{job_id}/progress")
async def job_progress(job_id: str, request: Request) -> StreamingResponse:
    store = request.app.state.job_store

    async def event_stream() -> Any:
        while True:
            if await request.is_disconnected():
                break
            job = store.get(job_id)
            if job is None:
                yield f"data: {json.dumps({'error': 'not found'})}\n\n"
                break
            # Same shape as the list endpoint so both stay in sync as fields grow.
            payload = json.dumps(_job_to_dict(job))
            yield f"data: {payload}\n\n"
            if job.status in ("done", "failed", "cancelled"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
