import { useState } from 'react'
import type { SeasonCard } from '../api'
import { useTmdb } from '../useTmdb'
import RatingBadge from './RatingBadge'
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
          onOpenDetail={onOpenDetail}
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
  /** Takes the card so a merged-away source can be opened on its own. */
  onOpenDetail: (card: SeasonCard) => void
  enrich: boolean
}

function ResultCard({ card, checked, onToggle, onOpenDetail, enrich }: CardProps) {
  // Falls back to the source's own poster/title when TMDB is off or unmatched.
  const meta = useTmdb(card.series_name, card.year ?? 0, card.is_film, enrich)
  const poster = meta?.poster_url || card.poster_url
  const year = meta?.year || card.year || 0
  // Merging same-name titles is a heuristic and will sometimes be wrong, so the
  // pages it folded away stay reachable rather than being lost behind the count.
  const alts = card.alts ?? []
  const [showSources, setShowSources] = useState(false)

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
      {meta && (
        <RatingBadge rating={meta.rating} className="absolute top-1.5 right-1.5 z-10" />
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

      <button className="w-full text-left" onClick={() => onOpenDetail(card)}>
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
      </button>

      {/* Badges sit outside the poster button: the sources count is itself a
          button, and nesting buttons is invalid. */}
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
            times, and opens up to the pages themselves — same-name titles do get
            merged wrongly, and this is how the other one is reached. */}
        {alts.length > 0 && (
          <button
            onClick={() => setShowSources(v => !v)}
            aria-expanded={showSources}
            className="badge badge-ghost badge-sm gap-1 hover:bg-base-300"
            title={`${alts.length + 1} source pages for this title`}
          >
            {alts.length + 1} sources
            <svg
              className={`w-2.5 h-2.5 transition-transform ${showSources ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {showSources && (
        <ul className="mt-1.5 flex flex-col gap-0.5 rounded-box bg-base-200 p-1.5">
          {[card, ...alts].map((src, i) => (
            <li key={src.newsid || src.page_url}>
              <button
                onClick={() => onOpenDetail(src)}
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
