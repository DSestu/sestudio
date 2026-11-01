import { type FocusEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { CatalogInfo } from '../api'
import { useBrowserPlayerControls } from '../browserPlayerControls'
import { useCastState } from '../cast'
import { useDlnaState } from '../dlnaControl'
import type { Tab, View } from '../nav'
import { useSelectionActive } from '../selectionMode'
import { closeDiscoverMenuThen, toggleDiscoverMenu, useDiscoverMenuOpen } from '../discoverMenu'
import SourceIcon from './SourceIcon'
import CreatorLinks from './CreatorLinks'

interface Destination {
  id: Tab
  label: string
  icon: ReactNode
}

const icon = (d: string) => (
  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
)

const DESTINATIONS: Destination[] = [
  { id: 'home', label: 'Home', icon: icon('M3 12l9-9 9 9M5 10v10h14V10') },
  // Discovery and search share one destination: an empty search bar browses.
  { id: 'search', label: 'Discover', icon: icon('M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5 5-2z') },
  { id: 'library', label: 'Library', icon: icon('M20.8 6.6a4.5 4.5 0 00-6.4 0L12 9l-2.4-2.4a4.5 4.5 0 10-6.4 6.4L12 21.5l8.8-8.5a4.5 4.5 0 000-6.4z') },
  // What is on the server's disk, and what is on its way there.
  { id: 'media', label: 'Media', icon: icon('M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM10 8.5v5l4-2.5-4-2.5zM8 21h8') },
  { id: 'notifications', label: 'Activity', icon: icon('M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0') },
]

/** Destinations that carry a count badge, and which prop feeds it. */
const BADGES: Partial<Record<Tab, 'download' | 'unread'>> = {
  media: 'download',
  notifications: 'unread',
}

interface Props {
  view: View
  onNavigate: (v: Tab) => void
  /** Active downloads, rendered on the Media destination when non-zero. */
  downloadBadge?: number
  /** Unread watcher events, rendered on the Activity destination when non-zero. */
  unreadBadge?: number
  /** Navigates to the settings page. */
  onOpenSettings: () => void
  /** Browsable catalogues, listed under Discover in the rail. */
  catalogs?: CatalogInfo[]
  /** The catalogue on screen, '' when Discover isn't browsing one. */
  catalogId?: string
  onOpenCatalog?: (id: string) => void
  /** Desktop's search bar, pinned above every page (the player gets none, so
   *  it renders there without one). */
  searchBar?: ReactNode
  children: ReactNode
}

/**
 * App chrome: a persistent rail on `md:` and up, a bottom tab bar below it.
 * The content column scrolls independently on desktop so the rail stays put.
 */
export default function AppShell({ view, onNavigate, downloadBadge = 0, unreadBadge = 0, onOpenSettings, catalogs = [], catalogId = '', onOpenCatalog, searchBar, children }: Props) {
  const badgeFor = (id: Tab) =>
    BADGES[id] === 'download' ? downloadBadge : BADGES[id] === 'unread' ? unreadBadge : 0
  // When a cast is active the Now-Casting bar sits above the mobile tab bar
  // (and flush to the bottom on desktop), so content needs extra room to clear it.
  const castConnected = useCastState().connected
  const dlnaConnected = useDlnaState().connected
  const browserControls = useBrowserPlayerControls()
  const miniActive = view !== 'watch' && browserControls !== null
  const bottomBar = castConnected || dlnaConnected || miniActive
  // While the library is selecting, its action bar takes the tab bar's slot
  // instead of stacking on top of it, so fixed chrome height never grows (#26).
  const selecting = useSelectionActive()
  // On phones Discover is a menu of catalogues, unfolded from its tab.
  const menuOpen = useDiscoverMenuOpen()
  // The rail's catalogues show on Discover, and peek open from anywhere else
  // while the pointer or keyboard focus is on the Discover group.
  const [peek, setPeek] = useState(false)
  const catalogsOpen = view === 'search' || view === 'creators' || view === 'channel' || peek
  const peekProps = {
    onMouseEnter: () => setPeek(true),
    onMouseLeave: () => setPeek(false),
    onFocus: () => setPeek(true),
    onBlur: (e: FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setPeek(false)
    },
  }
  return (
    <div className="min-h-dvh bg-base-100 md:flex">
      {/* Desktop rail */}
      <aside className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:h-dvh md:sticky md:top-0 border-r border-base-300 bg-base-200/40 px-3 py-5 gap-6">
        <Wordmark className="px-2" />
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {DESTINATIONS.map(d => (
            <div key={d.id} className="flex flex-col gap-1" {...(d.id === 'search' ? peekProps : {})}>
            <button
              onClick={() => onNavigate(d.id)}
              aria-current={view === d.id ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-box px-3 py-2.5 text-sm font-medium transition-colors ${
                view === d.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-base-content/60 hover:bg-base-300/60 hover:text-base-content'
              }`}
            >
              {d.icon}
              <span className="flex-1 text-left">{d.label}</span>
              {d.id === 'search' && catalogs.length > 0 && (
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-300 motion-reduce:transition-none ${catalogsOpen ? '' : '-rotate-90'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
              )}
              {badgeFor(d.id) > 0 && (
                <span className="badge badge-primary badge-sm">{badgeFor(d.id)}</span>
              )}
            </button>
            {/* Catalogues sit right under Discover, folded away (animated)
                whenever Discover is neither the page on screen nor hovered. */}
            {d.id === 'search' && catalogs.length > 0 && (
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  catalogsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="min-h-0 overflow-hidden" inert={!catalogsOpen}>
                  <RailCatalogs catalogs={catalogs} catalogId={catalogId} onOpenCatalog={onOpenCatalog} />
                </div>
              </div>
            )}

            </div>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            onClick={onOpenSettings}
            aria-current={view === 'settings' ? 'page' : undefined}
            className={`flex w-full items-center gap-3 rounded-box px-3 py-2.5 text-sm font-medium transition-colors ${
              view === 'settings'
                ? 'bg-primary/15 text-primary'
                : 'text-base-content/60 hover:bg-base-300/60 hover:text-base-content'
            }`}
          >
            {icon('M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75')}
            Settings
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-base-300 bg-base-100/95 backdrop-blur px-4 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]">
        <Wordmark />
        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          aria-current={view === 'settings' ? 'page' : undefined}
          className={`btn btn-square btn-sm ${view === 'settings' ? 'btn-active text-primary' : 'btn-ghost'}`}
        >
          {icon('M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75')}
        </button>
      </header>

      {/* Content column — bottom padding clears the phone dock, plus the
          Now-Casting bar or mini-player when one is up. */}
      <main
        className={`flex-1 min-w-0 py-5 px-(--gutter) [--gutter:clamp(0.6rem,1.5vw,1.5rem)] ${
          bottomBar
            ? 'pb-[calc(var(--dock-clear)+4.75rem)] md:pb-24'
            : 'pb-[calc(var(--dock-clear)+1rem)] md:pb-10'
        }`}
      >
        {searchBar && (
          // No backdrop blur here: it would trap the search's fixed backdrop
          // inside the bar instead of letting it dim the page.
          <div
            className="hidden md:block sticky top-0 z-30 -mt-5 mb-5 mx-[calc(-1*var(--gutter))] px-(--gutter) border-b border-base-300 bg-base-100"
          >
            {searchBar}
          </div>
        )}
        {/* Every view uses the full width; the gutter grows with the window. */}
        <div className="w-full">{children}</div>
      </main>

      {/* Phone dock — hidden while the selection bar occupies this slot. */}
      {!selecting && (
        <PhoneDock view={view} menuOpen={menuOpen} onNavigate={onNavigate} badgeFor={badgeFor} />
      )}
    </div>
  )
}

/** The phone dock's tabs, in order; Search sits in the middle of them. */
const DOCK_TABS: Tab[] = ['home', 'library', 'media', 'notifications']
const searchIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
  </svg>
)
const closeIcon = (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
  </svg>
)

/**
 * The phone's floating glass dock (docs/SPEC-nav-redesign.md §4.1): four tabs
 * around a Search button that unfolds the Discover menu. The active tab's pill
 * slides between tabs rather than jumping.
 */
function PhoneDock({ view, menuOpen, onNavigate, badgeFor }: {
  view: View
  menuOpen: boolean
  onNavigate: (v: Tab) => void
  badgeFor: (id: Tab) => number
}) {
  // An open menu covers whatever view is under it, so no tab is lit then.
  const active = menuOpen ? undefined : DOCK_TABS.find(id => id === view)
  const icons = useRef<Partial<Record<Tab, HTMLSpanElement | null>>>({})
  const pill = useRef<HTMLSpanElement>(null)
  // The first placement must not slide in from the left edge.
  const placed = useRef(false)
  useLayoutEffect(() => {
    const place = () => {
      const p = pill.current
      const target = active && icons.current[active]
      if (!p) return
      p.style.opacity = target ? '1' : '0'
      if (!target) return
      // No layout to measure while the dock is hidden (desktop widths).
      const button = target.offsetParent as HTMLElement | null
      if (!button) return
      p.style.transition = placed.current ? '' : 'none'
      p.style.transform = `translate(${button.offsetLeft + target.offsetLeft}px, ${button.offsetTop + target.offsetTop}px)`
      placed.current = true
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [active])

  const tab = (id: Tab) => {
    const d = DESTINATIONS.find(x => x.id === id)!
    const lit = id === active
    return (
      <button
        key={id}
        onClick={() => closeDiscoverMenuThen(() => onNavigate(id))}
        aria-current={view === id ? 'page' : undefined}
        className={`relative flex min-w-0 flex-col items-center gap-1 text-[11.5px] transition-colors ${
          lit ? 'text-base-content font-semibold' : 'text-base-content/70 font-medium'
        }`}
      >
        <span
          ref={el => { icons.current[id] = el }}
          className={`relative grid place-items-center w-13 h-7.5 transition-colors ${lit ? 'text-primary' : ''}`}
        >
          {d.icon}
          {badgeFor(id) > 0 && (
            <span className="absolute -top-1 left-7.5 badge badge-primary badge-xs">{badgeFor(id)}</span>
          )}
        </span>
        {/* Labels must be able to shrink, or the columns overflow the viewport
            on narrow phones and the whole page scrolls sideways. */}
        <span className="max-w-full truncate">{d.label}</span>
      </button>
    )
  }

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 glass rounded-[28px] grid grid-cols-[1fr_1fr_4.5rem_1fr_1fr] items-center h-16.5"
    >
      <span
        ref={pill}
        aria-hidden="true"
        className="absolute left-0 top-0 w-13 h-7.5 rounded-full bg-primary/22 transition-[transform,opacity] duration-300 ease-smooth motion-reduce:transition-opacity"
      />
      {DOCK_TABS.slice(0, 2).map(tab)}
      <button
        onClick={toggleDiscoverMenu}
        aria-label={menuOpen ? 'Close search' : 'Search'}
        aria-expanded={menuOpen}
        aria-controls="discover-menu"
        aria-current={view === 'search' ? 'page' : undefined}
        className="justify-self-center grid place-items-center w-13 h-13 rounded-full bg-primary text-primary-content shadow-[0_6px_18px_color-mix(in_oklab,var(--color-primary)_30%,transparent),inset_0_1px_0_rgb(255_255_255/0.35)] transition-transform duration-100 active:scale-92"
      >
        {menuOpen ? closeIcon : searchIcon}
      </button>
      {DOCK_TABS.slice(2).map(tab)}
    </nav>
  )
}

/** The rail's catalogue list: TMDB set apart on top, as it plays nothing
 *  itself, then the video sources with what each holds. */
function RailCatalogs({ catalogs, catalogId, onOpenCatalog }: {
  catalogs: CatalogInfo[]
  catalogId: string
  onOpenCatalog?: (id: string) => void
}) {
  const tmdb = catalogs.find(c => c.id === 'tmdb')
  const sites = catalogs.filter(c => c.id !== 'tmdb')
  return (
    <div className="ml-[1.4rem] pl-2 mt-1 mb-2 flex flex-col gap-0.5 border-l border-base-300" aria-label="Catalogues">
      {tmdb && (
        <button
          onClick={() => onOpenCatalog?.(tmdb.id)}
          aria-current={tmdb.id === catalogId ? 'page' : undefined}
          title={tmdb.description}
          className={`mb-1 flex items-center gap-2 rounded-box border px-2 py-1.5 text-left text-[13px] font-semibold transition-colors ${
            tmdb.id === catalogId
              ? 'border-info/60 bg-info/15'
              : 'border-info/30 bg-info/5 hover:bg-info/10'
          }`}
        >
          <span className="w-6 h-6 shrink-0 rounded-md bg-[#0d253f] text-[#90cea1] flex items-center justify-center text-[7px] font-extrabold" aria-hidden="true">
            TMDB
          </span>
          <span className="min-w-0 flex-1 truncate">{tmdb.label}</span>
          <span className="badge badge-xs border-0 bg-success/15 text-success font-semibold">Finds</span>
        </button>
      )}
      <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-base-content/40">Video sources</p>
      {sites.map(c => (
        <button
          key={c.id}
          onClick={() => onOpenCatalog?.(c.id)}
          aria-current={c.id === catalogId ? 'page' : undefined}
          title={c.description}
          className={`flex items-center gap-2 rounded-box px-2 py-1.5 text-left transition-colors ${
            c.id === catalogId
              ? 'bg-base-300 text-base-content'
              : 'text-base-content/60 hover:bg-base-300/60 hover:text-base-content'
          }`}
        >
          <SourceIcon id={c.id} label={c.label} className="w-5 h-5 m-0.5" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium leading-tight">{c.label}</span>
            <span className="block truncate text-[10.5px] leading-tight text-base-content/45">{c.description}</span>
          </span>
        </button>
      ))}
      <CreatorLinks variant="rail" />
    </div>
  )
}

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <h1 className={`text-xl font-bold tracking-tight ${className}`}>
      se<span className="text-primary">studio</span>
    </h1>
  )
}
