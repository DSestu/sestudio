import { useState, type ReactNode } from 'react'
import { transfersApi, type OnConflict, type TransferJob } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import { refreshTransfers } from '../../transfers'

function ago(epoch: number): string {
  const min = Math.round((Date.now() / 1000 - epoch) / 60)
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`
}

function left(job: TransferJob): string {
  if (!job.bytes_per_second) return ''
  const min = Math.ceil((job.total_bytes - job.done_bytes) / job.bytes_per_second / 60)
  return ` · ${min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`} left`
}

/**
 * A copy or move in the Queue, beside the downloads (SPEC-storage §9, X2, option Q):
 * its progress while it runs, and once it is over, what it did, with what to do
 * about any file it skipped.
 */
export default function TransferRow({ job }: { job: TransferJob }) {
  const [error, setError] = useState<string | null>(null)
  const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
  const live = job.status === 'queued' || job.status === 'running' || job.status === 'paused'
  const skipped = job.items.filter(i => i.status === 'skipped')
  const failed = job.items.filter(i => i.status === 'failed')
  const done = job.counts.done
  const verb = job.mode === 'copy' ? 'Copied' : 'Moved'

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) }
    void refreshTransfers()
  }
  // The skipped files again, under the rule picked now; this row then goes.
  const redo = (rule: OnConflict) => act(async () => {
    await transfersApi.start({
      files: skipped.map(i => i.source),
      dests: skipped.map(i => i.dest),
      to: job.to,
      mode: job.mode,
      on_conflict: rule,
      label: job.label,
    })
    await transfersApi.control(job.id, 'clear')
  })

  let line: ReactNode
  if (job.status === 'queued') line = 'Waiting · starts after the current transfer'
  else if (job.status === 'paused' && job.waiting) line = <span className="text-warning">Paused · waiting for {job.waiting} · it goes on by itself</span>
  else if (job.status === 'paused') line = `Paused · ${fmtSize(job.done_bytes)} of ${fmtSize(job.total_bytes)}`
  else if (job.status === 'running') line = `${fmtSize(job.done_bytes)} of ${fmtSize(job.total_bytes)} · ${fmtSize(job.bytes_per_second)}/s${left(job)}`
  else if (job.status === 'cancelled') line = `Cancelled · ${done} of ${files(job.items.length)} ${verb.toLowerCase()}`
  else if (failed.length) line = <span className="text-error">{files(failed.length)} failed: {failed[0].error}{done ? ` · ${done} of ${job.items.length} ${verb.toLowerCase()}` : ''}</span>
  else if (skipped.length) line = <span className="text-warning">{files(skipped.length)} skipped: already there · {done} of {job.items.length} {verb.toLowerCase()}</span>
  else line = <span className="text-success">✓ {verb} {files(done)} to {job.to_label} · {fmtSize(job.total_bytes)} · {ago(job.finished)}</span>

  const pct = job.total_bytes ? Math.round((job.done_bytes / job.total_bytes) * 100) : 0
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3 mb-1">
        <span className={`badge font-mono w-20 justify-center text-xs ${live ? 'badge-secondary' : 'badge-ghost'}`}>
          {job.mode === 'copy' ? 'Copy' : 'Move'}
        </span>
        <span className="text-sm flex-1 truncate">
          {live ? `${job.mode === 'copy' ? 'Copying' : 'Moving'} ` : ''}{job.label} · {files(job.items.length)} → {job.to_label}
        </span>
      </div>
      {(job.status === 'running' || job.status === 'paused') && (
        <progress className={`progress w-full h-1.5 ${job.status === 'paused' ? 'progress-warning' : 'progress-secondary'}`} value={pct} max="100" />
      )}
      <p className="text-xs text-base-content/60 mt-1 break-words">{line}</p>
      {error && <p role="alert" className="text-error text-xs mt-1">{error}</p>}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {job.status === 'running' && <button className="btn btn-xs" onClick={() => void act(() => transfersApi.control(job.id, 'pause'))}>Pause</button>}
        {job.status === 'paused' && <button className="btn btn-xs" onClick={() => void act(() => transfersApi.control(job.id, 'resume'))}>Resume</button>}
        {live && <button className="btn btn-xs btn-ghost" onClick={() => void act(() => transfersApi.control(job.id, 'cancel'))}>Cancel</button>}
        {!live && skipped.length > 0 && (
          <>
            <button className="btn btn-xs" onClick={() => void redo('replace')}>Replace them</button>
            <button className="btn btn-xs" onClick={() => void redo('keep_both')}>Keep both</button>
          </>
        )}
        {!live && <button className="btn btn-xs btn-ghost" onClick={() => void act(() => transfersApi.control(job.id, 'clear'))}>Clear</button>}
      </div>
    </div>
  )
}
