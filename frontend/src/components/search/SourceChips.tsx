import type { SourceReport } from '../../api'
import { sourceHue, sourceInitials } from '../../sourceLook'

interface Props {
  sources: SourceReport[]
  /** Results each source would show if picked alone (after kind and dates). */
  counts: Map<string, number>
  picked: ReadonlySet<string>
  onToggle: (id: string) => void
  onClear: () => void
  onRetry: (ids: string[]) => void
  retrying: boolean
  /** Opens every source at once: the side panel, or the phone's sheet. */
  onShowAll: () => void
  /** Must set the display (`flex`, or `hidden md:flex`). */
  className?: string
}

export function SourceAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const h = sourceHue(name)
  return (
    <span
      aria-hidden="true"
      className={`${small ? 'w-4 h-4 text-[8px]' : 'w-5 h-5 text-[9px]'} shrink-0 rounded-full grid place-items-center font-extrabold`}
      style={{ background: `oklch(78% .11 ${h})`, color: `oklch(20% .05 ${h})` }}
    >
      {sourceInitials(name)}
    </span>
  )
}

/**
 * One chip per source with how many results it holds and a bar for its share,
 * which picks that source when clicked (several can be picked). Sources that
 * found nothing stay out of the row; ones that failed or timed out share one
 * chip that retries them.
 */
export default function SourceChips({ sources, counts, picked, onToggle, onClear, onRetry, retrying, onShowAll, className = 'flex' }: Props) {
  const answered = sources.filter(s => s.status === 'ok')
  const failed = sources.filter(s => s.status === 'failed' || s.status === 'timeout')
  // Nothing to choose between: one source, or none.
  if (answered.length < 2 && !failed.length && !picked.size) return null

  const count = (id: string) => counts.get(id) ?? 0
  const max = Math.max(1, ...answered.map(s => count(s.id)))
  // Biggest first, but a picked source never drops out of sight.
  const order = [...answered].sort((a, b) =>
    Number(picked.has(b.id)) - Number(picked.has(a.id)) || count(b.id) - count(a.id))

  return (
    <div className={`items-end gap-2 overflow-x-auto no-scrollbar p-1 -m-1 ${className}`} role="group" aria-label="Sources">
      {order.map(s => {
        const n = count(s.id)
        const on = picked.has(s.id)
        const h = sourceHue(s.name)
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            disabled={!n && !on}
            onClick={() => onToggle(s.id)}
            title={`${s.name}: ${n} result${n === 1 ? '' : 's'}`}
            className={`shrink-0 flex flex-col gap-1 rounded-box px-2 pt-1.5 pb-2 text-sm transition-[background-color,box-shadow,opacity] duration-150 ease-smooth disabled:opacity-40 ${
              on ? 'bg-primary/15 ring-1 ring-primary' : picked.size ? 'bg-base-200 opacity-60 hover:opacity-100' : 'bg-base-200 hover:bg-base-300'}`}
          >
            <span className="flex items-center gap-2 whitespace-nowrap">
              <SourceAvatar name={s.name} />
              {s.name}
              <span className={`font-mono text-xs tabular-nums ${on ? 'text-primary' : 'text-base-content/50'}`}>{n}</span>
            </span>
            <span className="ml-7 h-1 rounded-full bg-base-100 overflow-hidden">
              <span
                className="block h-full rounded-full transition-[width] duration-300 ease-smooth"
                style={{ width: `${(n / max) * 100}%`, background: `oklch(78% .11 ${h})` }}
              />
            </span>
          </button>
        )
      })}
      {failed.length > 0 && (
        <button
          type="button"
          onClick={() => onRetry(failed.map(s => s.id))}
          disabled={retrying}
          title={`Didn't answer: ${failed.map(s => `${s.name} (${s.status === 'timeout' ? 'too slow' : 'error'})`).join(', ')}. Click to try again.`}
          className="shrink-0 self-center flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-error ring-1 ring-error/50 hover:bg-error/10 transition-colors"
        >
          {retrying ? <span className="loading loading-spinner loading-xs" aria-label="Retrying" /> : '↻'}
          {failed.length === 1 ? `${failed[0].name} didn't answer` : `${failed.length} didn't answer`}
        </button>
      )}
      <button
        type="button"
        onClick={onShowAll}
        title="All sources, with what each found"
        className="shrink-0 self-stretch flex items-center gap-1.5 rounded-box px-3 text-sm text-primary bg-base-200 hover:bg-base-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM15 5v14" />
        </svg>
        All {sources.length}
      </button>
      {picked.size > 0 && (
        <button type="button" onClick={onClear} className="shrink-0 self-center px-2 text-sm text-primary hover:underline">
          Clear
        </button>
      )}
    </div>
  )
}
