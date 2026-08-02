import { useState } from 'react'
import type { AppSettings } from '../api'
import { useCollections } from '../collections'
import EmptyState from '../components/EmptyState'
import PosterGrid from '../components/PosterGrid'
import type { View } from '../nav'
import { continueWatchingItems, savedItems, type OpenTitle } from '../rowItems'
import { continueWatching, useWatchState } from '../watchState'

const TABS = [
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'progress', label: 'In progress' },
] as const

type Tab = (typeof TABS)[number]['id']

interface Props {
  settings: AppSettings
  onOpen: OpenTitle
  onNavigate: (v: View) => void
}

/** Everything the user has saved or started, as full grids rather than rows. */
export default function LibraryView({ settings, onOpen, onNavigate }: Props) {
  const [tab, setTab] = useState<Tab>('watchlist')
  const collections = useCollections()
  const watch = useWatchState()

  const items = tab === 'progress'
    ? continueWatchingItems(continueWatching(watch), onOpen)
    : savedItems(tab, collections, onOpen, settings.lang)

  const counts: Record<Tab, number> = {
    watchlist: savedItems('watchlist', collections, onOpen, settings.lang).length,
    favourites: savedItems('favourites', collections, onOpen, settings.lang).length,
    progress: continueWatching(watch).length,
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold tracking-tight">Library</h2>

      <div role="tablist" className="tabs tabs-box w-full sm:w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`tab flex-1 sm:flex-none gap-2 ${tab === t.id ? 'tab-active' : ''}`}
          >
            {t.label}
            <span className="badge badge-ghost badge-sm">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={tab === 'progress' ? 'Nothing in progress' : `Your ${tab} is empty`}
          message={tab === 'progress'
            ? 'Episodes you start watching show up here so you can pick them back up.'
            : 'Use the ☆ and ♥ controls on any title or episode to save it here.'}
          action={{ label: 'Search', onClick: () => onNavigate('search') }}
        />
      ) : (
        <PosterGrid items={items} />
      )}
    </div>
  )
}
