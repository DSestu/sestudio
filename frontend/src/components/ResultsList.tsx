import type { SeasonCard } from '../api'
import { useTmdb } from '../useTmdb'
import { kindLabel, saveEntry, seasonsLabel } from './resultMeta'
import RatingBadge from './RatingBadge'
import SaveToggles from './SaveToggles'
import SourcesBadge from './SourcesBadge'

interface Props {
  cards: SeasonCard[]
  checkedIds: Set<string>
  onToggle: (newsid: string) => void
  onOpenDetail: (card: SeasonCard) => void
  /** Look a title up on TMDB at all — set when a key is configured. */
  enrich?: boolean
  /** Let a TMDB poster stand in for the source's own. Artwork only. */
  posters?: boolean
}

/**
 * Search results as horizontal rows with room for the synopsis, genres and year
 * — the reading layout, against the grid's scanning layout.
 *
 * The synopsis and genres come from TMDB and have no equivalent in the scraped
 * listing, so with enrichment off a row carries only what the grid does, laid
 * out wider. That is the honest degradation: the layout is still useful for the
 * longer titles the grid truncates.
 */
export default function ResultsList({ cards, checkedIds, onToggle, onOpenDetail, enrich, posters }: Props) {
  if (!cards.length) return null

  return (
    <div className="flex flex-col gap-2">
      {cards.map(card => (
        <ResultRow
          key={card.newsid}
          card={card}
          checked={checkedIds.has(card.newsid)}
          onToggle={() => onToggle(card.newsid)}
          onOpenDetail={onOpenDetail}
          enrich={!!enrich}
          posters={!!posters}
        />
      ))}
    </div>
  )
}

interface RowProps {
  card: SeasonCard
  checked: boolean
  onToggle: () => void
  onOpenDetail: (card: SeasonCard) => void
  enrich: boolean
  posters: boolean
}

function ResultRow({ card, checked, onToggle, onOpenDetail, enrich, posters }: RowProps) {
  const meta = useTmdb(card.series_name, card.year ?? 0, card.is_film, enrich)
  const poster = (posters ? meta?.poster_url : '') || card.poster_url
  const year = meta?.year || card.year || 0
  // Room for more genres than the grid card, but not for a wrapping pile.
  const genres = (meta?.genres ?? []).slice(0, 4)

  return (
    <div
      className={`flex gap-3 p-3 rounded-box bg-base-200/40 ring-1 transition ${
        checked ? 'ring-2 ring-primary' : 'ring-base-300 hover:ring-primary/40'
      }`}
    >
      <button
        onClick={() => onOpenDetail(card)}
        aria-label={`Open ${card.series_name}`}
        className="shrink-0 self-start w-24 sm:w-30 rounded-box overflow-hidden bg-base-300"
      >
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="w-full aspect-[2/3] object-cover" />
        ) : (
          <div className="w-full aspect-[2/3] flex items-center justify-center text-base-content/30 text-2xl">?</div>
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <button onClick={() => onOpenDetail(card)} className="min-w-0 flex-1 text-left">
            {/* Wraps rather than truncating: the width is the point of this layout. */}
            <p className="font-medium leading-tight">{meta?.title || card.series_name}</p>
          </button>
          {/* Selection drives the bulk download, same as in the grid. */}
          <button
            onClick={onToggle}
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? `Deselect ${card.series_name}` : `Select ${card.series_name}`}
            className={`shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
              checked ? 'bg-primary border-primary' : 'bg-base-100/80 border-base-content/40 hover:border-primary'
            }`}
          >
            {checked && (
              <svg className="w-3.5 h-3.5 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="badge badge-ghost badge-sm">{kindLabel(card)}</span>
          {seasonsLabel(card) && (
            <span className="badge badge-outline badge-sm">{seasonsLabel(card)}</span>
          )}
          {year > 0 && <span className="text-base-content/50 text-xs font-mono">{year}</span>}
          {meta && <RatingBadge rating={meta.rating} />}
          <SourcesBadge card={card} onOpen={onOpenDetail} />
        </div>

        {genres.length > 0 && (
          <p className="text-xs text-base-content/50">{genres.join(' · ')}</p>
        )}

        {meta?.overview && (
          <p className="text-sm text-base-content/70 leading-snug line-clamp-3">
            {meta.overview}
          </p>
        )}

        <div className="flex items-center mt-0.5">
          <SaveToggles size="sm" entry={saveEntry(card, poster)} />
        </div>
      </div>
    </div>
  )
}
