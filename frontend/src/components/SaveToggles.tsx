import type { CollectionEntry } from '../collections'
import { isSaved, toggle, useCollections } from '../collections'

interface Props {
  /** The item these toggles act on (without the timestamp, which is set on save). */
  entry: Omit<CollectionEntry, 'addedAt'>
  /** Compact variant for dense rows. */
  size?: 'sm' | 'md'
  className?: string
}

/** Watchlist (☆) and favourite (♥) toggles for a title or episode. */
export default function SaveToggles({ entry, size = 'md', className = '' }: Props) {
  const state = useCollections()
  const inWatchlist = isSaved('watchlist', entry, state)
  const isFavourite = isSaved('favourites', entry, state)
  const btn = `btn btn-ghost btn-square ${size === 'sm' ? 'btn-sm' : 'btn-md sm:btn-sm'}`
  const label = entry.kind === 'episode' ? `episode ${entry.label}` : entry.label

  return (
    <div className={`flex items-center ${className}`}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); toggle('watchlist', entry) }}
        aria-pressed={inWatchlist}
        aria-label={
          inWatchlist ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`
        }
        title={inWatchlist ? 'In your watchlist' : 'Add to watchlist'}
        className={`${btn} ${inWatchlist ? 'text-warning' : 'text-base-content/40 hover:text-warning'}`}
      >
        {/* Filled when saved, outline when not — shape differs too, so the state
            doesn't rely on colour alone. */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill={inWatchlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.5a.56.56 0 011.04 0l2.12 4.3 4.75.69c.46.07.64.63.31.95l-3.44 3.35.81 4.73c.08.46-.4.81-.81.59L12 15.87l-4.26 2.24c-.41.22-.89-.13-.81-.59l.81-4.73-3.44-3.35a.56.56 0 01.31-.95l4.75-.69 2.12-4.3z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); toggle('favourites', entry) }}
        aria-pressed={isFavourite}
        aria-label={
          isFavourite ? `Remove ${label} from favourites` : `Add ${label} to favourites`
        }
        title={isFavourite ? 'In your favourites' : 'Add to favourites'}
        className={`${btn} ${isFavourite ? 'text-secondary' : 'text-base-content/40 hover:text-secondary'}`}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill={isFavourite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
        </svg>
      </button>
    </div>
  )
}
