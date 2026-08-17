import type { TmdbGenre, TrendingCard } from '../api'
import RatingBadge from './RatingBadge'

interface Props {
  cards: TrendingCard[]
  /** The kind's genre list, for turning a card's genre ids into names. */
  genres: TmdbGenre[]
  onSelect: (card: TrendingCard) => void
}

/**
 * Browse results as rows with the synopsis, genres and year — the reading
 * layout, against the poster grid's scanning layout.
 *
 * A browse card is a TMDB title rather than a source listing, so a row opens a
 * source search for it instead of playing anything.
 */
export default function BrowseList({ cards, genres, onSelect }: Props) {
  const names = new Map(genres.map(g => [g.id, g.name]))

  return (
    <div className="flex flex-col gap-2">
      {cards.map(card => (
        <div
          key={`${card.kind}-${card.tmdb_id}`}
          className="flex gap-3 p-3 rounded-box bg-base-200/40 ring-1 ring-base-300 hover:ring-primary/40 transition"
        >
          <button
            onClick={() => onSelect(card)}
            aria-label={`Search sources for ${card.title}`}
            className="shrink-0 self-start w-24 sm:w-30 rounded-box overflow-hidden bg-base-300"
          >
            {card.poster_url ? (
              <img src={card.poster_url} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover" />
            ) : (
              <div className="w-full aspect-[2/3] flex items-center justify-center text-base-content/30 text-2xl">?</div>
            )}
          </button>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <button onClick={() => onSelect(card)} className="text-left">
              <p className="font-medium leading-tight">{card.title}</p>
            </button>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="badge badge-ghost badge-sm">
                {card.kind === 'movie' ? 'Film' : 'Series'}
              </span>
              {card.year > 0 && (
                <span className="text-base-content/50 text-xs font-mono">{card.year}</span>
              )}
              <RatingBadge rating={card.rating} />
            </div>

            {card.genre_ids.length > 0 && (
              <p className="text-xs text-base-content/50">
                {card.genre_ids
                  .map(id => names.get(id))
                  .filter(Boolean)
                  .slice(0, 4)
                  .join(' · ')}
              </p>
            )}

            {card.overview && (
              <p className="text-sm text-base-content/70 leading-snug line-clamp-3">
                {card.overview}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
