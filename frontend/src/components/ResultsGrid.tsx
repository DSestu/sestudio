import type { SeasonCard } from '../api'
import { useTmdb } from '../useTmdb'

interface Props {
  cards: SeasonCard[]
  checkedIds: Set<string>
  onToggle: (newsid: string) => void
  onOpenDetail: (card: SeasonCard) => void
  /** Enrich cards with TMDB rating/year when a key is configured. */
  enrich?: boolean
}

export default function ResultsGrid({ cards, checkedIds, onToggle, onOpenDetail, enrich }: Props) {
  if (!cards.length) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {cards.map(card => (
        <ResultCard
          key={card.newsid}
          card={card}
          checked={checkedIds.has(card.newsid)}
          onToggle={() => onToggle(card.newsid)}
          onOpenDetail={() => onOpenDetail(card)}
          enrich={!!enrich}
        />
      ))}
    </div>
  )
}

interface CardProps {
  card: SeasonCard
  checked: boolean
  onToggle: () => void
  onOpenDetail: () => void
  enrich: boolean
}

function ResultCard({ card, checked, onToggle, onOpenDetail, enrich }: CardProps) {
  // Falls back to the source's own poster/title when TMDB is off or unmatched.
  const meta = useTmdb(card.series_name, card.year ?? 0, card.is_film, enrich)
  const poster = meta?.poster_url || card.poster_url
  const year = meta?.year || card.year || 0

  return (
          <div
            className={`relative bg-base-200 border rounded-lg overflow-hidden transition-colors ${
              checked
                ? 'border-primary'
                : card.is_film
                ? 'border-info/50 hover:border-info'
                : card.is_anime
                ? 'border-error/50 hover:border-error'
                : 'border-warning/50 hover:border-warning'
            }`}
          >
            {/* Checkbox overlay */}
            <button
              onClick={onToggle}
              className={`absolute top-2 left-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                checked
                  ? 'bg-primary border-primary'
                  : 'bg-black/50 border-base-content/40 hover:border-primary'
              }`}
              aria-label={checked ? 'Deselect season' : 'Select season'}
            >
              {checked && (
                <svg className="w-3 h-3 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Rating from TMDB, when enrichment found a match */}
            {meta && meta.rating > 0 && (
              <span
                className="absolute top-2 right-2 z-10 badge badge-sm bg-black/70 border-none text-white gap-0.5"
                title={`TMDB rating ${meta.rating}/10`}
              >
                ★ {meta.rating.toFixed(1)}
              </span>
            )}

            {/* Poster — click to open detail */}
            <button className="w-full text-left" onClick={onOpenDetail}>
              {poster ? (
                <img
                  src={poster}
                  alt={card.title}
                  loading="lazy"
                  className="w-full aspect-[2/3] object-cover"
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-base-300 flex items-center justify-center text-base-content/30 text-4xl">
                  ?
                </div>
              )}
              <div className="p-2">
                <p className="text-sm font-medium leading-tight truncate">
                  {card.series_name}
                </p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {card.is_film ? (
                    <span className="badge badge-info badge-sm">Film</span>
                  ) : card.is_anime ? (
                    <span className="badge badge-error badge-sm">
                      Anime S{String(card.season_number).padStart(2, '0')}
                    </span>
                  ) : (
                    <span className="badge badge-warning badge-sm">
                      S{String(card.season_number).padStart(2, '0')}
                    </span>
                  )}
                  {year > 0 && (
                    <span className="text-base-content/50 text-xs font-mono">{year}</span>
                  )}
                </div>
              </div>
            </button>
          </div>
  )
}
