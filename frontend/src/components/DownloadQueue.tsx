import { useEffect, useRef, useState } from 'react'
import type { DownloadJob } from '../api'
import { cancelJob, clearHistory, getJobs, subscribeJobProgress } from '../api'

interface Props {
  refreshTrigger: number
  skippedJobs: DownloadJob[]
  onClearHistory: () => void
}

export default function DownloadQueue({ refreshTrigger, skippedJobs, onClearHistory }: Props) {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const subscriptions = useRef<Record<string, () => void>>({})

  function handleCancel(id: string) {
    cancelJob(id).then(() => {
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' as const } : j))
    }).catch(() => {})
  }

  function handleClearHistory() {
    clearHistory().then(() => {
      setJobs(prev => prev.filter(j => j.status === 'queued' || j.status === 'downloading'))
      onClearHistory()
    }).catch(() => {})
  }

  useEffect(() => {
    getJobs().then(setJobs)
  }, [refreshTrigger])

  useEffect(() => {
    jobs.forEach(job => {
      if (subscriptions.current[job.id]) return
      if (job.status === 'done' || job.status === 'failed' || job.status === 'skipped' || job.status === 'cancelled') return

      const unsub = subscribeJobProgress(
        job.id,
        (data) => {
          setJobs(prev => prev.map(j =>
            j.id === job.id ? { ...j, ...data } as DownloadJob : j
          ))
        },
        () => { delete subscriptions.current[job.id] },
      )
      subscriptions.current[job.id] = unsub
    })
  }, [jobs])

  const allJobs = [...jobs, ...skippedJobs.filter(s => !jobs.some(j => j.episode_name === s.episode_name))]
  const hasTerminal = allJobs.some(j => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled' || j.status === 'skipped')

  if (!allJobs.length) return null

  return (
    <div className="card card-bordered bg-base-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <h3 className="font-medium text-sm">Downloads</h3>
        {hasTerminal && (
          <button onClick={handleClearHistory} className="btn btn-ghost btn-xs">
            Clear history
          </button>
        )}
      </div>
      <div className="divide-y divide-base-300">
        {allJobs.map(job => (
          <div key={job.id} className="px-4 py-3">
            <div className="flex items-center gap-3 mb-1.5">
              <StatusBadge status={job.status} />
              <span className="text-sm flex-1 truncate">{job.episode_name}</span>
              {job.status === 'downloading' && (
                <span className="text-base-content/50 text-xs">{job.speed} ETA {job.eta}</span>
              )}
              {(job.status === 'queued' || job.status === 'downloading') && (
                <button
                  onClick={() => handleCancel(job.id)}
                  title="Cancel download"
                  className="text-base-content/50 hover:text-error transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {(job.status === 'downloading' || job.status === 'done') && (
              <progress
                className="progress progress-primary w-full h-1.5"
                value={job.progress}
                max="100"
              />
            )}
            {job.error && (
              <p className="text-error text-xs mt-1">{job.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: DownloadJob['status'] }) {
  const map: Record<DownloadJob['status'], [string, string]> = {
    queued:      ['badge-ghost', 'queued'],
    downloading: ['badge-info', 'downloading'],
    done:        ['badge-success', '✓ done'],
    failed:      ['badge-error', '✗ failed'],
    skipped:     ['badge-ghost', '— exists'],
    cancelled:   ['badge-ghost', '✕ cancelled'],
  }
  const [variant, label] = map[status]
  return (
    <span className={`badge ${variant} font-mono w-20 justify-center text-xs`}>
      {label}
    </span>
  )
}
