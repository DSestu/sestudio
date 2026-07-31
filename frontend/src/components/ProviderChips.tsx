import type { ProviderStatus } from '../providers'

interface Props {
  providers: string[]
  active: string | null
  status: Record<string, ProviderStatus>
  onSelect: (provider: string) => void
  disabled?: boolean
}

/** A row of selectable provider chips that visually reflect per-provider status. */
export default function ProviderChips({ providers, active, status, onSelect, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map(p => {
        const st = status[p] ?? 'idle'
        const isActive = p === active
        const cls =
          st === 'failed'
            ? 'btn-error btn-outline line-through'
            : isActive
              ? 'btn-primary'
              : 'btn-ghost'
        const label =
          st === 'failed' ? 'unavailable' : st === 'loading' ? 'loading' : isActive ? 'active' : 'available'
        return (
          <button
            key={p}
            disabled={disabled || st === 'loading'}
            onClick={() => onSelect(p)}
            title={`${p} — ${label}`}
            className={`btn btn-sm gap-1 font-mono ${cls}`}
          >
            {st === 'loading' && <span className="loading loading-spinner loading-xs" />}
            {st === 'failed' && <span aria-hidden>⚠</span>}
            {st === 'ok' && isActive && <span aria-hidden>▶</span>}
            {p}
          </button>
        )
      })}
    </div>
  )
}
