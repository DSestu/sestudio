import type { ReactNode } from 'react'
import type { CatalogInfo, SeasonCard } from '../../api'
import type { Kind, TitleSearch } from '../../titleSearch'
import { KINDS, PREVIEW_ROWS } from '../../titleSearch'
import RatingBadge from '../RatingBadge'

// The pieces every title search is drawn with, on desktop and on phones.

export function SearchIcon() {
  return (
    <svg className="w-4 h-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  )
}

export function KindChips({ value, onChange }: { value: Kind; onChange: (kind: Kind) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
      {KINDS.map(k => (
        <button
          key={k.value}
          type="button"
          role="radio"
          aria-checked={k.value === value}
          onClick={() => onChange(k.value)}
          className={`badge cursor-pointer transition-colors ${k.value === value ? 'badge-primary' : 'badge-ghost hover:badge-outline'}`}
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}

interface ResultsProps {
  search: TitleSearch
  query: string
  catalogs: CatalogInfo[]
  /** Rows are options of this listbox, so the field can point at the active one. */
  listId: string
  /** The row Enter would open (keyboard), -1 for none. */
  active?: number
  onActive?: (index: number) => void
  onOpen: (card: SeasonCard) => void
  onSeeAll: () => void
  /** Shown beside "See all" (the desktop's key hints). */
  footer?: ReactNode
}

/** A search's preview: what the sites have for the query, one row per title. */
export function TitleResults({ search, query, catalogs, listId, active = -1, onActive, onOpen, onSeeAll, footer }: ResultsProps) {
  const label = (id?: string) => catalogs.find(c => c.id === (id || 'fstream'))?.label ?? id ?? ''

  if (search.status === 'loading') {
    return (
      <div className="flex justify-center py-8" aria-busy="true" aria-label="Searching">
        <span className="loading loading-spinner loading-md text-base-content/40" />
      </div>
    )
  }
  if (search.status === 'failed') {
    return <p role="alert" className="px-2 py-6 text-sm text-error">Search failed — is the server reachable?</p>
  }
  if (!search.cards.length) {
    return <p role="status" className="px-2 py-6 text-sm text-base-content/50 text-center">Nothing found for “{query}”.</p>
  }
  const total = search.cards.length
  return (
    <div className="flex flex-col">
      <h4 className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-base-content/50">Titles</h4>
      <ul id={listId} role="listbox" aria-label="Titles" className="flex flex-col gap-0.5">
        {search.cards.slice(0, PREVIEW_ROWS).map((card, i) => {
          const sources = [...new Set([card.source, ...(card.alts ?? []).map(a => a.source)].map(label))]
          const seasons = card.seasons?.length ?? 0
          return (
            <li
              key={card.newsid}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onClick={() => onOpen(card)}
              onMouseEnter={() => onActive?.(i)}
              className={`flex cursor-pointer gap-3 rounded-box px-2 py-2 ${i === active ? 'bg-base-300' : 'active:bg-base-300/60'}`}
            >
              {card.poster_url ? (
                <img src={card.poster_url} alt="" loading="lazy" className="w-10 aspect-[2/3] rounded object-cover shrink-0" />
              ) : (
                <span className="w-10 aspect-[2/3] rounded bg-base-300 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{card.series_name}</span>
                <span className="block text-xs text-base-content/50">
                  {[card.is_anime ? 'Anime' : card.is_film ? 'Film' : 'Series', card.year || null, seasons > 1 ? `${seasons} seasons` : null]
                    .filter(Boolean).join(' · ')}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {sources.map(s => <span key={s} className="badge badge-sm badge-ghost">{s}</span>)}
                </span>
              </span>
              <RatingBadge rating={search.ratings.get(card.newsid) ?? 0} className="self-start shrink-0" />
            </li>
          )
        })}
      </ul>
      <div className="mt-2 flex items-center gap-3 border-t border-base-300 px-2 pt-2">
        {footer}
        <button type="button" onClick={onSeeAll} className="ml-auto text-sm font-semibold text-primary py-1">
          See all {total} result{total === 1 ? '' : 's'} →
        </button>
      </div>
    </div>
  )
}
