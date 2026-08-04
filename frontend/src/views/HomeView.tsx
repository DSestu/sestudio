import { useEffect, useState } from 'react'
import type { AppSettings, TrendingCard } from '../api'
import { getTrending } from '../api'
import { useCollections } from '../collections'
import EmptyState from '../components/EmptyState'
import WatchingRow from '../components/library/WatchingRow'
import MediaRow from '../components/MediaRow'
import type { View } from '../nav'
import { openWatching, savedItems, type OpenTitle } from '../rowItems'
import { useWatchState, watching } from '../watchState'

/** How many resume rows Home leads with before deferring to the Library. */
const WATCHING_LIMIT = 3

interface Props {
  settings: AppSettings
  onOpen: OpenTitle
  onNavigate: (v: View) => void
  /** Trending cards aren't playable directly — clicking searches for the title. */
  onSearchTerm: (term: string) => void
}

/** Landing view: what to resume first, then everything saved. */
export default function HomeView({ settings, onOpen, onNavigate, onSearchTerm }: Props) {
  const watch = useWatchState()
  const collections = useCollections()

  const [fetchedTrending, setFetchedTrending] = useState<TrendingCard[]>([])
  useEffect(() => {
    if (!settings.tmdb_configured) return
    let cancelled = false
    getTrending().then(t => { if (!cancelled) setFetchedTrending(t) }).catch(() => {})
    return () => { cancelled = true }
  }, [settings.tmdb_configured])
  // Derived, so turning the key off hides the row without a state write.
  const trending = settings.tmdb_configured ? fetchedTrending : []

  const inProgress = watching(watch)
  const watchlist = savedItems('watchlist', collections, onOpen, settings.lang)
  const favourites = savedItems('favourites', collections, onOpen, settings.lang)

  if (!inProgress.length && !trending.length && !watchlist.length && !favourites.length) {
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
          subtitle: [t.year || null, t.rating ? `★ ${t.rating.toFixed(1)}` : null]
            .filter(Boolean).join(' · '),
          poster_url: t.poster_url,
          onClick: () => onSearchTerm(t.title),
        }))}
      />
    </div>
  )
}
