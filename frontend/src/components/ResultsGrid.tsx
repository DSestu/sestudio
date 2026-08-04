import type { SeasonCard } from '../api'
import { useTmdb } from '../useTmdb'
import SaveToggles from './SaveToggles'

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

  // Two across on a phone, so the always-visible touch controls fit (#26).
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
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
    <div className="group relative">
      {/* Selection — checkbox overlay, sits outside the poster button */}
      <button
        onClick={onToggle}
        aria-label={checked ? `Deselect ${card.series_name}` : `Select ${card.series_name}`}
        aria-pressed={checked}
        className={`absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition ${
          checked
            ? 'bg-primary border-primary'
            : 'bg-base-100/70 border-base-content/40 hover:border-primary [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100'
        }`}
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
          className="absolute top-1.5 right-1.5 z-10 badge badge-sm bg-base-100/80 border-none gap-0.5"
          title={`TMDB rating ${meta.rating}/10`}
        >
          ★ {meta.rating.toFixed(1)}
        </span>
      )}

      {/* Save controls sit outside the poster button — nesting buttons is invalid.
          Overlaid only where a pointer can hover; touch gets them in the caption
          below, since search is where saving actually happens (#26). */}
      <div className="hidden [@media(hover:hover)]:block absolute bottom-[4.25rem] right-1.5 z-10 rounded-box bg-base-100/80 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <SaveToggles
          size="sm"
          entry={{
            series: card.series_name,
            season: card.is_film ? 0 : card.season_number,
            label: card.series_name,
            poster_url: poster,
            page_url: card.page_url,
            lang: '',
          }}
        />
      </div>

      <button className="w-full text-left" onClick={onOpenDetail}>
        <div className={`relative rounded-box overflow-hidden bg-base-200 ring-1 transition ${
          checked ? 'ring-2 ring-primary' : 'ring-base-300 group-hover:ring-primary/70'
        }`}>
          {poster ? (
            <img src={poster} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover" />
          ) : (
            <div className="w-full aspect-[2/3] bg-base-300 flex items-center justify-center text-base-content/30 text-3xl">?</div>
          )}
          <span className="pointer-events-none absolute inset-0 hidden [@media(hover:hover)]:flex items-center justify-center bg-base-100/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="btn btn-circle btn-primary btn-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
        </div>
        <p className="text-xs sm:text-sm font-medium leading-tight truncate mt-2">
          {card.series_name}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {/* Kind is carried by the badge text, not by colour alone */}
          {card.is_film ? (
            <span className="badge badge-ghost badge-sm">Film</span>
          ) : card.is_anime ? (
            <span className="badge badge-ghost badge-sm">
              Anime S{String(card.season_number).padStart(2, '0')}
            </span>
          ) : (
            <span className="badge badge-ghost badge-sm">
              S{String(card.season_number).padStart(2, '0')}
            </span>
          )}
          {year > 0 && <span className="text-base-content/40 text-xs font-mono">{year}</span>}
          {/* Says why this is one card when the source listed the title several
              times — the languages themselves only load with the detail. */}
          {card.alt_page_urls && card.alt_page_urls.length > 0 && (
            <span
              className="badge badge-ghost badge-sm"
              title={`${card.alt_page_urls.length + 1} source pages for this title`}
            >
              {card.alt_page_urls.length + 1} sources
            </span>
          )}
        </div>
      </button>

      {/* Touch: the same save controls, permanently visible under the caption. */}
      <div className="flex [@media(hover:hover)]:hidden items-center mt-1">
        <SaveToggles
          size="sm"
          entry={{
            series: card.series_name,
            season: card.is_film ? 0 : card.season_number,
            label: card.series_name,
            poster_url: poster,
            page_url: card.page_url,
            lang: '',
          }}
        />
      </div>
    </div>
  )
}
