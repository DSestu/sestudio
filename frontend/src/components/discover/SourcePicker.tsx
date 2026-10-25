import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { CatalogInfo, SeasonCard } from '../../api'
import { closeDiscoverMenu, closeDiscoverMenuThen, openDiscoverMenu, useDiscoverMenuOpen } from '../../discoverMenu'
import { useModalBack } from '../../useModalBack'
import { useSourcePosters } from './sourcePosters'
import { type Kind, SEARCH_FIELD, clearRecentSearches, useRecentSearches, useTitleSearch } from '../../titleSearch'
import { RecentSearchChips, SearchIcon, TitleResults } from '../search/SearchParts'

// TMDB lists titles to look up on the sites rather than playing any itself,
// so it is set apart from the video sources wherever they are listed.
const TMDB = 'tmdb'

// From the tab bar's top edge to the top of the screen. min and max both, so
// the height animates (min-height grows) and stays put whatever the results.
const FULL_HEIGHT =
  'min-h-[calc(100dvh_-_3.5rem_-_1px_-_env(safe-area-inset-bottom)_-_env(safe-area-inset-top))] max-h-[calc(100dvh_-_3.5rem_-_1px_-_env(safe-area-inset-bottom)_-_env(safe-area-inset-top))]'

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
  // Bars floating over the tab bar (casting, the mini-player) ride up with the
  // menu rather than end up under it: they lift by --discover-lift.
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = document.documentElement
    const el = panel.current
    if (!open || !el) { root.style.setProperty('--discover-lift', '0px'); return }
    const lift = () => root.style.setProperty('--discover-lift', `${el.offsetHeight}px`)
    lift()
    const watch = new ResizeObserver(lift)
    watch.observe(el)
    return () => { watch.disconnect(); root.style.setProperty('--discover-lift', '0px') }
  }, [open])
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
  // Searching, the panel grows to the top of the screen and stays there, so
  // the keyboard can't cover the results and their count can't resize it. It
  // drops back when the keyboard goes away with nothing typed.
  const [expanded, setExpanded] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const foldIfEmpty = () => { if (!input.current?.value.trim()) setExpanded(false) }
  useEffect(() => {
    const vv = window.visualViewport
    if (!expanded || !vv) return
    let last = vv.height
    const onResize = () => {
      // The keyboard closed but the field kept focus (Android's back key).
      if (vv.height > last + 100) input.current?.blur()
      last = vv.height
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [expanded])
  // A folded menu forgets the search, so it reopens on the list.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) { setQuery(''); setKind('all'); setExpanded(false) }
  }

  const tmdb = catalogs.find(c => c.id === TMDB)
  const sites = catalogs.filter(c => c.id !== TMDB)
  const posters = useSourcePosters(sites.map(c => c.id), open)
  const recentSearches = useRecentSearches()
  const choose = (id: string) =>
    id === catalogId && onDiscover ? closeDiscoverMenu() : closeDiscoverMenuThen(() => onOpenCatalog(id))
  const isOn = (id: string) => id === catalogId

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
          ref={panel}
          role="dialog"
          aria-label="Discover"
          className={`flex flex-col rounded-t-box border-t border-base-300 bg-base-200 transition-[translate,min-height,max-height] duration-300 ease-out motion-reduce:transition-none ${
            open ? 'translate-y-0' : 'translate-y-full'
          } ${expanded ? FULL_HEIGHT : 'min-h-0 max-h-[70dvh]'}`}
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
                ref={input}
                type="search"
                value={query}
                onFocus={() => setExpanded(true)}
                onBlur={foldIfEmpty}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search titles on every source"
                aria-label="Search titles on every source"
                enterKeyHint="search"
                className="grow bg-transparent outline-none text-sm min-w-0"
              />
            </label>
          </form>

          {q ? (
            <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-4">
              <TitleResults
                search={search}
                query={q}
                kind={kind}
                onKind={setKind}
                listId="discover-menu-results"
                onOpen={card => closeDiscoverMenuThen(() => onOpenCard(card))}
                onSeeAll={() => closeDiscoverMenuThen(() => onSearchTerm(q, kind))}
              />
            </div>
          ) : (
            <>
              {recentSearches.length > 0 && (
                <div className="px-2 pb-3 shrink-0">
                  <RecentSearchChips
                    items={recentSearches}
                    onPick={r => closeDiscoverMenuThen(() => onSearchTerm(r.term, r.kind))}
                    onClear={clearRecentSearches}
                  />
                </div>
              )}
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
                    <span className={isOn(TMDB) ? 'text-primary font-bold' : 'text-info/70'} aria-hidden="true">{isOn(TMDB) ? '✓' : '›'}</span>
                  </button>
                </div>
              )}
              <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
                <SectionTitle>Browse a source</SectionTitle>
                {/* Tiles that look like what they open onto: each shows the
                    first posters of that source's Discover page. */}
                <div className="grid grid-cols-2 gap-2">
                  {sites.map(c => (
                    <button
                      key={c.id}
                      onClick={() => choose(c.id)}
                      aria-current={isOn(c.id) ? 'true' : undefined}
                      className={`overflow-hidden rounded-box border text-left active:scale-[.98] transition-transform ${
                        isOn(c.id) ? 'border-primary' : 'border-base-300'
                      } bg-base-300`}
                    >
                      <span className="flex h-16 gap-0.5" aria-hidden="true">
                        {[0, 1, 2].map(i => {
                          const src = posters.get(c.id)?.[i]
                          return src
                            ? <img key={i} src={src} alt="" loading="lazy" className="min-w-0 flex-1 object-cover" />
                            : <span key={i} className="flex-1 bg-base-100/60" />
                        })}
                      </span>
                      <span className="block px-2.5 py-2">
                        <span className="flex items-center gap-1 text-sm font-semibold">
                          <span className="truncate">{c.label}</span>
                          <span className="ml-auto text-base-content/50" aria-hidden="true">{isOn(c.id) ? '✓' : '›'}</span>
                        </span>
                        <span className="block truncate text-[11px] text-base-content/50">{c.description.split(' · ')[0]}</span>
                      </span>
                    </button>
                  ))}
                </div>
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
