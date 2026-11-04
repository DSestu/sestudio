import { toggleRank } from '../downloadPrefs'

interface Props {
  /** Row caption, e.g. "Site" or "Host"; left out where the row is already labelled. */
  label?: string
  options: { value: string; label: string }[]
  /** Current ranking, most-wanted first. Unlisted options are fallback. */
  order: string[]
  onChange: (order: string[]) => void
}

/**
 * One ranked row of chips: click an unranked chip to put it at the end of the
 * order, click a ranked one to take it out.
 *
 * Ranking by clicking rather than dragging is deliberate — the order is built
 * by picking first, second, third in the order you say them, and it works the
 * same with a finger as with a mouse.
 */
export default function RankRow({ label, options, order, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-base-content/40 w-10 shrink-0">
          {label}
        </span>
      )}
      {options.map(opt => {
        const rank = order.indexOf(opt.value)
        const ranked = rank >= 0
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(toggleRank(order, opt.value))}
            aria-pressed={ranked}
            title={
              ranked
                ? `Choice ${rank + 1} — click to remove from the order`
                : 'Click to add to the end of the order'
            }
            className={`inline-flex items-center gap-1.5 h-8 rounded-full px-3 text-[13px] font-medium transition-colors ${
              ranked ? 'bg-primary/22 text-primary' : 'bg-base-300 text-base-content/80 hover:text-base-content'
            }`}
          >
            {ranked && (
              <span className="grid place-items-center size-4 -ml-1 rounded-full bg-primary text-primary-content text-[10px] font-semibold tabular-nums">
                {rank + 1}
              </span>
            )}
            {opt.label}
          </button>
        )
      })}
      {order.length === 0 && (
        <span className="text-xs text-base-content/40">
          no preference — tried in the built-in order
        </span>
      )}
    </div>
  )
}
