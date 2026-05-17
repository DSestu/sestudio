from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from fstream_dl.config import load_config
from fstream_dl.providers.base import ProviderError
from fstream_dl.web.worker import DownloadJob

logger = logging.getLogger(__name__)
router = APIRouter()


class DownloadRequest(BaseModel):
    embed_url: str
    provider: str
    episode_name: str
    series_name: str
    season: int
    # All available providers for this episode, in priority order
    all_providers: dict[str, str] = {}


def _job_to_dict(job: DownloadJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "episode_name": job.episode_name,
        "status": job.status,
        "progress": job.progress,
        "speed": job.speed,
        "eta": job.eta,
        "error": job.error,
    }


@router.post("/downloads/check")
async def check_downloads(items: list[DownloadRequest]) -> list[str]:
    """Return episode_names that already exist on disk."""
    cfg = load_config()
    existing: list[str] = []
    for item in items:
        if item.season == 0:
            out_path = Path(cfg.output_root) / "fstream_films" / item.episode_name
        else:
            safe_series = item.series_name.replace("/", "-").replace("\\", "-").strip()
            out_path = Path(cfg.output_root) / safe_series / f"Season {item.season:02d}" / item.episode_name
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

    for item in items:
        # Build ordered candidate list: primary provider first, then the rest
        candidates: list[tuple[str, str]] = []
        if item.provider and item.embed_url:
            candidates.append((item.provider, item.embed_url))
        for pname, purl in item.all_providers.items():
            if pname != item.provider:
                candidates.append((pname, purl))

        source: StreamSource | None = None
        last_error: str = "No supported provider available"
        tried: list[str] = []
        for pname, purl in candidates:
            handler = providers.get(pname)
            if handler is None:
                logger.debug("Skipping unsupported provider %r for %s", pname, item.episode_name)
                tried.append(pname)
                continue
            try:
                source = await asyncio.to_thread(handler.get_stream_url, purl)
                tried.append(pname)
                logger.debug("Resolved %s via %s", item.episode_name, pname)
                break
            except ProviderError as exc:
                last_error = str(exc)
                tried.append(pname)
                logger.warning("Provider %s failed for %s: %s — trying next", pname, item.episode_name, exc)

        if source is None:
            logger.warning("Could not resolve %s: %s", item.episode_name, last_error)
            results.append({"episode_name": item.episode_name, "error": last_error})
            continue

        if item.season == 0:
            out_dir = Path(cfg.output_root) / "fstream_films"
        else:
            safe_series = item.series_name.replace("/", "-").replace("\\", "-").strip()
            out_dir = Path(cfg.output_root) / safe_series / f"Season {item.season:02d}"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / item.episode_name

        if out_path.exists() and out_path.stat().st_size > 0:
            logger.info("Skipping %s: already exists at %s", item.episode_name, out_path)
            results.append({"episode_name": item.episode_name, "status": "skipped", "error": None})
            continue

        # Remove any 0-byte remnant from a previous failed attempt
        if out_path.exists():
            out_path.unlink()

        # Pass all_providers so the worker can fall back if the initial download fails
        remaining_providers = {k: v for k, v in item.all_providers.items() if k not in tried}
        job = store.submit(source, out_path, item.episode_name, all_providers=remaining_providers)
        results.append(_job_to_dict(job))

    return results


@router.get("/downloads")
async def get_downloads(request: Request) -> list[dict[str, Any]]:
    store = request.app.state.job_store
    return [_job_to_dict(j) for j in store.all_jobs()]


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
            payload = json.dumps({
                "status": job.status,
                "progress": job.progress,
                "speed": job.speed,
                "eta": job.eta,
                "error": job.error,
            })
            yield f"data: {payload}\n\n"
            if job.status in ("done", "failed"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
