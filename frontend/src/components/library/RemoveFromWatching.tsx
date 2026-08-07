import { dismissSeries, type WatchingItem } from '../../watchState'

interface Props {
  item: WatchingItem
  /** Compact variant, to sit beside SaveToggles in a dense row. */
  size?: 'sm' | 'md'
}

/**
 * Drop a series from the Watching list.
 *
 * Shared by the detail row and the poster card so the two can't drift. No
 * confirmation: this only sets a dismissal watermark, so watching the series
 * again brings it straight back — see dismissSeries().
 */
export default function RemoveFromWatching({ item, size = 'md' }: Props) {
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        dismissSeries(item.series, item.season)
      }}
      aria-label={`Remove ${item.series} from Watching`}
      title="Remove from Watching"
      className={`btn btn-ghost btn-square text-base-content/40 hover:text-error ${
        size === 'sm' ? 'btn-sm' : 'btn-md sm:btn-sm'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}
