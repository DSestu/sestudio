import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { SeasonCard } from '../../api'
import type { Kind, RecentSearch, TitleSearch } from '../../titleSearch'
import { KINDS, PREVIEW_ROWS, TITLE_KINDS, kindLabel } from '../../titleSearch'
import RatingBadge from '../RatingBadge'
import { OPTIONS_ID, toggleSearchOptions, useSearchOptions } from '../../searchOptions'

// The pieces every title search is drawn with, on desktop and on phones. A
// preview keeps one job per state (pick a past search, go to the results
// page, pick a title) and names at most a few titles: details are the page's.

export function SearchIcon() {
  return (
    <svg className="w-4 h-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
    </svg>
  )
}

// Where each chip set's blue bar last sat, kept outside the component: a pick
// re-runs the search, which can remount the chips, and the bar should slide on
// from there rather than appear.
const lastBar = new Map<typeof KINDS, { x: number; w: number }>()

/** A pill's outline as an SVG path, for clipping the blue bar to the chips. */
function pillPath(el: HTMLElement) {
  const { offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h } = el
  const r = h / 2
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
}

/** Kind chips; ←/→ step through them when one has focus. The picked chip's blue
 *  is one bar that slides between chips, seen only through the chips' outlines. */
export function KindChips({ value, onChange, small = false, kinds = TITLE_KINDS }: { value: Kind; onChange: (kind: Kind) => void; small?: boolean; kinds?: typeof KINDS }) {
  const index = kinds.findIndex(k => k.value === value)
  const group = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState(() => lastBar.get(kinds))
  const [clip, setClip] = useState('')
  // shortcut: measured on pick only, not on resize; chips are fixed-size labels.
  useLayoutEffect(() => {
    const chips = [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])]
    const on = chips[index]
    if (!on) return
    setClip(chips.map(pillPath).join(''))
    const next = { x: on.offsetLeft, w: on.offsetWidth }
    lastBar.set(kinds, next)
    // A frame later, so the bar is painted where it was before it moves.
    const id = requestAnimationFrame(() => setBar(next))
    return () => cancelAnimationFrame(id)
  }, [kinds, index, small])
  const pick = (next: number) => onChange(kinds[next].value)
  const onKeys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    pick((index + (e.key === 'ArrowRight' ? 1 : -1) + kinds.length) % kinds.length)
    const g = e.currentTarget
    requestAnimationFrame(() => g.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div ref={group} className="relative flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind" onKeyDown={onKeys}>
      {/* The chips' fill, clipped to their outlines, with the blue bar inside. */}
      <div aria-hidden="true" className="absolute inset-0 bg-base-200" style={{ clipPath: clip ? `path('${clip}')` : 'none' }}>
        {bar && (
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-[transform,width] duration-300 ease-smooth motion-reduce:transition-none"
            style={{ transform: `translateX(${bar.x}px)`, width: bar.w }}
          />
        )}
      </div>
      {kinds.map((k, i) => (
        <button
          key={k.value}
          type="button"
          role="radio"
          aria-checked={k.value === value}
          tabIndex={k.value === value ? 0 : -1}
          onClick={() => pick(i)}
          className={`relative badge ${small ? 'badge-sm' : ''} cursor-pointer border-transparent bg-transparent transition-colors duration-300 ${k.value === value ? 'text-primary-content' : 'hover:border-base-content/30'}`}
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}

/** The phone's kind picker: equal segments on one line that never wraps, each
 *  with its result count under the label, and a thumb that slides to the pick. */
export function KindSegments({ value, onChange, counts }: { value: Kind; onChange: (kind: Kind) => void; counts?: Record<Kind, number> }) {
  const index = KINDS.findIndex(k => k.value === value)
  return (
    <div
      role="radiogroup"
      aria-label="Kind"
      className="relative grid rounded-box bg-base-200 p-0.5"
      style={{ gridTemplateColumns: `repeat(${KINDS.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 rounded-box bg-primary transition-transform duration-[260ms] ease-smooth motion-reduce:transition-none"
        style={{ width: `calc((100% - 0.25rem) / ${KINDS.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {KINDS.map(k => (
        <button
          key={k.value}
          type="button"
          role="radio"
          aria-checked={k.value === value}
          onClick={() => onChange(k.value)}
          className={`relative py-1.5 text-sm leading-tight transition-colors duration-200 ${k.value === value ? 'text-primary-content font-semibold' : k.value === 'people' && counts?.people === 0 ? 'text-base-content/30' : 'text-base-content/60'}`}
        >
          {k.value === 'all' ? 'All' : k.label}
          {counts && <span className="block text-[10px] tabular-nums opacity-75">{counts[k.value]}</span>}
        </button>
      ))}
    </div>
  )
}

const sectionTitle ='px-2 text-[11px] font-bold uppercase tracking-wide text-base-content/50'

interface ResultsProps {
  search: TitleSearch
  query: string
  kind: Kind
  onKind: (kind: Kind) => void
  /** Rows are options of this listbox, so the field can point at the active one. */
  listId: string
  /** Row 0 is the results page, row i the (i-1)th title; -1 for none. */
  active?: number
  onActive?: (index: number) => void
  onOpen: (card: SeasonCard) => void
  onSeeAll: () => void
  /** The key Enter is, shown on the results-page row (desktop). */
  enterHint?: boolean
  /** Phones put the results-page link elsewhere and list every title. */
  seeAllRow?: boolean
  limit?: number
  footer?: ReactNode
}

const resultOptionId = (listId: string, index: number) => `${listId}-${index}`

/** A search's preview: the results page first, then a few titles, one line each. */
export function TitleResults({ search, query, kind, onKind, listId, active = -1, onActive, onOpen, onSeeAll, enterHint = false, seeAllRow = true, limit = PREVIEW_ROWS, footer }: ResultsProps) {
  const total = search.cards.length
  const sources = new Set(search.cards.flatMap(c => [c.source || 'fstream', ...(c.alts ?? []).map(a => a.source || 'fstream')]))
  const status =
    search.status === 'loading' ? 'searching every source…'
      : search.status === 'failed' ? 'search failed — is the server reachable?'
        : `${total} title${total === 1 ? '' : 's'} · ${sources.size} source${sources.size === 1 ? '' : 's'}`
  const rows = search.cards.slice(0, limit)

  return (
    <div className="flex flex-col">
      <ul id={listId} role="listbox" aria-label="Search results" className="flex flex-col">
        {seeAllRow && <li
          id={resultOptionId(listId, 0)}
          role="option"
          aria-selected={active === 0}
          onClick={onSeeAll}
          onMouseEnter={() => onActive?.(0)}
          className={`flex cursor-pointer items-center gap-3 rounded-box border px-3 py-2.5 ${
            active === 0 ? 'border-primary/50 bg-primary/20' : 'border-primary/30 bg-primary/10'
          }`}
        >
          <span className="w-8 h-8 shrink-0 rounded-lg bg-primary text-primary-content flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold truncate">See every result for “{query}”</span>
            <span className={`flex items-center gap-1.5 text-xs ${search.status === 'failed' ? 'text-error' : 'text-base-content/50'}`}>
              {search.status === 'loading' && <span className="loading loading-spinner loading-xs" />}
              {status}
            </span>
          </span>
          {enterHint ? <kbd className="kbd kbd-sm">Enter</kbd> : <span className="text-primary text-lg" aria-hidden="true">›</span>}
        </li>}

        {search.status === 'done' && total > 0 && (
          <>
            <li role="presentation" className={`${seeAllRow ? 'mt-3' : ''} mb-1 flex items-center gap-3`}>
              <span className={sectionTitle}>Titles</span>
              <span className="ml-auto"><KindChips value={kind} onChange={onKind} small /></span>
            </li>
            {rows.map((card, i) => {
              const n = new Set([card.source || 'fstream', ...(card.alts ?? []).map(a => a.source || 'fstream')]).size
              const index = i + 1
              return (
                <li
                  key={card.newsid}
                  id={resultOptionId(listId, index)}
                  role="option"
                  aria-selected={index === active}
                  onClick={() => onOpen(card)}
                  onMouseEnter={() => onActive?.(index)}
                  className={`flex cursor-pointer items-center gap-3 rounded-box px-2 py-1.5 ${index === active ? 'bg-base-300' : 'active:bg-base-300/60'}`}
                >
                  {card.poster_url ? (
                    <img src={card.poster_url} alt="" loading="lazy" className="w-6 aspect-[2/3] rounded-sm object-cover shrink-0" />
                  ) : (
                    <span className="w-6 aspect-[2/3] rounded-sm bg-base-300 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{card.series_name}</span>
                    <span className="block text-xs text-base-content/50 truncate">
                      {[card.is_anime ? 'Anime' : card.is_film ? 'Film' : 'Series', card.year || null, `${n} source${n === 1 ? '' : 's'}`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <RatingBadge rating={search.ratings.get(card.newsid) ?? 0} className="shrink-0" />
                </li>
              )
            })}
          </>
        )}
      </ul>

      {search.status === 'done' && total === 0 && (
        <div className="mt-3 flex flex-col gap-2 px-2">
          <KindChips value={kind} onChange={onKind} small />
          <p role="status" className="text-sm text-base-content/50">
            Nothing{kind === 'all' ? '' : ` of that kind`} for “{query}”.
          </p>
        </div>
      )}
      {total > limit && (
        <button type="button" onClick={onSeeAll} className="mt-1 px-2 py-1 text-left text-xs text-base-content/50">
          +{total - PREVIEW_ROWS} more — <span className="font-semibold text-primary">on the results page</span>
        </button>
      )}
      {footer && search.status === 'done' && total > 0 && (
        <div className="mt-2 border-t border-base-300 px-2 pt-2">{footer}</div>
      )}
    </div>
  )
}

/** Past searches as a list (desktop, where the empty panel has room). */
export function RecentSearchList({ items, listId, active = -1, onActive, onPick, onClear }: {
  items: RecentSearch[]
  listId: string
  active?: number
  onActive?: (index: number) => void
  onPick: (item: RecentSearch) => void
  onClear: () => void
}) {
  if (!items.length) {
    return <p className="px-2 py-3 text-sm text-base-content/50">Type a title. Enter shows every result; ↓ picks one.</p>
  }
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center">
        <span className={sectionTitle}>Recent</span>
        <button type="button" onClick={onClear} className="ml-auto px-2 text-xs font-semibold text-primary">Clear</button>
      </div>
      <ul id={listId} role="listbox" aria-label="Recent searches" className="flex flex-col">
        {items.map((r, i) => (
          <li
            key={r.term}
            id={resultOptionId(listId, i)}
            role="option"
            aria-selected={i === active}
            onClick={() => onPick(r)}
            onMouseEnter={() => onActive?.(i)}
            className={`flex cursor-pointer items-center gap-2 rounded-box px-2 py-1.5 text-sm ${i === active ? 'bg-base-300' : ''}`}
          >
            <span className="text-base-content/40" aria-hidden="true">↺</span>
            <span className="truncate">{r.term}</span>
            {kindLabel(r.kind) && <span className="ml-auto text-xs text-base-content/50">{kindLabel(r.kind)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Past searches as one sideways row of chips (phones, where the sources
 *  must still fit under them). */
export function RecentSearchChips({ items, onPick, onClear }: {
  items: RecentSearch[]
  onPick: (item: RecentSearch) => void
  onClear: () => void
}) {
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center">
        <span className={sectionTitle}>Recent</span>
        <button type="button" onClick={onClear} className="ml-auto px-2 text-xs font-semibold text-primary">Clear</button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-2">
        {items.map(r => (
          <button
            key={r.term}
            type="button"
            onClick={() => onPick(r)}
            className="shrink-0 rounded-full border border-base-300 bg-base-300 px-3 py-1 text-sm"
          >
            {r.term}
            {kindLabel(r.kind) && <span className="text-base-content/50"> · {kindLabel(r.kind)}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Opens the search page's Options fold. Closed, it says what isn't at its
 *  default: as text on desktop, as a dot on the phone (`square`, the compact one). */
export function OptionsButton({ square = false }: { square?: boolean }) {
  const { open, summary } = useSearchOptions()
  const label = summary ? `Options, ${summary}` : 'Options'
  return (
    <button
      type="button"
      onClick={toggleSearchOptions}
      aria-expanded={open}
      aria-controls={OPTIONS_ID}
      aria-label={label}
      className={`btn relative shrink-0 gap-1.5 ${square ? 'px-3' : 'btn-sm'} ${open ? 'btn-primary' : 'bg-primary/15 text-primary border-primary/40'}`}
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
      <span className="text-sm font-semibold">Options</span>
      {!square && summary && !open && <span className="badge badge-sm bg-primary text-primary-content border-0">{summary}</span>}
      {square && summary && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-base-100" aria-hidden="true" />}
    </button>
  )
}
