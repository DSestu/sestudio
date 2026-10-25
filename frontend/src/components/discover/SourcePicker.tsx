import { type ReactNode, useEffect, useState } from 'react'
import type { CatalogInfo, SeasonCard } from '../../api'
import { closeDiscoverMenu, closeDiscoverMenuThen, openDiscoverMenu, useDiscoverMenuOpen } from '../../discoverMenu'
import { useModalBack } from '../../useModalBack'
import { recentCatalogs } from '../../useCatalogs'
import { type Kind, SEARCH_FIELD, useTitleSearch } from '../../titleSearch'
import { KindChips, SearchIcon, TitleResults } from '../search/SearchParts'

// TMDB lists titles to look up on the sites rather than playing any itself,
// so it is set apart from the video sources wherever they are listed.
const TMDB = 'tmdb'
// With this few video sources the full list is already short; "Recent" would
// only repeat it.
const RECENT_FROM = 5

/**
 * The Discover heading: names the open catalogue and what it holds. On a phone
 * it opens the Discover menu to change it; on desktop the rail does that, so
 * the heading links out to the catalogue's own site instead.
 */
export default function SourcePicker({ catalogs, catalogId }: { catalogs: CatalogInfo[]; catalogId: string }) {
  const current = catalogs.find(c => c.id === catalogId)
  const isTmdb = catalogId === TMDB
  const open = useDiscoverMenuOpen()

  return (
    <div className="flex flex-col gap-2">
      <div className="hidden md:flex items-end gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {current?.label ?? catalogId}
            {isTmdb && <TmdbBadge />}
          </h2>
          {current?.description && (
            <p className="text-sm text-base-content/50">{current.description}</p>
          )}
        </div>
        {current?.url && (
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-base-300 px-3 h-8 text-xs text-base-content/60 hover:text-base-content hover:border-base-content/30"
          >
            {new URL(current.url).hostname.replace(/^www\./, '')}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5h6v6M19 5l-8 8M10 5H5v14h14v-5" />
            </svg>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
      <button
        onClick={openDiscoverMenu}
        aria-expanded={open}
        aria-controls="discover-menu"
        className="md:hidden self-start text-left rounded-box -mx-1 px-1 active:bg-base-200"
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
          <span className="md:hidden">Tap</span><span className="max-md:hidden">Click</span> a title to find it on your video sources.
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
  onSearchTerm: (term: string, kind: Kind) => void
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
  const [kind, setKind] = useState<Kind>('all')
  const q = query.trim()
  const search = useTitleSearch(
    q, kind, { preferredSite, mergeByTmdb, collapseSeasons }, catalogs.some(c => c.id === TMDB),
  )
  // A folded menu forgets the search, so it reopens on the list.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) { setQuery(''); setKind('all') }
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
              if (q) closeDiscoverMenuThen(() => onSearchTerm(q, kind))
            }}
            className="px-4 pt-4 pb-3 shrink-0"
          >
            <label className={SEARCH_FIELD}>
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search titles on every source"
                aria-label="Search titles on every source"
                enterKeyHint="search"
                className="grow bg-transparent outline-none text-sm min-w-0"
              />
            </label>
            {q && <div className="mt-3"><KindChips value={kind} onChange={setKind} /></div>}
          </form>

          {q ? (
            <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-4">
              <TitleResults
                search={search}
                query={q}
                catalogs={catalogs}
                listId="discover-menu-results"
                onOpen={card => closeDiscoverMenuThen(() => onOpenCard(card))}
                onSeeAll={() => closeDiscoverMenuThen(() => onSearchTerm(q, kind))}
              />
            </div>
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

function SectionTitle({ children }: { children: ReactNode }) {
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
