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
    # Downloaded on the server for the browser to fetch afterwards (rather than
    # kept in the library), so the file lives in a temp dir and is served once.
    to_device: bool = False
    status: JobStatus = "queued"
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    error: str | None = None
    # Verbosity: what the job is doing beyond the percentage.
    phase: str = ""  # downloading | processing | retrying | resolving
    detail: str = ""  # human-readable note for the current phase
    total_size: str = ""  # e.g. "412.53MiB", as reported by yt-dlp
    fragment: str = ""  # HLS fragment counter, e.g. "42/318"


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
        to_device: bool = False,
    ) -> DownloadJob:
        job = DownloadJob(
            id=str(uuid.uuid4()),
            episode_name=episode_name,
            source=source,
            output_path=output_path,
            all_providers=dict(all_providers or {}),
            tried_providers=[source.provider],
            to_device=to_device,
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
                job = self._jobs[jid]
                # Device-bound files live in a temp dir purely to be served to
                # the browser — drop them with the job so they don't pile up.
                if job.to_device:
                    try:
                        job.output_path.unlink(missing_ok=True)
                    except OSError as exc:  # pragma: no cover — best effort
                        logger.debug("Could not remove %s: %s", job.output_path, exc)
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
                    j.phase = "downloading"
                    if ev.total_size:
                        j.total_size = ev.total_size
                    j.fragment = ev.fragment

        def on_status(phase: str, detail: str) -> None:
            with self._lock:
                j = self._jobs.get(job_id)
                if j:
                    # "failed" here is advisory: a fallback provider may still
                    # succeed, so only the note is kept — the status is set by
                    # the run loop once every provider has been tried.
                    j.phase = phase
                    j.detail = detail
                    if phase == "failed":
                        j.error = detail

        while True:
            if cancel_event and cancel_event.is_set():
                return

            try:
                ok = download(
                    job.source,
                    job.output_path,
                    on_progress=on_progress,
                    cancel_event=cancel_event,
                    on_status=on_status,
                )
            except Exception as exc:
                logger.error("Job %s failed: %s", job_id, exc)
                on_status("failed", str(exc))
                ok = False

            if cancel_event and cancel_event.is_set():
                return

            if ok:
                with self._lock:
                    j = self._jobs.get(job_id)
                    if j:
                        j.phase = ""
                        j.detail = ""
                self._set_status(job_id, "done", progress=100.0)
                return

            # Try the next untried provider
            with self._lock:
                last_detail = job.detail
            self._set_status(job_id, "downloading")  # keep the row non-terminal
            next_source = self._resolve_next_provider(job)
            if next_source is None:
                tried = ", ".join(job.tried_providers) or "none"
                reason = f" — {last_detail}" if last_detail else ""
                self._set_status(
                    job_id,
                    "failed",
                    error=f"All providers failed ({tried}){reason}",
                )
                return

            logger.warning(
                "Provider %s failed for %s, falling back to %s",
                job.source.provider,
                job.episode_name,
                next_source.provider,
            )
            with self._lock:
                previous = job.source.provider
                job.source = next_source
                job.progress = 0.0
                job.speed = ""
                job.eta = ""
                job.total_size = ""
                job.fragment = ""
                job.phase = "retrying"
                job.detail = f"{previous} failed — trying {next_source.provider}"

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
