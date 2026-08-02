import { useEffect, useRef, useState } from 'react'
import type { DownloadJob } from './api'
import { cancelJob, clearHistory, getJobs, jobFileUrl, subscribeJobProgress } from './api'

export interface DownloadJobsApi {
  jobs: DownloadJob[]
  /** Jobs still queued or downloading — drives the nav badge. */
  activeCount: number
  cancel: (id: string) => void
  clear: () => void
}

const TERMINAL = new Set(['done', 'failed', 'skipped', 'cancelled'])

/**
 * Owns the download queue: initial fetch, per-job SSE progress, cancellation,
 * and handing finished device-bound files to the browser. Lifted out of
 * DownloadQueue so the shell can badge the Downloads tab without duplicating
 * the subscriptions.
 */
export function useDownloadJobs(refreshTrigger: number, onClearHistory: () => void): DownloadJobsApi {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const subscriptions = useRef<Record<string, () => void>>({})
  // Device-bound jobs already handed to the browser, so a re-render or a
  // second SSE 'done' event doesn't download the same file twice.
  const delivered = useRef<Set<string>>(new Set())

  /** Hand a finished device-bound job's file to the browser. */
  function deliverToDevice(job: DownloadJob) {
    if (delivered.current.has(job.id)) return
    delivered.current.add(job.id)
    const a = document.createElement('a')
    a.href = jobFileUrl(job.id)
    a.download = job.episode_name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  useEffect(() => {
    getJobs().then(setJobs).catch(() => {})
  }, [refreshTrigger])

  useEffect(() => {
    jobs.forEach(job => {
      if (subscriptions.current[job.id]) return
      if (TERMINAL.has(job.status)) return

      subscriptions.current[job.id] = subscribeJobProgress(
        job.id,
        (data) => {
          setJobs(prev => prev.map(j => {
            if (j.id !== job.id) return j
            const next = { ...j, ...data } as DownloadJob
            // The file only exists once the job finishes — collect it then.
            if (next.to_device && next.status === 'done') deliverToDevice(next)
            return next
          }))
        },
        () => { delete subscriptions.current[job.id] },
      )
    })
  }, [jobs])

  function cancel(id: string) {
    cancelJob(id).then(() => {
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' as const } : j))
    }).catch(() => {})
  }

  function clear() {
    clearHistory().then(() => {
      setJobs(prev => prev.filter(j => !TERMINAL.has(j.status)))
      onClearHistory()
    }).catch(() => {})
  }

  return {
    jobs,
    activeCount: jobs.filter(j => j.status === 'queued' || j.status === 'downloading').length,
    cancel,
    clear,
  }
}
