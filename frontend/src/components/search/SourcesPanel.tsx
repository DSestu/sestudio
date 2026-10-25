import { useState } from 'react'
import type { SourceReport } from '../../api'
import { sourceHue } from '../../sourceLook'
import { SourceAvatar } from './SourceChips'

interface Props {
  sources: SourceReport[]
  counts: Map<string, number>
  picked: ReadonlySet<string>
  onToggle: (id: string) => void
  onOnly: (id: string) => void
  onClear: () => void
  onRetry: (ids: string[]) => void
  retrying: boolean
  onClose: () => void
}

const sectionTitle = 'mt-3 mb-1 px-1 flex items-center text-[11px] font-semibold uppercase tracking-wide text-base-content/50'

/**
 * Every source of a search at once, as a histogram: what each found (with a
 * bar and a count, a checkbox to pick it, "only" to pick just it), which found
 * nothing, and which didn't answer (each retried on its own). The desktop's
 * right-hand panel and the phone's bottom sheet both draw this.
 */
export default function SourcesPanel({ sources, counts, picked, onToggle, onOnly, onClear, onRetry, retrying, onClose }: Props) {
  const [filter, setFilter] = useState('')
  const match = (s: SourceReport) => s.name.toLowerCase().includes(filter.trim().toLowerCase())
  const count = (id: string) => counts.get(id) ?? 0
  const found = sources.filter(s => s.status === 'ok').sort((a, b) => count(b.id) - count(a.id))
  const empty = sources.filter(s => s.status === 'empty')
  const failed = sources.filter(s => s.status === 'failed' || s.status === 'timeout')
  const max = Math.max(1, ...found.map(s => count(s.id)))

  return (
    <div className="flex flex-col text-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Sources</h2>
        {picked.size > 0 && (
          <button type="button" onClick={onClear} className="text-xs text-primary hover:underline">Clear</button>
        )}
        <button type="button" onClick={onClose} aria-label="Close sources" className="btn btn-ghost btn-sm btn-square ml-auto">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {sources.length > 6 && (
        <input
          type="search"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter sources"
          aria-label="Filter sources"
          className="input input-sm w-full mt-2"
        />
      )}

      <p className={sectionTitle}>Found results · {found.length}</p>
      <ul className="flex flex-col">
        {found.filter(match).map(s => {
          const n = count(s.id)
          const on = picked.has(s.id)
          return (
            <li key={s.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-base-300/60">
              <label className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-primary"
                  checked={on}
                  disabled={!n && !on}
                  onChange={() => onToggle(s.id)}
                />
                <SourceAvatar name={s.name} />
                <span className="w-24 truncate">{s.name}</span>
                <span className="flex-1 h-1.5 rounded-full bg-base-100 overflow-hidden">
                  <span
                    className="block h-full rounded-full transition-[width] duration-300 ease-smooth"
                    style={{ width: `${(n / max) * 100}%`, background: `oklch(78% .11 ${sourceHue(s.name)})` }}
                  />
                </span>
                <span className="w-7 text-right font-mono text-xs tabular-nums text-base-content/60">{n}</span>
              </label>
              <button
                type="button"
                onClick={() => onOnly(s.id)}
                disabled={!n}
                className="text-xs text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden"
              >
                only
              </button>
            </li>
          )
        })}
      </ul>

      {empty.length > 0 && (
        <>
          <p className={sectionTitle}>Found nothing · {empty.length}</p>
          <ul className="flex flex-col opacity-50">
            {empty.filter(match).map(s => (
              <li key={s.id} className="flex items-center gap-2 px-1 py-1"><SourceAvatar name={s.name} />{s.name}</li>
            ))}
          </ul>
        </>
      )}

      {failed.length > 0 && (
        <>
          <p className={`${sectionTitle} text-error`}>
            Didn&apos;t answer · {failed.length}
            {failed.length > 1 && (
              <button type="button" disabled={retrying} onClick={() => onRetry(failed.map(s => s.id))} className="ml-auto normal-case tracking-normal text-primary hover:underline">
                Retry all
              </button>
            )}
          </p>
          <ul className="flex flex-col">
            {failed.filter(match).map(s => (
              <li key={s.id} className="flex items-center gap-2 px-1 py-1">
                <SourceAvatar name={s.name} />
                <span className="flex-1">{s.name}</span>
                <span className="text-xs text-base-content/40">{s.status === 'timeout' ? 'too slow' : 'error'}</span>
                <button type="button" disabled={retrying} onClick={() => onRetry([s.id])} className="text-xs text-primary hover:underline">
                  {retrying ? <span className="loading loading-spinner loading-xs" aria-label="Retrying" /> : '↻ Retry'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
