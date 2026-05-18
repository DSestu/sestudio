import type { SeasonCard } from '../api'

interface Props {
  cards: SeasonCard[]
  checkedIds: Set<string>
  onToggle: (newsid: string) => void
  onOpenDetail: (card: SeasonCard) => void
}

export default function ResultsGrid({ cards, checkedIds, onToggle, onOpenDetail }: Props) {
  if (!cards.length) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {cards.map(card => {
        const checked = checkedIds.has(card.newsid)
        return (
          <div
            key={card.newsid}
            className={`relative bg-base-200 border rounded-lg overflow-hidden transition-colors ${
              checked
                ? 'border-violet-500'
                : card.is_film
                ? 'border-blue-700 hover:border-blue-500'
                : card.is_anime
                ? 'border-rose-700 hover:border-rose-500'
                : 'border-yellow-700 hover:border-yellow-500'
            }`}
          >
            {/* Checkbox overlay */}
            <button
              onClick={() => onToggle(card.newsid)}
              className={`absolute top-2 left-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                checked
                  ? 'bg-violet-600 border-violet-600'
                  : 'bg-black/50 border-zinc-400 hover:border-violet-400'
              }`}
              aria-label={checked ? 'Deselect season' : 'Select season'}
            >
              {checked && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Poster — click to open detail */}
            <button className="w-full text-left" onClick={() => onOpenDetail(card)}>
              {card.poster_url ? (
                <img
                  src={card.poster_url}
                  alt={card.title}
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
                <div className="flex items-center gap-1 mt-1">
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
                </div>
              </div>
            </button>
          </div>
        )
      })}
    </div>
  )
}
