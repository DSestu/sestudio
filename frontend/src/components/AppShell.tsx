import { type FocusEvent, type HTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CatalogInfo } from '../api'
import { useBrowserSession } from '../playbackSession'
import { useCastState } from '../cast'
import { useDlnaState } from '../dlnaControl'
import { navTabs, type Tab, type View } from '../nav'
import { useSelectionActive } from '../selectionMode'
import { closeDiscoverMenuThen, toggleDiscoverMenu, useDiscoverMenuOpen } from '../discoverMenu'
import SourceIcon from './SourceIcon'
import CreatorLinks from './CreatorLinks'
import { ActivityBell, SettingsButton, TopCard } from './PageHeader'
import { deskSlotRef, setBell, usePageHeaderMounted } from '../pageHeader'
import { usePhoneStripShown } from '../phoneStrip'
import { AWAY, setBarsHidden, useBarsHidden } from '../barsHidden'

// Stable callback refs for the desktop card's slots (a fresh function each
// render would unregister and re-register them every time).
const TITLE_SLOT = deskSlotRef('title')
const MENU_SLOT = deskSlotRef('menu')
const TABS_SLOT = deskSlotRef('tabs')

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
  { id: 'music', label: 'Music', icon: icon('M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z') },
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
  /** The lab flag: adds the Music tab and moves Activity to a bell in the top card. */
  lab?: boolean
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
export default function AppShell({ view, onNavigate, downloadBadge = 0, unreadBadge = 0, lab = false, onOpenSettings, catalogs = [], catalogId = '', onOpenCatalog, searchBar, children }: Props) {
  const tabs = navTabs(lab)
  useEffect(() => { setBell(lab, unreadBadge) }, [lab, unreadBadge])
  const badgeFor = (id: Tab) =>
    BADGES[id] === 'download' ? downloadBadge : BADGES[id] === 'unread' ? unreadBadge : 0
  // When a cast is active the Now-Casting bar sits above the mobile tab bar
  // (and flush to the bottom on desktop), so content needs extra room to clear it.
  const castConnected = useCastState().connected
  const dlnaConnected = useDlnaState().connected
  // Same signal the mini-player shows on, so the dock squares off exactly when
  // the strip sits on it.
  const browserSession = useBrowserSession()
  const miniActive = view !== 'watch' && browserSession !== null
  const bottomBar = castConnected || dlnaConnected || miniActive
  const phoneStrip = usePhoneStripShown()
  // While the library is selecting, its action bar takes the tab bar's slot
  // instead of stacking on top of it, so fixed chrome height never grows (#26).
  const selecting = useSelectionActive()
  // On phones Discover is a menu of catalogues, unfolded from its tab.
  const menuOpen = useDiscoverMenuOpen()
  const pageHeader = usePageHeaderMounted()
  // Scrolling down sends the bars away (phone top card and dock, desktop card);
  // any scroll up brings them back. Never while a sheet or the selection bar is up, or on
  // the player page.
  const away = useBarsHidden()
  const pinned = menuOpen || selecting || view === 'watch'
  useEffect(() => {
    setBarsHidden(false)
    if (pinned) return
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - last) < 6) return
      setBarsHidden(y > last && y > 40)
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); setBarsHidden(false) }
  }, [pinned, view])
  // The player page pins its video to the top of the screen, so the phone top
  // card only shows while the page is at the very top, never over the video.
  const [watchScrolled, setWatchScrolled] = useState(false)
  useEffect(() => {
    if (view !== 'watch') return
    const onScroll = () => setWatchScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); setWatchScrolled(false) }
  }, [view])
  // Asking for the search (Ctrl K, or the rail's Search button) brings the card back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['k', 'f'].includes(e.key.toLowerCase())) setBarsHidden(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The rail's Discover flyout opens while the pointer or keyboard focus is on
  // Discover or the flyout. Closing waits a beat, so crossing the gap between
  // the two doesn't fold it.
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<number | undefined>(undefined)
  const openPeek = () => { clearTimeout(peekTimer.current); setPeek(true) }
  // Both the Discover item and the flyout carry data-peek: a tap focuses the
  // button it lands on, so focus moving from one to the other is not leaving.
  const peekProps = {
    'data-peek': '',
    onMouseEnter: openPeek,
    onMouseLeave: () => { peekTimer.current = window.setTimeout(() => setPeek(false), 150) },
    onFocus: openPeek,
    onBlur: (e: FocusEvent<HTMLDivElement>) => {
      if (!(e.relatedTarget as Element | null)?.closest?.('[data-peek]')) setPeek(false)
    },
  }
  return (
    <div className="min-h-dvh bg-base-100 md:flex">
      {/* Desktop rail: a slim glass column floating beside the page (docs/
          SPEC-nav-redesign.md §5). The Discover flyout is a sibling of the
          column, not inside it, so its own blur sees the page under it. */}
      <aside className="hidden md:block md:shrink-0 md:w-27 md:h-dvh md:sticky md:top-0 p-3 pr-0 z-40">
        <div className="relative h-full w-21 glass rounded-2xl flex flex-col items-center gap-1 py-4">
          <img src="/sestudio-mark.svg" alt="sestudio" className="w-8 h-8 mb-3" />
          <button
            // The search bar listens for Ctrl K from anywhere; this is the same request.
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            aria-label="Search"
            title="Search (Ctrl K)"
            className="grid place-items-center w-13 h-13 mb-3 rounded-2xl bg-primary text-primary-content transition-transform duration-100 active:scale-92"
          >
            {searchIcon}
          </button>
          <RailNav tabs={tabs} view={view} onNavigate={onNavigate} badgeFor={badgeFor} discoverProps={catalogs.length > 0 ? peekProps : {}} />
          <div className="mt-auto">
            <RailItem
              label="Settings"
              icon={icon('M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75')}
              lit={view === 'settings'}
              onClick={onOpenSettings}
            />
          </div>
        </div>
        {catalogs.length > 0 && (
          <div
            {...peekProps}
            inert={!peek}
            data-open={peek || undefined}
            className={`absolute left-27 top-46 w-72 glass rounded-2xl p-3 transition-[opacity,translate,filter] ease-smooth motion-reduce:translate-x-0 motion-reduce:[filter:none] ${
              peek
                ? 'duration-300 [filter:none]'
                : 'duration-200 opacity-0 -translate-x-3 pointer-events-none [filter:blur(10px)]'
            }`}
          >
            <p className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-wide text-base-content/50">Discover</p>
            <RailCatalogs
              catalogs={catalogs}
              catalogId={catalogId}
              onOpenCatalog={id => { setPeek(false); onOpenCatalog?.(id) }}
            />
          </div>
        )}
      </aside>

      {/* Phone top card. Pages with their own (<PageHeader>) replace this
          default: the wordmark, and on Home what is new. */}
      {!pageHeader && (
        <TopCard away={view === 'watch' && watchScrolled}>
          <div className="flex items-center gap-2 min-h-11">
            <div className="min-w-0 flex-1 leading-tight">
              <Wordmark />
              {view === 'home' && unreadBadge > 0 && (
                <p className="mt-0.5 text-xs text-base-content/60"><span className="text-primary font-semibold">{unreadBadge}</span> new for you</p>
              )}
            </div>
            <ActivityBell />
            <SettingsButton />
          </div>
        </TopCard>
      )}

      {/* Content column — bottom padding clears the phone dock, plus the
          Now-Casting bar or mini-player when one is up. */}
      <main
        className={`flex-1 min-w-0 pt-[calc(var(--top-card-h,4.25rem)+env(safe-area-inset-top)+1.25rem)] md:pt-5 px-(--gutter) [--gutter:clamp(0.6rem,1.5vw,1.5rem)] ${
          bottomBar
            ? 'pb-[calc(var(--dock-clear)+4.75rem+var(--music-bar,0rem))] md:pb-[calc(6rem+var(--music-bar,0rem))]'
            : 'pb-[calc(var(--dock-clear)+1rem+var(--music-bar,0rem))] md:pb-[calc(2.5rem+var(--music-bar,0rem))]'
        }`}
      >
        {searchBar && (
          // Desktop's header card (docs/SPEC-nav-redesign.md §5): the page's
          // name, the search field and the page's ⋯ on one row, its tabs on a
          // second. Pages fill the slots through <PageHeader>. It leaves while
          // scrolling down, like the phone bars.
          <div
            className={`hidden md:block sticky top-3 z-30 mb-5 transition-[translate,opacity] ${AWAY(away, '-translate-y-[calc(100%+1.5rem)]')}`}
          >
            {/* The glass is a layer behind the content, not the card itself: a
                blur on an ancestor would trap the search's full-page dimming
                inside the card. */}
            <div aria-hidden="true" className="absolute inset-0 glass rounded-2xl" />
            <div className="relative px-5">
              <div className="flex items-center gap-6">
                <div ref={TITLE_SLOT} className="contents" />
                <div className="flex-1 min-w-0">{searchBar}</div>
                <div ref={MENU_SLOT} className="contents" />
                <ActivityBell />
              </div>
              <div ref={TABS_SLOT} />
            </div>
          </div>
        )}
        {/* Every view uses the full width; the gutter grows with the window. */}
        <div className="w-full">{children}</div>
      </main>

      {/* Phone dock — hidden while the selection bar occupies this slot. */}
      {!selecting && (
        <PhoneDock tabs={tabs} view={view} menuOpen={menuOpen} joined={phoneStrip || menuOpen} onNavigate={onNavigate} badgeFor={badgeFor} />
      )}
    </div>
  )
}

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
function PhoneDock({ tabs, view, menuOpen, joined, onNavigate, badgeFor }: {
  /** The nav's order; Search sits in the middle of the rest. */
  tabs: Tab[]
  view: View
  menuOpen: boolean
  /** A playing strip or the Discover menu sits on top, so the top corners
   *  square off to meet it. */
  joined: boolean
  onNavigate: (v: Tab) => void
  badgeFor: (id: Tab) => number
}) {
  const away = useBarsHidden()
  const dockTabs = tabs.filter(id => id !== 'search')
  // An open menu covers whatever view is under it, so no tab is lit then.
  const active = menuOpen ? undefined : dockTabs.find(id => id === view)
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
      className={`md:hidden fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 glass grid grid-cols-[1fr_1fr_4.5rem_1fr_1fr] items-center h-16.5 transition-[translate,opacity,border-radius] ${
        joined ? "rounded-b-2xl" : "rounded-2xl"
      } ${AWAY(away, "translate-y-[calc(100%+1.5rem)]")}`}
    >
      <span
        ref={pill}
        aria-hidden="true"
        className="absolute left-0 top-0 w-13 h-7.5 rounded-[10px] bg-primary/22 transition-[transform,opacity] duration-300 ease-smooth motion-reduce:transition-opacity"
      />
      {dockTabs.slice(0, 2).map(tab)}
      <button
        onClick={toggleDiscoverMenu}
        aria-label={menuOpen ? 'Close search' : 'Search'}
        aria-expanded={menuOpen}
        aria-controls="discover-menu"
        aria-current={view === 'search' ? 'page' : undefined}
        className="justify-self-center grid place-items-center w-13 h-13 rounded-2xl bg-primary text-primary-content transition-transform duration-100 active:scale-92"
      >
        {menuOpen ? closeIcon : searchIcon}
      </button>
      {dockTabs.slice(2).map(tab)}
    </nav>
  )
}

/** One rail entry: icon over label, the icon carrying the badge. */
function RailItem({ label, icon, lit, badge = 0, current, onClick, iconRef }: {
  label: string
  icon: ReactNode
  lit: boolean
  badge?: number
  current?: boolean
  onClick: () => void
  /** Set when a sliding pill marks the lit item; otherwise the item lights itself. */
  iconRef?: (el: HTMLSpanElement | null) => void
}) {
  return (
    <button
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={`relative flex flex-col items-center gap-1 w-18 py-1 text-[11px] transition-colors ${
        lit ? 'text-base-content font-semibold' : 'text-base-content/65 font-medium hover:text-base-content'
      }`}
    >
      <span
        ref={iconRef}
        className={`relative grid place-items-center w-13 h-8 rounded-[10px] transition-colors ${lit ? 'text-primary' : ''} ${
          !iconRef && lit ? 'bg-primary/22' : ''
        }`}
      >
        {icon}
        {badge > 0 && <span className="absolute -top-1 left-8 badge badge-primary badge-xs">{badge}</span>}
      </span>
      {label}
    </button>
  )
}

/** The rail's destinations, with the lit one's pill sliding between them. */
function RailNav({ tabs, view, onNavigate, badgeFor, discoverProps }: {
  tabs: Tab[]
  view: View
  onNavigate: (v: Tab) => void
  badgeFor: (id: Tab) => number
  discoverProps: HTMLAttributes<HTMLDivElement>
}) {
  // Creators and channels are reached through Discover, so it stays lit there.
  const active = view === 'creators' || view === 'channel' ? 'search' : tabs.find(id => id === view)
  const icons = useRef<Partial<Record<Tab, HTMLSpanElement | null>>>({})
  const pill = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    const p = pill.current
    const target = active && icons.current[active]
    if (!p) return
    p.style.opacity = target ? '1' : '0'
    // No layout to measure while the rail is hidden (phone widths).
    const item = target ? (target.offsetParent as HTMLElement | null) : null
    if (!target || !item) return
    p.style.transition = placed.current ? '' : 'none'
    p.style.transform = `translateY(${item.offsetTop + target.offsetTop}px)`
    placed.current = true
  }, [active])
  return (
    <nav aria-label="Primary" className="relative flex flex-col gap-1">
      <span
        ref={pill}
        aria-hidden="true"
        className="absolute left-1/2 -ml-6.5 top-0 w-13 h-8 rounded-[10px] bg-primary/22 transition-[transform,opacity] duration-300 ease-smooth motion-reduce:transition-opacity"
      />
      {tabs.map(id => DESTINATIONS.find(d => d.id === id)!).map(d => (
        <div key={d.id} {...(d.id === 'search' ? discoverProps : {})}>
          <RailItem
            label={d.label}
            icon={d.icon}
            lit={d.id === active}
            badge={badgeFor(d.id)}
            current={view === d.id}
            onClick={() => onNavigate(d.id)}
            iconRef={el => { icons.current[d.id] = el }}
          />
        </div>
      ))}
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
    <div className="rows-follow flex flex-col gap-0.5" aria-label="Catalogues">
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
