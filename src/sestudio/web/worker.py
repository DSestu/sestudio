from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from sestudio.downloader import ProgressEvent, download
from sestudio.models import StreamSource
from sestudio.providers.base import ProviderError, StreamProvider

logger = logging.getLogger(__name__)

JobStatus = Literal["queued", "downloading", "done", "failed", "cancelled"]


@dataclass
class DownloadJob:
    id: str
    episode_name: str
    source: StreamSource
    output_path: Path
    all_providers: dict[str, str] = field(default_factory=dict)
    tried_providers: list[str] = field(default_factory=list)
    status: JobStatus = "queued"
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    error: str | None = None


class JobStore:
    def __init__(
        self,
        max_workers: int = 20,
        provider_registry: dict[str, StreamProvider] | None = None,
    ) -> None:
        self._jobs: dict[str, DownloadJob] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max_workers)
        self._providers: dict[str, StreamProvider] = provider_registry or {}

    def submit(
        self,
        source: StreamSource,
        output_path: Path,
        episode_name: str,
        all_providers: dict[str, str] | None = None,
    ) -> DownloadJob:
        job = DownloadJob(
            id=str(uuid.uuid4()),
            episode_name=episode_name,
            source=source,
            output_path=output_path,
            all_providers=dict(all_providers or {}),
            tried_providers=[source.provider],
        )
        cancel_event = threading.Event()
        with self._lock:
            self._jobs[job.id] = job
            self._cancel_events[job.id] = cancel_event
        self._pool.submit(self._run, job.id)
        logger.debug("Queued job %s for %s", job.id, episode_name)
        return job

    def cancel(self, job_id: str) -> bool:
        """Cancel a queued or downloading job, clean up partial files. Returns True if found."""
        from sestudio.downloader import _cleanup

        with self._lock:
            job = self._jobs.get(job_id)
            event = self._cancel_events.get(job_id)
            if job is None:
                return False
            if job.status in ("done", "failed", "cancelled"):
                return False
            job.status = "cancelled"
        if event:
            event.set()
        if job:
            _cleanup(job.output_path)
            logger.info("Cancelled job %s (%s)", job_id, job.episode_name)
        return True

    def clear_terminal(self) -> int:
        """Remove done/failed/cancelled jobs from the store. Returns count removed."""
        terminal = {"done", "failed", "cancelled"}
        with self._lock:
            to_remove = [jid for jid, j in self._jobs.items() if j.status in terminal]
            for jid in to_remove:
                del self._jobs[jid]
                self._cancel_events.pop(jid, None)
        logger.info("Cleared %d terminal jobs", len(to_remove))
        return len(to_remove)

    def get(self, job_id: str) -> DownloadJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def all_jobs(self) -> list[DownloadJob]:
        with self._lock:
            return list(self._jobs.values())

    def _run(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            cancel_event = self._cancel_events.get(job_id)
        if job is None:
            return

        # Job may have been cancelled before it even started
        if cancel_event and cancel_event.is_set():
            return

        self._set_status(job_id, "downloading")

        def on_progress(ev: ProgressEvent) -> None:
            with self._lock:
                j = self._jobs.get(job_id)
                if j:
                    j.progress = ev.percent
                    j.speed = ev.speed
                    j.eta = ev.eta

        while True:
            if cancel_event and cancel_event.is_set():
                return

            try:
                ok = download(
                    job.source,
                    job.output_path,
                    on_progress=on_progress,
                    cancel_event=cancel_event,
                )
            except Exception as exc:
                logger.error("Job %s failed: %s", job_id, exc)
                ok = False

            if cancel_event and cancel_event.is_set():
                return

            if ok:
                self._set_status(job_id, "done", progress=100.0)
                return

            # Try the next untried provider
            next_source = self._resolve_next_provider(job)
            if next_source is None:
                self._set_status(job_id, "failed", error="All providers failed")
                return

            logger.warning(
                "Provider %s failed for %s, falling back to %s",
                job.source.provider,
                job.episode_name,
                next_source.provider,
            )
            with self._lock:
                job.source = next_source
                job.progress = 0.0
                job.speed = ""
                job.eta = ""

    def _resolve_next_provider(self, job: DownloadJob) -> StreamSource | None:
        for pname, purl in job.all_providers.items():
            if pname in job.tried_providers:
                continue
            handler = self._providers.get(pname)
            if handler is None:
                job.tried_providers.append(pname)
                continue
            try:
                source = handler.get_stream_url(purl)
                job.tried_providers.append(pname)
                return source
            except ProviderError as exc:
                logger.warning(
                    "Fallback provider %s failed for %s: %s",
                    pname,
                    job.episode_name,
                    exc,
                )
                job.tried_providers.append(pname)
        return None

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
