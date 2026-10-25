import type { CatalogCard } from '../api'
import RatingBadge from './RatingBadge'
import { saveEntry } from './resultMeta'
import SaveToggles from './SaveToggles'

interface Props {
  cards: CatalogCard[]
  onSelect: (card: CatalogCard) => void
}

/**
 * Browse results as rows with the synopsis, genres and year — the reading
 * layout, against the poster grid's scanning layout.
 */
export default function BrowseList({ cards, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {cards.map(card => (
        <div
          key={card.key}
          className="flex gap-3 p-3 rounded-box bg-base-200/40 ring-1 ring-base-300 hover:ring-primary/40 transition"
        >
          <button
            onClick={() => onSelect(card)}
            aria-label={`Open ${card.title}`}
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
              {card.open.card && (
                <span className="badge badge-ghost badge-sm">
                  {card.open.card.is_film ? 'Film' : 'Series'}
                </span>
              )}
              {card.year > 0 && (
                <span className="text-base-content/50 text-xs font-mono">{card.year}</span>
              )}
              <RatingBadge rating={card.rating} />
              {card.open.card && (
                <SaveToggles size="sm" className="ml-auto" entry={saveEntry(card.open.card, card.poster_url)} />
              )}
            </div>

            {card.genres.length > 0 && (
              <p className="text-xs text-base-content/50">{card.genres.slice(0, 4).join(' · ')}</p>
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
