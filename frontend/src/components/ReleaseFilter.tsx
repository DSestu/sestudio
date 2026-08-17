import type { DateRange, ReleaseState } from '../releaseDates'
import { ANY_DATES, monthsAgo } from '../releaseDates'

// A release-date window, shared by the catalogue browser and the search
// results toolbar so both name the same thing the same way.

/** Presets are computed from today, so "Last month" stays true tomorrow.
 *  Each is open-ended at the top: "recent" means "up to now", not "until a
 *  fixed date". */
function presets(): { label: string; range: DateRange }[] {
  const year = new Date().getFullYear()
  return [
    { label: 'Any', range: ANY_DATES },
    { label: 'Last month', range: { from: monthsAgo(1), to: '' } },
    { label: 'Last 3 months', range: { from: monthsAgo(3), to: '' } },
    { label: 'Last year', range: { from: monthsAgo(12), to: '' } },
    { label: 'Last 5 years', range: { from: `${year - 4}-01-01`, to: '' } },
  ]
}

/** The released/unreleased choice. "Released" leads because an announcement is
 *  not watchable, which is what this list is for. */
const STATES: { value: ReleaseState; label: string; title: string }[] = [
  { value: 'out', label: 'Released', title: 'Only titles that are out' },
  { value: 'upcoming', label: 'Incoming', title: 'Only titles announced but not released yet' },
  { value: 'all', label: 'All', title: 'Both, with the unreleased ones grouped under Incoming' },
]

function same(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to
}

interface Props {
  value: DateRange
  onChange: (next: DateRange) => void
  /** Omitted where the surface can't tell released from unreleased — source
   *  listings carry a year, never a date, so the choice would be a lie there. */
  state?: ReleaseState
  onStateChange?: (next: ReleaseState) => void
  label?: string
  /** Shown next to the controls where the window can only be applied by year. */
  note?: string
}

/**
 * Release-date filter: the released/incoming choice, one-click presets for the
 * common case ("what's out recently"), and a from/to pair for anything else.
 */
export default function ReleaseFilter({
  value, onChange, state, onStateChange, label = 'Released', note,
}: Props) {
  function set(patch: Partial<DateRange>) {
    const next = { ...value, ...patch }
    // Keep the window well-formed: moving one bound past the other pushes it.
    if (patch.from !== undefined && next.to && next.from > next.to) next.to = next.from
    if (patch.to !== undefined && next.from && next.to < next.from) next.from = next.to
    onChange(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label={label}>
      <span className="text-sm text-base-content/70 whitespace-nowrap">{label}</span>

      {state && onStateChange && (
        <div className="join" role="group" aria-label="Release status">
          {STATES.map(s => (
            <button
              key={s.value}
              onClick={() => onStateChange(s.value)}
              aria-pressed={state === s.value}
              title={s.title}
              className={`join-item btn btn-xs ${
                state === s.value ? 'btn-primary' : 'btn-ghost border-base-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {presets().map(p => {
          const active = same(value, p.range)
          return (
            <button
              key={p.label}
              onClick={() => onChange(p.range)}
              aria-pressed={active}
              className={`badge badge-sm cursor-pointer transition-colors ${
                active ? 'badge-primary' : 'badge-ghost hover:badge-outline'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={value.from}
          onChange={e => set({ from: e.target.value })}
          aria-label="Earliest release date"
          className="input input-bordered input-xs w-36"
        />
        <span className="text-base-content/40 text-xs">–</span>
        <input
          type="date"
          value={value.to}
          onChange={e => set({ to: e.target.value })}
          aria-label="Latest release date"
          className="input input-bordered input-xs w-36"
        />
      </div>

      {note && <span className="text-xs text-base-content/40">{note}</span>}
    </div>
  )
}
