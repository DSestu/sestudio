import { useEffect, useState } from 'react'
import type { CatalogInfo, SeasonCard } from '../../api'
import { searchSeasonsCached } from '../../api'
import { closeDiscoverMenu, closeDiscoverMenuThen, openDiscoverMenu, useDiscoverMenuOpen } from '../../discoverMenu'
import { useMergedCards } from '../../useMergedCards'
import { useModalBack } from '../../useModalBack'
import { recentCatalogs } from '../../useCatalogs'
import { useTitlesMeta, type TitleRef } from '../../useTitlesMeta'
import RatingBadge from '../RatingBadge'

// TMDB lists titles to look up on the sites rather than playing any itself,
// so it is set apart from the video sources wherever they are listed.
const TMDB = 'tmdb'
// With this few video sources the full list is already short; "Recent" would
// only repeat it.
const RECENT_FROM = 5
const RESULTS_SHOWN = 8

/**
 * The phone's Discover heading: names the open catalogue, and opens the
 * Discover menu to change it. (Desktop lists catalogues in the rail.)
 */
export default function SourcePicker({ catalogs, catalogId }: { catalogs: CatalogInfo[]; catalogId: string }) {
  const current = catalogs.find(c => c.id === catalogId)
  const isTmdb = catalogId === TMDB
  const open = useDiscoverMenuOpen()

  return (
    <div className="md:hidden flex flex-col gap-2">
      <button
        onClick={openDiscoverMenu}
        aria-expanded={open}
        aria-controls="discover-menu"
        className="self-start text-left rounded-box -mx-1 px-1 active:bg-base-200"
      >
        <span className="flex items-center gap-2 text-xl font-bold">
          {current?.label ?? catalogId}
          <svg className="w-4 h-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
          {isTmdb && <TmdbBadge />}
        </span>
        {current?.description && (
          <span className="block text-xs text-base-content/50">{current.description}</span>
        )}
        <span className="sr-only">Change source</span>
      </button>
      {isTmdb && (
        <p className="text-xs text-info/80 rounded-box border border-info/25 bg-info/5 px-3 py-2">
          Tap a title to find it on your video sources.
        </p>
      )}
    </div>
  )
}

function TmdbBadge() {
  return (
    <span className="badge badge-sm border-0 bg-success/15 text-success font-semibold">
      Finds a source
    </span>
  )
}

interface MenuProps {
  catalogs: CatalogInfo[]
  /** The catalogue Discover shows, and whether it is on screen right now. */
  catalogId: string
  onDiscover: boolean
  /** How the title search merges results, as the search page does. */
  preferredSite?: string
  mergeByTmdb?: boolean
  collapseSeasons?: boolean
  onOpenCatalog: (id: string) => void
  onOpenCard: (card: SeasonCard) => void
  onSearchTerm: (term: string) => void
}

/**
 * The phone's Discover menu: unfolds upward out of the tab bar, under a title
 * search, with TMDB pinned above the video sources. Stays mounted so folding
 * animates as unfolding does.
 */
export function DiscoverMenu({
  catalogs, catalogId, onDiscover, preferredSite, mergeByTmdb, collapseSeasons, onOpenCatalog, onOpenCard, onSearchTerm,
}: MenuProps) {
  const open = useDiscoverMenuOpen()
  useModalBack(open, closeDiscoverMenu)
  // The page under the menu must not scroll with it.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const before = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = before }
  }, [open])
  const [query, setQuery] = useState('')
  const q = query.trim()
  // A folded menu forgets the search, so it reopens on the list.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setQuery('')
  }

  const tmdb = catalogs.find(c => c.id === TMDB)
  const sites = catalogs.filter(c => c.id !== TMDB)
  const recent = sites.length >= RECENT_FROM
    ? recentCatalogs().flatMap(id => sites.filter(c => c.id === id))
    : []
  const choose = (id: string) =>
    id === catalogId && onDiscover ? closeDiscoverMenu() : closeDiscoverMenuThen(() => onOpenCatalog(id))
  const isOn = (id: string) => id === catalogId

  const row = (c: CatalogInfo) => (
    <button
      key={c.id}
      onClick={() => choose(c.id)}
      aria-current={isOn(c.id) ? 'true' : undefined}
      className={`flex w-full items-center gap-3 rounded-box px-3 py-2.5 text-left ${isOn(c.id) ? 'bg-base-300' : 'active:bg-base-300/60'}`}
    >
      <Initial label={c.label} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{c.label}</span>
        <span className="block text-xs text-base-content/50 truncate">{c.description}</span>
      </span>
      {isOn(c.id) && <span className="text-primary font-bold" aria-hidden="true">✓</span>}
    </button>
  )

  return (
    <div className="md:hidden">
      <div
        onClick={closeDiscoverMenu}
        aria-hidden="true"
        className={`fixed inset-0 z-30 bg-black/50 touch-none transition-opacity duration-300 motion-reduce:transition-none ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      {/* Ends at the tab bar's top edge and clips there, so the panel slides
          up out of the bar and back down into it. */}
      <div
        id="discover-menu"
        inert={!open}
        className={`fixed inset-x-0 z-[35] bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] overflow-hidden ${
          open ? '' : 'pointer-events-none'
        }`}
      >
        <div
          role="dialog"
          aria-label="Discover"
          className={`flex flex-col max-h-[70dvh] rounded-t-box border-t border-base-300 bg-base-200 transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          {/* Results preview as you type; Enter (the keyboard's Search key)
              goes to the full results page. */}
          <form
            role="search"
            onSubmit={e => {
              e.preventDefault()
              if (q) closeDiscoverMenuThen(() => onSearchTerm(q))
            }}
            className="px-4 pt-4 pb-3 shrink-0"
          >
            <label className="input input-bordered flex items-center gap-2 w-full">
              <svg className="w-4 h-4 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search titles on every source"
                aria-label="Search titles on every source"
                enterKeyHint="search"
                className="grow"
              />
            </label>
          </form>

          {q ? (
            <TitleResults
              query={q}
              catalogs={catalogs}
              preferredSite={preferredSite}
              mergeByTmdb={mergeByTmdb}
              collapseSeasons={collapseSeasons}
              onOpen={card => closeDiscoverMenuThen(() => onOpenCard(card))}
              onSeeAll={() => closeDiscoverMenuThen(() => onSearchTerm(q))}
            />
          ) : (
            <>
              {tmdb && (
                <div className="px-4 pb-3 border-b border-base-300 shrink-0">
                  <button
                    onClick={() => choose(TMDB)}
                    aria-current={isOn(TMDB) ? 'true' : undefined}
                    className="flex w-full items-center gap-3 rounded-box border border-info/40 bg-info/10 px-3 py-2.5 text-left"
                  >
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-[#0d253f] text-[#90cea1] flex items-center justify-center text-[10px] font-extrabold" aria-hidden="true">
                      TMDB
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-bold">{tmdb.label} <TmdbBadge /></span>
                      <span className="block text-xs text-base-content/60 truncate">{tmdb.description}</span>
                    </span>
                    {isOn(TMDB) && <span className="text-primary font-bold" aria-hidden="true">✓</span>}
                  </button>
                </div>
              )}
              <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
                {recent.length > 0 && (
                  <>
                    <SectionTitle>Recent</SectionTitle>
                    <div className="grid grid-cols-3 gap-2">
                      {recent.map(c => (
                        <button
                          key={c.id}
                          onClick={() => choose(c.id)}
                          className={`flex flex-col items-center gap-1 rounded-box bg-base-300 p-2 text-xs font-semibold ${isOn(c.id) ? 'ring-2 ring-primary' : ''}`}
                        >
                          <Initial label={c.label} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <SectionTitle>Video sources</SectionTitle>
                <div className="flex flex-col gap-0.5">{sites.map(row)}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mt-4 mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-base-content/50">
      {children}
    </h4>
  )
}

/** A source's initial on a tile, so a long list scans by more than text. */
function Initial({ label }: { label: string }) {
  return (
    <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-sm font-extrabold" aria-hidden="true">
      {label.slice(0, 1)}
    </span>
  )
}

interface Answer {
  query: string
  cards: SeasonCard[]
  failed: boolean
}

/** What the sites have for the typed title, one row per title, best first. */
function TitleResults({ query, catalogs, preferredSite, mergeByTmdb = false, collapseSeasons = true, onOpen, onSeeAll }: {
  query: string
  catalogs: CatalogInfo[]
  preferredSite?: string
  mergeByTmdb?: boolean
  collapseSeasons?: boolean
  onOpen: (card: SeasonCard) => void
  onSeeAll: () => void
}) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      searchSeasonsCached(query)
        .then(cards => { if (!cancelled) setAnswer({ query, cards, failed: false }) })
        .catch(() => { if (!cancelled) setAnswer({ query, cards: [], failed: true }) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  const current = answer?.query === query ? answer : null
  const [merged] = useMergedCards(current?.cards ?? [], mergeByTmdb, preferredSite, collapseSeasons)
  const shown = merged.slice(0, RESULTS_SHOWN)
  const refs: TitleRef[] = shown.map(c => ({ key: c.newsid, name: c.series_name, isFilm: c.is_film }))
  const metas = useTitlesMeta(refs, catalogs.some(c => c.id === TMDB), true)
  const label = (id?: string) => catalogs.find(c => c.id === (id || 'fstream'))?.label ?? id ?? ''

  if (!current) {
    return (
      <div className="flex justify-center py-10" aria-busy="true" aria-label="Searching">
        <span className="loading loading-spinner loading-md text-base-content/40" />
      </div>
    )
  }
  if (current.failed) {
    return <p role="alert" className="px-5 py-8 text-sm text-error">Search failed — is the server reachable?</p>
  }
  if (!merged.length) {
    return <p role="status" className="px-5 py-8 text-sm text-base-content/50 text-center">Nothing found for “{query}”.</p>
  }
  return (
    <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-5">
      <SectionTitle>Titles</SectionTitle>
      <ul className="flex flex-col">
        {shown.map(card => {
          const sources = [...new Set([card.source, ...(card.alts ?? []).map(a => a.source)].map(label))]
          const seasons = card.seasons?.length ?? 0
          return (
            <li key={card.newsid} className="border-b border-base-300 last:border-0">
              <button onClick={() => onOpen(card)} className="flex w-full gap-3 py-2.5 text-left">
                {card.poster_url ? (
                  <img src={card.poster_url} alt="" loading="lazy" className="w-10 aspect-[2/3] rounded object-cover shrink-0" />
                ) : (
                  <span className="w-10 aspect-[2/3] rounded bg-base-300 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{card.series_name}</span>
                  <span className="block text-xs text-base-content/50">
                    {[card.is_film ? 'Film' : 'Series', card.year || null, seasons > 1 ? `${seasons} seasons` : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {sources.map(s => (
                      <span key={s} className="badge badge-sm badge-ghost">{s}</span>
                    ))}
                  </span>
                </span>
                <RatingBadge rating={metas.get(card.newsid)?.rating ?? 0} className="self-start shrink-0" />
              </button>
            </li>
          )
        })}
      </ul>
      <button onClick={onSeeAll} className="mt-3 w-full text-center text-sm font-semibold text-primary py-2">
        See all {merged.length} result{merged.length === 1 ? '' : 's'} →
      </button>
    </div>
  )
}
