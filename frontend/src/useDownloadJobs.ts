import { useEffect, useRef, useState } from 'react'
import type { DownloadJob } from './api'
import { cancelJob, clearHistory, getJobs, jobFileUrl } from './api'

export interface DownloadJobsApi {
  jobs: DownloadJob[]
  /** Jobs still queued or downloading — drives the nav badge. */
  activeCount: number
  cancel: (id: string) => void
  clear: () => void
}

const TERMINAL = new Set(['done', 'failed', 'skipped', 'cancelled'])

/**
 * Owns the download queue: initial fetch, progress polling, cancellation, and
 * handing finished device-bound files to the browser. Lifted out of
 * DownloadQueue so the shell can badge the Downloads tab without duplicating
 * the polling.
 */
export function useDownloadJobs(refreshTrigger: number, onClearHistory: () => void): DownloadJobsApi {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  // Device-bound jobs already handed to the browser, so a re-render or a
  // second poll seeing 'done' doesn't download the same file twice.
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

  // Polled, not streamed: tunnels such as Cloudflare's quick tunnels hold an
  // SSE stream back until it ends, so progress would only show once finished.
  const anyActive = jobs.some(j => !TERMINAL.has(j.status))
  useEffect(() => {
    if (!anyActive) return
    const timer = setInterval(() => {
      getJobs().then(next => setJobs(prev => {
        const wasActive = new Set(prev.filter(j => !TERMINAL.has(j.status)).map(j => j.id))
        // The file only exists once the job finishes — collect it then.
        next.forEach(j => { if (j.to_device && j.status === 'done' && wasActive.has(j.id)) deliverToDevice(j) })
        return next
      })).catch(() => {})
    }, 1000)
    return () => clearInterval(timer)
  }, [anyActive])

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
