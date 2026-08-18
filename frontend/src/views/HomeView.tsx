import { useEffect, useState } from 'react'
import type { AppSettings, TrendingCard, WatcherEvent } from '../api'
import { DEFAULT_DISCOVER_FILTERS, discoverTitles, getGenres, getTrending } from '../api'
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
  /** Trending cards aren't playable directly — clicking searches for the title. */
  onSearchTerm: (term: string, year?: number) => void
  /** Open the search view's discover panel pre-filtered on a genre. */
  onDiscoverGenre: (genreId: number) => void
  /** Open the title a watcher event points at. */
  onOpenEvent: (event: WatcherEvent) => void
}

/** The genres Home shows a trending row for (TMDB movie genre ids). */
const HOME_GENRE_IDS = [28, 35, 878, 27, 16, 18] // Action, Comédie, SF, Horreur, Animation, Drame

interface GenreRow {
  id: number
  name: string
  cards: TrendingCard[]
}

/** Landing view: what to resume first, then everything saved. */
export default function HomeView({
  settings, onOpen, onNavigate, onSearchTerm, onDiscoverGenre, onOpenEvent,
}: Props) {
  const watch = useWatchState()
  const collections = useCollections()
  const { events: activity } = useNotifications()

  const [fetchedTrending, setFetchedTrending] = useState<TrendingCard[]>([])
  useEffect(() => {
    if (!settings.tmdb_configured) return
    let cancelled = false
    getTrending().then(t => { if (!cancelled) setFetchedTrending(t) }).catch(() => {})
    return () => { cancelled = true }
  }, [settings.tmdb_configured])
  // Derived, so turning the key off hides the row without a state write.
  const trending = settings.tmdb_configured ? fetchedTrending : []

  // One "trending" row per genre — TMDB's trending API can't filter by genre,
  // so these are the currently most popular films of each one (discover).
  const [fetchedGenreRows, setFetchedGenreRows] = useState<GenreRow[]>([])
  useEffect(() => {
    if (!settings.tmdb_configured) return
    let cancelled = false
    ;(async () => {
      try {
        const genres = await getGenres('movie')
        const picked = HOME_GENRE_IDS
          .map(id => genres.find(g => g.id === id))
          .filter((g): g is NonNullable<typeof g> => Boolean(g))
        const rows = await Promise.all(picked.map(async g => ({
          id: g.id,
          name: g.name,
          cards: (await discoverTitles({ ...DEFAULT_DISCOVER_FILTERS, genres: [g.id] }, 1))
            .results.slice(0, 12),
        })))
        if (!cancelled) setFetchedGenreRows(rows.filter(r => r.cards.length > 0))
      } catch {
        // Genre rows are optional polish — a failed fetch just hides them.
      }
    })()
    return () => { cancelled = true }
  }, [settings.tmdb_configured])
  const genreRows = settings.tmdb_configured ? fetchedGenreRows : []

  const inProgress = watching(watch)
  const watchlist = savedItems('watchlist', collections, onOpen, settings.lang)
  const favourites = savedItems('favourites', collections, onOpen, settings.lang)

  // Activity counts here too: a fresh install whose only content is a watcher
  // finding would otherwise be told there is nothing, with the finding hidden
  // behind the empty state.
  if (
    !inProgress.length &&
    !trending.length &&
    !watchlist.length &&
    !favourites.length &&
    !activity.length
  ) {
    return (
      <EmptyState
        title="Nothing here yet"
        message="Search for a series or film to start watching, casting or downloading."
        action={{ label: 'Search', onClick: () => onNavigate('search') }}
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
      <MediaRow
        title="Trending this week"
        items={trending.map(t => ({
          key: `tr-${t.tmdb_id}`,
          title: t.title,
          subtitle: t.year ? String(t.year) : undefined,
          rating: t.rating,
          poster_url: t.poster_url,
          onClick: () => onSearchTerm(t.title, t.year),
        }))}
      />
      {genreRows.map(row => (
        <MediaRow
          key={`genre-${row.id}`}
          title={row.name}
          items={row.cards.map(c => ({
            key: `g${row.id}-${c.tmdb_id}`,
            title: c.title,
            subtitle: c.year ? String(c.year) : undefined,
            rating: c.rating,
            poster_url: c.poster_url,
            onClick: () => onSearchTerm(c.title, c.year),
          }))}
          onSeeAll={() => onDiscoverGenre(row.id)}
        />
      ))}
    </div>
  )
}
