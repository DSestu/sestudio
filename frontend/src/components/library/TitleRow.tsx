import type { CollectionEntry } from '../../collections'
import { entryWithoutTimestamp, relativeTime } from '../../rowItems'
import SaveToggles from '../SaveToggles'
import DetailRow from './DetailRow'

interface Props {
  entry: CollectionEntry
  onOpen: (entry: CollectionEntry) => void
  /** When set, the row selects instead of opening. */
  selection?: { selected: boolean; onToggle: () => void }
}

/**
 * A saved title as a detail row, for the Watchlist/Favourites detail layout.
 *
 * The layout preference is per tab, so every tab needs both shapes — this is the
 * title-level counterpart to WatchingRow. Removal is the filled star itself, so
 * there is no separate remove control.
 */
export default function TitleRow({ entry, onOpen, selection }: Props) {
  return (
    <DetailRow
      poster_url={entry.poster_url}
      title={entry.series}
      meta={entry.season > 0 ? `Season ${entry.season}` : 'Film'}
      submeta={`Added ${relativeTime(entry.addedAt)}`}
      onOpen={() => onOpen(entry)}
      selection={selection}
      actions={<SaveToggles entry={entryWithoutTimestamp(entry)} />}
    />
  )
}
