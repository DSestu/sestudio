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

  // Fetch jobs on mount and whenever new downloads are queued
  useEffect(() => {
    getJobs().then(setJobs)
  }, [refreshTrigger])

  // Subscribe to SSE for any new downloading jobs
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
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
        <h3 className="text-white font-medium text-sm">Downloads</h3>
        {hasTerminal && (
          <button
            onClick={handleClearHistory}
            className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
          >
            Clear history
          </button>
        )}
      </div>
      <div className="divide-y divide-zinc-800">
        {allJobs.map(job => (
          <div key={job.id} className="px-4 py-3">
            <div className="flex items-center gap-3 mb-1.5">
              <StatusBadge status={job.status} />
              <span className="text-zinc-200 text-sm flex-1 truncate">{job.episode_name}</span>
              {job.status === 'downloading' && (
                <span className="text-zinc-500 text-xs">{job.speed} ETA {job.eta}</span>
              )}
              {(job.status === 'queued' || job.status === 'downloading') && (
                <button
                  onClick={() => handleCancel(job.id)}
                  title="Cancel download"
                  className="text-zinc-400 hover:text-red-400 transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {(job.status === 'downloading' || job.status === 'done') && (
              <div className="w-full bg-zinc-700 rounded-full h-1.5">
                <div
                  className="bg-violet-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            )}
            {job.error && (
              <p className="text-red-400 text-xs mt-1">{job.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: DownloadJob['status'] }) {
  const map: Record<DownloadJob['status'], [string, string]> = {
    queued:      ['bg-zinc-700 text-zinc-400', 'queued'],
    downloading: ['bg-blue-900 text-blue-300', 'downloading'],
    done:        ['bg-green-900 text-green-300', '✓ done'],
    failed:      ['bg-red-900 text-red-300', '✗ failed'],
    skipped:     ['bg-zinc-800 text-zinc-500', '— exists'],
    cancelled:   ['bg-zinc-800 text-zinc-500', '✕ cancelled'],
  }
  const [cls, label] = map[status]
  return (
    <span className={`${cls} text-xs px-2 py-0.5 rounded font-mono w-20 text-center`}>
      {label}
    </span>
  )
}
