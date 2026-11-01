import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { AppSettings, DownloadedFile, DownloadedTitle, DownloadJob, Shelf, WatcherEvent } from '../api'
import { getShelves } from '../api'
import { entries, useCollections, type ListName } from '../collections'
import ActivityPeek from '../components/ActivityPeek'
import LiveNow from '../components/LiveNow'
import EmptyState from '../components/EmptyState'
import ContinueWidget from '../components/home/ContinueWidget'
import NowStrip from '../components/home/NowStrip'
import PosterStrip from '../components/home/PosterStrip'
import Widget, { WidgetGrid } from '../components/home/Widget'
import { orderWidgets, pinTiers, type WidgetDescriptor, type WidgetId, type WidgetTier } from '../homeOrder'
import { useLastVisit } from '../lastVisit'
import type { Navigate } from '../nav'
import { useNotifications } from '../notifications'
import { openWatching, savedItems, type OpenTitle } from '../rowItems'
import { useWatchState, watching } from '../watchState'

/** Posters a saved-list widget shows before deferring to the Library. */
const STRIP_LIMIT = 12

interface Props {
  settings: AppSettings
  onOpen: OpenTitle
  onNavigate: Navigate
  /** A catalogue card that isn't a site's own title searches for it. */
  onSearchTerm: (term: string, year?: number) => void
  /** The catalogue last browsed, whose first shelf Home shows. */
  catalogId: string
  catalogLabel: string
  onOpenCatalog: (id: string) => void
  /** Open the title a watcher event points at. */
  onOpenEvent: (event: WatcherEvent) => void
  /** The download queue, for the Now strip's failed jobs. */
  jobs: DownloadJob[]
  onOpenDownloaded: (title: DownloadedTitle, file?: DownloadedFile) => void
}

/** Landing view: a grid of widgets, what to resume first (docs/SPEC-home-dashboard.md). */
export default function HomeView({
  settings, onOpen, onNavigate, onSearchTerm, catalogId, catalogLabel, onOpenCatalog, onOpenEvent,
  jobs, onOpenDownloaded,
}: Props) {
  const watch = useWatchState()
  const collections = useCollections()
  const { events: activity } = useNotifications()
  // The previous visit: what ended since then is new to the Now strip.
  const lastVisit = useLastVisit()
  const [pinned] = useState(() => new Map<WidgetId, WidgetTier>())

  // One shelf from the catalogue last browsed — a way into Discover, not a
  // copy of it. Tagged with its catalogue so a switch never shows a stale one.
  const [shelf, setShelf] = useState<{ id: string; shelf: Shelf | null }>({ id: '', shelf: null })
  useEffect(() => {
    if (!catalogId) return
    let cancelled = false
    getShelves(catalogId)
      .then(s => { if (!cancelled) setShelf({ id: catalogId, shelf: s[0] ?? null }) })
      // A failed fetch makes the widget absent rather than a skeleton forever.
      .catch(() => { if (!cancelled) setShelf({ id: catalogId, shelf: null }) })
    return () => { cancelled = true }
  }, [catalogId])
  const discoverLoading = Boolean(catalogId) && shelf.id !== catalogId
  const discover = shelf.id === catalogId ? shelf.shelf : null

  const inProgress = watching(watch)
  // Home's posters carry no per-item controls: Home is for launching, the
  // Library is for managing (#26). The version they were saved in rides along.
  const saved = (list: ListName) => {
    const langs = entries(list, collections).map(e => e.lang)
    return savedItems(list, collections, onOpen, settings.lang).map((item, i) => ({ ...item, lang: langs[i] }))
  }
  const watchlist = saved('watchlist')
  const favourites = saved('favourites')

  // Activity counts here too: a fresh install whose only content is a watcher
  // finding would otherwise be told there is nothing, with the finding hidden
  // behind the empty state.
  if (
    !inProgress.length &&
    !discoverLoading &&
    !discover?.cards.length &&
    !watchlist.length &&
    !favourites.length &&
    !activity.length
  ) {
    return (
      <EmptyState
        title="Nothing here yet"
        message="Search for a series or film to start watching, casting or downloading."
        action={{ label: 'Discover', onClick: () => onNavigate('search') }}
      />
    )
  }

  // Present widgets only: one with nothing to show is absent, never empty. A
  // loading one is present, as a skeleton at its final size.
  const present: (WidgetDescriptor | false)[] = [
    inProgress.length > 0 && { id: 'continue', size: 'L', tier: 'continue' },
    watchlist.length > 0 && { id: 'watchlist', size: 'M', tier: 'browse' },
    favourites.length > 0 && { id: 'favourites', size: 'M', tier: 'browse' },
    (discoverLoading || Boolean(discover?.cards.length)) && { id: 'discover', size: 'M', tier: 'browse' },
  ]
  const placed = orderWidgets(pinTiers(present.filter(w => w !== false), pinned))

  const render = (id: WidgetId, style: CSSProperties): ReactNode => {
    switch (id) {
      case 'continue':
        return (
          <ContinueWidget
            key={id}
            style={style}
            items={inProgress}
            onOpen={openWatching(onOpen)}
            onSeeAll={() => onNavigate('library')}
          />
        )
      case 'watchlist':
        return (
          <Widget
            key={id}
            style={style}
            size="M"
            title="Watchlist"
            count={watchlist.length}
            onOpen={() => onNavigate('library', { tab: 'watchlist' })}
            // A bookmark ribbon hanging from the top edge: marked to come back to.
            icon={
              <span className="w-3.5 shrink-0" aria-hidden="true">
                <span className="absolute top-0 left-3 w-3.5 h-[22px] bg-base-400 [clip-path:polygon(0_0,100%_0,100%_100%,50%_74%,0_100%)]" />
              </span>
            }
            frame="f-watch"
          >
            <PosterStrip items={watchlist.slice(0, STRIP_LIMIT)} />
          </Widget>
        )
      case 'favourites':
        return (
          <Widget
            key={id}
            style={style}
            size="M"
            title="Favourites"
            count={favourites.length}
            onOpen={() => onNavigate('library', { tab: 'favourites' })}
            icon={
              <svg className="w-3.5 h-3.5 shrink-0 text-secondary" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 4.4 2.6h1.6C13.6 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z" />
              </svg>
            }
            frame="f-fav"
          >
            <PosterStrip items={favourites.slice(0, STRIP_LIMIT)} ledge />
          </Widget>
        )
      case 'discover':
        return (
          <Widget
            key={id}
            style={style}
            size="M"
            title="Discover"
            sub={discover ? `${discover.title} · ${catalogLabel}` : catalogLabel}
            onOpen={() => onOpenCatalog(catalogId)}
            loading={!discover}
            // A window that runs off the right edge: the catalogue goes on.
            // The posters bleed; the header's chevron stays inside the screen.
            frame="f-disc rounded-r-none pr-0 mr-[calc(-1*var(--gutter))] md:col-span-full [&>h2]:mr-2"
          >
            {discover && (
              <PosterStrip
                items={discover.cards.slice(0, 18).map(c => ({
                  key: c.key,
                  title: c.title,
                  poster_url: c.poster_url,
                  onClick: () => c.open.card
                    ? onOpen(c.open.card, 0, settings.lang)
                    : onSearchTerm(c.open.search?.term ?? c.title, c.open.search?.year || undefined),
                }))}
              />
            )}
          </Widget>
        )
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* What needs you now, at the very top; absent when nothing does. */}
      <NowStrip
        lastVisit={lastVisit}
        jobs={jobs}
        lang={settings.lang}
        onOpen={onOpen}
        onNavigate={onNavigate}
        onOpenDownloaded={onOpenDownloaded}
        onSearchTerm={onSearchTerm}
      />

      {/* Only true right now, so it leads. Hides itself when nobody is live. */}
      <LiveNow onOpen={card => onOpen(card, 0, settings.lang)} />

      {/* Then news, because it goes stale: a new episode is the most time-sensitive
          thing Home can offer. Hides itself entirely when nothing is new. */}
      <ActivityPeek onOpen={onOpenEvent} onSeeAll={() => onNavigate('notifications')} />

      <WidgetGrid>
        {placed.map((w, i) => render(w.id, { animationDelay: `${i * 40}ms` }))}
      </WidgetGrid>
    </div>
  )
}
