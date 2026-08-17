import { toggleRank } from '../downloadPrefs'

interface Props {
  /** Row caption, e.g. "Site" or "Host". */
  label: string
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
      <span className="text-[10px] uppercase tracking-wide text-base-content/40 w-10 shrink-0">
        {label}
      </span>
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
            className={`btn btn-sm gap-1 font-mono ${ranked ? 'btn-primary' : 'btn-ghost'}`}
          >
            {ranked && <span className="badge badge-xs">{rank + 1}</span>}
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
