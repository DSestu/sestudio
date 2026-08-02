import { useEffect, useRef, useState } from 'react'
import type { DownloadJob } from '../api'
import { cancelJob, clearHistory, getJobs, jobFileUrl, subscribeJobProgress } from '../api'
import { clearDeviceDownloads, useDeviceDownloads } from '../deviceDownloads'

interface Props {
  refreshTrigger: number
  skippedJobs: DownloadJob[]
  onClearHistory: () => void
}

export default function DownloadQueue({ refreshTrigger, skippedJobs, onClearHistory }: Props) {
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
      subscriptions.current[job.id] = unsub
    })
  }, [jobs])

  const deviceDownloads = useDeviceDownloads()
  const allJobs = [...jobs, ...skippedJobs.filter(s => !jobs.some(j => j.episode_name === s.episode_name))]
  const hasTerminal = allJobs.some(j => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled' || j.status === 'skipped')
    || deviceDownloads.some(d => d.status !== 'resolving')

  if (!allJobs.length && !deviceDownloads.length) return null

  return (
    <div className="card card-bordered bg-base-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <h3 className="font-medium text-sm">Downloads</h3>
        {hasTerminal && (
          <button
            onClick={() => { handleClearHistory(); clearDeviceDownloads() }}
            className="btn btn-ghost btn-xs"
          >
            Clear history
          </button>
        )}
      </div>
      <div className="divide-y divide-base-300">
        {/* Device downloads — the browser owns the byte transfer, so we report
            the phase we control and point at the browser's download manager. */}
        {deviceDownloads.map(d => (
          <div key={d.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={`badge font-mono w-20 justify-center text-xs ${
                d.status === 'failed' ? 'badge-error'
                  : d.status === 'saving' ? 'badge-success'
                  : 'badge-info'
              }`}>
                {d.status === 'failed' ? '✗ failed'
                  : d.status === 'saving' ? '↓ browser'
                  : 'resolving'}
              </span>
              <span className="text-sm flex-1 truncate">{d.name}</span>
              {d.status === 'resolving' && <span className="loading loading-spinner loading-xs" />}
            </div>
            {d.status === 'saving' && (
              <p className="text-base-content/50 text-xs mt-1">
                Saving via your browser — see its downloads for progress.
              </p>
            )}
            {d.error && <p className="text-error text-xs mt-1">{d.error}</p>}
          </div>
        ))}
        {allJobs.map(job => (
          <div key={job.id} className="px-4 py-3">
            <div className="flex items-center gap-3 mb-1.5">
              <StatusBadge status={job.status} />
              <span className="text-sm flex-1 truncate">
                {job.episode_name}
                {job.to_device && (
                  <span className="badge badge-ghost badge-xs ml-2 align-middle">to device</span>
                )}
              </span>
              {job.status === 'downloading' && (
                <span className="text-base-content/50 text-xs font-mono whitespace-nowrap">
                  {job.progress > 0 && `${job.progress.toFixed(1)}%`}
                  {job.speed && ` · ${job.speed}`}
                  {job.eta && ` · ETA ${job.eta}`}
                </span>
              )}
              {job.to_device && job.status === 'done' && (
                <a
                  href={jobFileUrl(job.id)}
                  download={job.episode_name}
                  className="btn btn-xs btn-primary btn-outline shrink-0"
                >
                  Save file
                </a>
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
                className={`progress w-full h-1.5 ${job.phase === 'retrying' ? 'progress-warning' : 'progress-primary'}`}
                value={job.progress}
                max="100"
              />
            )}
            {/* Verbosity line: where it's downloading from, how big, and what
                phase it's in — the gaps a bare percentage doesn't explain. */}
            {job.status === 'downloading' && (
              <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-base-content/50">
                {job.provider && <span className="badge badge-ghost badge-xs font-mono">{job.provider}</span>}
                {job.total_size && <span className="font-mono">{job.total_size}</span>}
                {job.fragment && <span className="font-mono">frag {job.fragment}</span>}
                {job.phase === 'processing' && (
                  <span className="text-info">converting — {job.detail || 'post-processing'}</span>
                )}
                {job.phase === 'retrying' && (
                  <span className="text-warning">{job.detail || 'retrying'}</span>
                )}
              </div>
            )}
            {job.error && (
              <p className="text-error text-xs mt-1 break-words">{job.error}</p>
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
