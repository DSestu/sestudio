import { useEffect, useState } from 'react'
import type { AppSettings, BrowseRow, Shelf, WatcherEvent } from '../api'
import { getBrowseRows, getShelves } from '../api'
import { useCollections } from '../collections'
import ActivityPeek from '../components/ActivityPeek'
import EmptyState from '../components/EmptyState'
import WatchingRow from '../components/library/WatchingRow'
import MediaRow from '../components/MediaRow'
import type { View } from '../nav'
import { useNotifications } from '../notifications'
import { openWatching, savedItems, type OpenTitle } from '../rowItems'
import { useWatchState, watching } from '../watchState'

/** How many resume rows Home leads with before deferring to the Library. */
const WATCHING_LIMIT = 3

interface Props {
  settings: AppSettings
  onOpen: OpenTitle
  onNavigate: (v: View) => void
  /** A catalogue card that isn't a site's own title searches for it. */
  onSearchTerm: (term: string, year?: number) => void
  /** The catalogue last browsed, whose first shelf Home shows. */
  catalogId: string
  catalogLabel: string
  onOpenCatalog: (id: string) => void
  /** Open the title a watcher event points at. */
  onOpenEvent: (event: WatcherEvent) => void
}

/** Landing view: what to resume first, then everything saved. */
export default function HomeView({
  settings, onOpen, onNavigate, onSearchTerm, catalogId, catalogLabel, onOpenCatalog, onOpenEvent,
}: Props) {
  const watch = useWatchState()
  const collections = useCollections()
  const { events: activity } = useNotifications()

  // One shelf from the catalogue last browsed — a way into Discover, not a
  // copy of it. Tagged with its catalogue so a switch never shows a stale one.
  const [shelf, setShelf] = useState<{ id: string; shelf: Shelf | null }>({ id: '', shelf: null })
  useEffect(() => {
    if (!catalogId) return
    let cancelled = false
    getShelves(catalogId)
      .then(s => { if (!cancelled) setShelf({ id: catalogId, shelf: s[0] ?? null }) })
      .catch(() => {}) // optional polish — a failed fetch just hides the row
    return () => { cancelled = true }
  }, [catalogId])
  const discover = shelf.id === catalogId ? shelf.shelf : null

  // Rows the sites list themselves — their titles open directly, TMDB or not.
  const [browseRows, setBrowseRows] = useState<BrowseRow[]>([])
  useEffect(() => {
    let cancelled = false
    getBrowseRows().then(r => { if (!cancelled) setBrowseRows(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const inProgress = watching(watch)
  const watchlist = savedItems('watchlist', collections, onOpen, settings.lang)
  const favourites = savedItems('favourites', collections, onOpen, settings.lang)

  // Activity counts here too: a fresh install whose only content is a watcher
  // finding would otherwise be told there is nothing, with the finding hidden
  // behind the empty state.
  if (
    !inProgress.length &&
    !browseRows.length &&
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

  // Home's poster rows deliberately carry no per-item controls: Home is for
  // launching, the Library is for managing (#26). Resume rows keep theirs,
  // since acting on them is the point.
  const strip = (items: ReturnType<typeof savedItems>) =>
    items.slice(0, 12).map(item => ({ ...item, actions: undefined, onRemove: undefined }))

  return (
    <div className="flex flex-col gap-8">
      {/* First, because news goes stale: a new episode is the most time-sensitive
          thing Home can offer. Hides itself entirely when nothing is new. */}
      <ActivityPeek onOpen={onOpenEvent} onSeeAll={() => onNavigate('notifications')} />

      {inProgress.length > 0 && (
        <section aria-label="Continue watching">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">Continue watching</h2>
            {inProgress.length > WATCHING_LIMIT && (
              <button
                onClick={() => onNavigate('library')}
                className="text-xs font-medium text-base-content/50 hover:text-primary transition-colors"
              >
                See all
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {inProgress.slice(0, WATCHING_LIMIT).map(item => (
              <WatchingRow
                key={`${item.series}|S${item.season}`}
                item={item}
                onOpen={openWatching(onOpen)}
              />
            ))}
          </div>
        </section>
      )}

      <MediaRow
        title="Watchlist"
        items={strip(watchlist)}
        onSeeAll={watchlist.length > 12 ? () => onNavigate('library') : undefined}
      />
      <MediaRow
        title="Favourites"
        items={strip(favourites)}
        onSeeAll={favourites.length > 12 ? () => onNavigate('library') : undefined}
      />
      {browseRows.map(row => (
        <MediaRow
          key={`browse-${row.source}-${row.title}`}
          title={row.title}
          items={row.cards.map(c => ({
            key: `b-${row.source}-${c.newsid}`,
            title: c.title,
            subtitle: c.year ? String(c.year) : undefined,
            poster_url: c.poster_url,
            onClick: () => onOpen(c, 0, settings.lang),
          }))}
        />
      ))}
      {discover && (
        <MediaRow
          title={`${discover.title} on ${catalogLabel}`}
          items={discover.cards.slice(0, 18).map(c => ({
            key: c.key,
            title: c.title,
            subtitle: c.year ? String(c.year) : undefined,
            rating: c.rating || undefined,
            poster_url: c.poster_url,
            onClick: () => c.open.card
              ? onOpen(c.open.card, 0, settings.lang)
              : onSearchTerm(c.open.search?.term ?? c.title, c.open.search?.year || undefined),
          }))}
          onSeeAll={() => onOpenCatalog(catalogId)}
        />
      )}
    </div>
  )
}
