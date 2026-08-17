import type { ReactNode } from 'react'
import RatingBadge from './RatingBadge'

export interface MediaCardItem {
  key: string
  title: string
  subtitle?: string
  /** TMDB score — shown as a colored chip on the poster when set. */
  rating?: number
  /** TMDB genres — the first two render as muted text under the caption. */
  genres?: string[]
  poster_url: string
  /** Marks what kind of thing the card is, over the artwork's top-left corner.
   *  The downloaded shelf uses it to tell a folder from a file. */
  badge?: ReactNode
  /** 0..1 — renders a progress bar under the poster when set. */
  progress?: number
  onClick: () => void
  /** When set, shows a control that removes the item. */
  onRemove?: () => void
  /** Extra controls (e.g. save toggles). */
  actions?: ReactNode
}

export interface Selection {
  selected: boolean
  onToggle: () => void
}

interface Props {
  item: MediaCardItem
  /** Announced by the remove control, e.g. "Remove Bleach from Watchlist". */
  removeContext?: string
  /** When set, the card selects instead of opening and shows a checkbox. */
  selection?: Selection
}

/**
 * One poster card, shared by MediaRow and PosterGrid so their markup can't drift
 * and so selection only has to be taught once.
 *
 * Controls are placed by pointer capability, not by width (#26): a hover-capable
 * pointer gets them overlaid on the poster and revealed on hover, while touch
 * gets them permanently in the caption. Keying this off `sm:` instead would hide
 * them on a touch tablet, which is wide but cannot hover.
 */
export default function MediaCard({ item, removeContext, selection }: Props) {
  const removeLabel = removeContext
    ? `Remove ${item.title} from ${removeContext}`
    : `Remove ${item.title}`
  // In selection mode the card's job is to select, so its own actions step aside.
  const selecting = selection !== undefined

  const controls = (
    <>
      {item.actions}
      {item.onRemove && (
        <button
          onClick={e => {
            e.stopPropagation()
            item.onRemove!()
          }}
          aria-label={removeLabel}
          title="Remove"
          className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-error"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </>
  )

  const hasControls = Boolean(item.actions || item.onRemove) && !selecting

  return (
    <div className="group relative">
      {selection && (
        <span
          aria-hidden="true"
          className={`absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded border-2 flex items-center justify-center ${
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
      )}

      {/* Hover-capable pointers: overlaid, revealed on hover or focus. */}
      {hasControls && (
        <div className="hidden [@media(hover:hover)]:flex absolute bottom-[4.25rem] right-1.5 z-10 items-center rounded-box bg-base-100/80 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {controls}
        </div>
      )}

      <button
        onClick={selection ? selection.onToggle : item.onClick}
        // A selectable card is a checkbox, so Space toggles it and AT announces state.
        role={selection ? 'checkbox' : undefined}
        aria-checked={selection ? selection.selected : undefined}
        className="w-full text-left"
      >
        <div
          className={`relative rounded-box overflow-hidden bg-base-200 ring-1 transition ${
            selection?.selected ? 'ring-2 ring-primary' : 'ring-base-300 group-hover:ring-primary/70'
          }`}
        >
          {item.poster_url ? (
            <img
              src={item.poster_url}
              alt=""
              loading="lazy"
              className="w-full aspect-[2/3] object-cover"
            />
          ) : (
            <div className="w-full aspect-[2/3] bg-base-300 flex items-center justify-center text-base-content/30 text-3xl">
              ?
            </div>
          )}
          {item.rating !== undefined && (
            <RatingBadge rating={item.rating} className="absolute top-1.5 right-1.5 z-10" />
          )}
          {/* Opposite corner from the rating, so the two never collide. */}
          {item.badge && (
            <span className="absolute top-1.5 left-1.5 z-10 flex items-center justify-center w-7 h-7 rounded-box bg-base-100/85 text-base-content/80 backdrop-blur-sm">
              {item.badge}
            </span>
          )}
          {/* Play affordance — hover-only, so it never occupies a touch card. */}
          <span className="pointer-events-none absolute inset-0 hidden [@media(hover:hover)]:flex items-center justify-center bg-base-100/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="btn btn-circle btn-primary btn-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
          {item.progress !== undefined && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-base-100/60">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <p className="text-xs sm:text-sm font-medium leading-tight truncate mt-2">{item.title}</p>
        {item.subtitle && (
          <p className="text-xs text-base-content/50 mt-0.5 truncate">{item.subtitle}</p>
        )}
        {/* Two at most, as on search result cards: a third genre wraps the line
            in a narrow grid column for very little added information. */}
        {item.genres && item.genres.length > 0 && (
          <p className="text-[11px] leading-tight text-base-content/40 mt-1 truncate">
            {item.genres.slice(0, 2).join(' · ')}
          </p>
        )}
      </button>

      {/* Touch: always visible, below the caption so it never covers the art. */}
      {hasControls && (
        <div className="flex [@media(hover:hover)]:hidden items-center gap-1 mt-1">{controls}</div>
      )}
    </div>
  )
}
