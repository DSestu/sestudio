import { useState } from 'react'
import type { SeasonCard } from '../api'

interface Props {
  card: SeasonCard
  onOpen: (card: SeasonCard) => void
}

/**
 * The "N sources" count, which opens up to the pages behind it.
 *
 * Collapsing same-name listings into one card is a heuristic and does sometimes
 * merge two different titles, so the pages it folded away have to stay
 * reachable — each entry keeps its own poster and year, and opening one opens
 * that page alone. Shared by the grid card and the detail row so the two can't
 * drift.
 *
 * Renders nothing when there is only one page, so callers needn't check.
 */
export default function SourcesBadge({ card, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const alts = card.alts ?? []
  if (!alts.length) return null

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="badge badge-ghost badge-sm gap-1 hover:bg-base-300"
        title={`${alts.length + 1} source pages for this title`}
      >
        {alts.length + 1} sources
        <svg
          className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <ul className="w-full mt-1 flex flex-col gap-0.5 rounded-box bg-base-200 p-1.5">
          {[card, ...alts].map((src, i) => (
            <li key={src.newsid || src.page_url}>
              <button
                onClick={() => onOpen(src)}
                className="w-full flex items-center gap-2 text-left rounded px-1 py-1 hover:bg-base-300 transition-colors"
              >
                {src.poster_url ? (
                  <img src={src.poster_url} alt="" loading="lazy" className="w-6 aspect-[2/3] object-cover rounded-sm shrink-0" />
                ) : (
                  <span className="w-6 aspect-[2/3] rounded-sm bg-base-300 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] leading-tight truncate">{src.series_name}</span>
                  <span className="block text-[10px] leading-tight text-base-content/50 font-mono">
                    {src.year ? src.year : '—'}
                    {/* Names the one the card is standing in for, so the list
                        reads as "this plus the others", not a flat set. */}
                    {i === 0 && ' · shown'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
