import type { ReactNode } from 'react'
import RatingBadge from '../RatingBadge'

interface Props {
  poster_url: string
  title: string
  /** Primary meta line, e.g. "S01E04 · The Cursed Sword". */
  meta?: string
  /** Secondary meta line, e.g. "4 of 20 watched · 2 days ago". Takes nodes as well
   *  as text, so a caller can put a badge on it. */
  submeta?: ReactNode
  /** TMDB score, shown as a badge when a match was found. */
  rating?: number
  /** TMDB genre names. The caller decides how many are worth the space. */
  genres?: string[]
  /** TMDB synopsis, clamped — a row is a summary, not the detail page. */
  synopsis?: string
  /** Renders a progress bar with a remaining-time label when set. */
  progress?: { fraction: number; label: string }
  onOpen: () => void
  /** Primary controls. Stretch to fill the row on mobile, natural width on desktop. */
  actions?: ReactNode
  /** Top-right slot, for the overflow control. */
  overflow?: ReactNode
  /** When set, the row selects instead of opening and shows a checkbox. */
  selection?: { selected: boolean; onToggle: () => void }
}

/**
 * One library item as a horizontal row with room for real context and labelled
 * buttons — the denser, more informative alternative to a poster card (#26).
 *
 * Shared by the Watching rows and the title rows so the two can't drift. The
 * layout reflows rather than duplicating markup: below `sm:` the action buttons
 * stretch to fill the row, above it they size to their content.
 */
export default function DetailRow({
  poster_url, title, meta, submeta, rating, genres, synopsis,
  progress, onOpen, actions, overflow, selection,
}: Props) {
  // In selection mode both tap targets select, and the row's own actions step aside.
  const activate = selection ? selection.onToggle : onOpen
  const checkboxProps = selection
    ? ({ role: 'checkbox', 'aria-checked': selection.selected } as const)
    : {}

  return (
    <div
      className={`flex gap-3 p-3 rounded-box bg-base-200/40 ring-1 transition ${
        selection?.selected ? 'ring-2 ring-primary' : 'ring-base-300 hover:ring-primary/40'
      }`}
    >
      <button
        onClick={activate}
        aria-label={selection ? `Select ${title}` : `Open ${title}`}
        {...checkboxProps}
        className="shrink-0 self-start w-24 sm:w-30 rounded-box overflow-hidden bg-base-300"
      >
        {poster_url ? (
          <img src={poster_url} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover" />
        ) : (
          <div className="w-full aspect-[2/3] flex items-center justify-center text-base-content/30 text-2xl">?</div>
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <button onClick={activate} className="min-w-0 flex-1 text-left">
            <p className="font-medium leading-tight truncate">{title}</p>
            {meta && <p className="text-sm text-base-content/70 truncate mt-0.5">{meta}</p>}
          </button>
          {selection ? (
            <span
              aria-hidden="true"
              className={`shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center ${
                selection.selected
                  ? 'bg-primary border-primary'
                  : 'bg-base-100/80 border-base-content/40'
              }`}
            >
              {selection.selected && (
                <svg className="w-3.5 h-3.5 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          ) : (
            overflow && <div className="shrink-0">{overflow}</div>
          )}
        </div>

        {/* TMDB facts, when a match was found. Absent without a key, which is
            why nothing here is load-bearing for the row's layout. */}
        {(rating !== undefined || (genres && genres.length > 0)) && (
          <div className="flex items-center gap-2 flex-wrap">
            {rating !== undefined && <RatingBadge rating={rating} />}
            {genres && genres.length > 0 && (
              <span className="text-xs text-base-content/50">{genres.join(' · ')}</span>
            )}
          </div>
        )}

        {progress && (
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 h-1 rounded-full bg-base-300 overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-base-content/50 shrink-0">{progress.label}</span>
          </div>
        )}

        {/* Text keeps its single truncated line; nodes get a wrapping row, since a
            badge inside a truncating paragraph lays out badly. */}
        {submeta &&
          (typeof submeta === 'string' ? (
            <p className="text-xs text-base-content/50 truncate">{submeta}</p>
          ) : (
            <div className="text-xs text-base-content/50 flex items-center gap-2 flex-wrap">
              {submeta}
            </div>
          ))}

        {synopsis && (
          <p className="text-sm text-base-content/70 leading-snug line-clamp-2 sm:line-clamp-3">
            {synopsis}
          </p>
        )}

        {actions && !selection && (
          <div className="flex items-center gap-2 mt-1 [&>*]:flex-1 sm:[&>*]:flex-none">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
