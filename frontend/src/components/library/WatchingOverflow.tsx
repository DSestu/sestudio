import { useState } from 'react'
import { isSaved, toggle as toggleCollection, useCollections } from '../../collections'
import { dismissSeries, type WatchingItem } from '../../watchState'
import ItemActionSheet, { type SheetAction } from './ItemActionSheet'
import { sheetIcon } from './sheetIcons'

interface Props {
  item: WatchingItem
  /** Subtitle for the sheet header, e.g. "S01E04 · The Cursed Sword". */
  context?: string
  onOpen: (item: WatchingItem) => void
}

/**
 * The ⋯ control and its action sheet for a Watching item.
 *
 * Shared by both layouts: the detail row hangs it in the overflow slot, the
 * poster card uses it as its only action (a card has nowhere to put five
 * controls, and this way there's one definition of what those actions are).
 */
export default function WatchingOverflow({ item, context, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const collections = useCollections()
  const ref = { series: item.series, season: item.season }

  const entry = {
    series: item.series,
    season: item.season,
    label: item.series,
    poster_url: item.poster_url,
    page_url: item.page_url,
    lang: item.lang,
  }

  const actions: SheetAction[] = [
    {
      id: 'watchlist',
      label: isSaved('watchlist', ref, collections) ? 'Remove from watchlist' : 'Add to watchlist',
      icon: sheetIcon.watchlist,
      onSelect: () => toggleCollection('watchlist', entry),
    },
    {
      id: 'favourite',
      label: isSaved('favourites', ref, collections) ? 'Remove from favourites' : 'Add to favourites',
      icon: sheetIcon.favourite,
      onSelect: () => toggleCollection('favourites', entry),
    },
    { id: 'open', label: 'Open series', icon: sheetIcon.open, onSelect: () => onOpen(item) },
    {
      id: 'dismiss',
      label: 'Remove from Watching',
      icon: sheetIcon.remove,
      onSelect: () => dismissSeries(item.series, item.season),
      destructive: true,
    },
  ]

  return (
    <>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          setOpen(true)
        }}
        aria-label={`More actions for ${item.series}`}
        aria-haspopup="dialog"
        className="btn btn-ghost btn-square btn-sm text-base-content/50 hover:text-base-content"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <ItemActionSheet
          title={item.series}
          subtitle={context}
          actions={actions}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
