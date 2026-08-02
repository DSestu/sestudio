import { useEffect, useState } from 'react'
import type { AppSettings, TrendingCard } from '../api'
import { getTrending } from '../api'
import { useCollections } from '../collections'
import MediaRow from '../components/MediaRow'
import EmptyState from '../components/EmptyState'
import type { View } from '../nav'
import { continueWatchingItems, nextUpItems, savedItems, type OpenTitle } from '../rowItems'
import { continueWatching, nextUp, useWatchState } from '../watchState'

interface Props {
  settings: AppSettings
  onOpen: OpenTitle
  onNavigate: (v: View) => void
  /** Trending cards aren't playable directly — clicking searches for the title. */
  onSearchTerm: (term: string) => void
}

/** Landing view: everything the user can pick up again, in priority order. */
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

  const cw = continueWatching(watch)
  const cwSeries = new Set(cw.map(e => e.series))
  const nu = nextUp(watch).filter(s => !cwSeries.has(s.series))

  const watchlist = savedItems('watchlist', collections, onOpen, settings.lang)
  const favourites = savedItems('favourites', collections, onOpen, settings.lang)

  if (!cw.length && !nu.length && !trending.length && !watchlist.length && !favourites.length) {
    return (
      <EmptyState
        title="Nothing here yet"
        message="Search for a series or film to start watching, casting or downloading."
        action={{ label: 'Search', onClick: () => onNavigate('search') }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <MediaRow title="Continue watching" items={continueWatchingItems(cw, onOpen)} />
      <MediaRow
        title="Watchlist"
        items={watchlist.slice(0, 12)}
        onSeeAll={watchlist.length > 12 ? () => onNavigate('library') : undefined}
      />
      <MediaRow
        title="Favourites"
        items={favourites.slice(0, 12)}
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
      <MediaRow title="Next up" items={nextUpItems(nu, onOpen)} />
    </div>
  )
}
