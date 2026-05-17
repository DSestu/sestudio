from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from fstream_dl.downloader import ProgressEvent, download
from fstream_dl.models import StreamSource

logger = logging.getLogger(__name__)

JobStatus = Literal["queued", "downloading", "done", "failed"]


@dataclass
class DownloadJob:
    id: str
    episode_name: str
    source: StreamSource
    output_path: Path
    status: JobStatus = "queued"
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    error: str | None = None


class JobStore:
    def __init__(self, max_workers: int = 20) -> None:
        self._jobs: dict[str, DownloadJob] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max_workers)

    def submit(self, source: StreamSource, output_path: Path, episode_name: str) -> DownloadJob:
        job = DownloadJob(
            id=str(uuid.uuid4()),
            episode_name=episode_name,
            source=source,
            output_path=output_path,
        )
        with self._lock:
            self._jobs[job.id] = job
        self._pool.submit(self._run, job.id)
        logger.debug("Queued job %s for %s", job.id, episode_name)
        return job

    def get(self, job_id: str) -> DownloadJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def all_jobs(self) -> list[DownloadJob]:
        with self._lock:
            return list(self._jobs.values())

    def _run(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return

        self._set_status(job_id, "downloading")

        def on_progress(ev: ProgressEvent) -> None:
            with self._lock:
                j = self._jobs.get(job_id)
                if j:
                    j.progress = ev.percent
                    j.speed = ev.speed
                    j.eta = ev.eta

        try:
            ok = download(job.source, job.output_path, on_progress=on_progress)
        except Exception as exc:
            logger.error("Job %s failed: %s", job_id, exc)
            self._set_status(job_id, "failed", error=str(exc))
            return

        if ok:
            self._set_status(job_id, "done", progress=100.0)
        else:
            self._set_status(job_id, "failed")

    def _set_status(
        self,
        job_id: str,
        status: JobStatus,
        progress: float | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = status
                if progress is not None:
                    job.progress = progress
                if error is not None:
                    job.error = error
