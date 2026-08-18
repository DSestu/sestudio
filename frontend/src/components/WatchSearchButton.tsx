import { useState } from 'react'
import { addWatcher, removeWatcher, useWatchers, watcherForQuery } from '../watchers'

interface Props {
  /** The query as searched, not as typed — so the button tracks what is on screen. */
  query: string
}

/**
 * Watch a search, so a title appearing under it later is reported.
 *
 * Deliberately available even when the search found nothing: "tell me when this
 * shows up" is the most useful case, and it is the one a results-only control
 * would hide.
 *
 * Watches the query text alone. The filters beside it (genre, rating, votes,
 * window) are applied in the browser over TMDB metadata and never reach the
 * server's search, so they cannot be part of a saved search — the tooltip says so
 * rather than letting the omission surprise anyone. For filter-driven watching
 * there is the criteria form under Activity.
 */
export default function WatchSearchButton({ query }: Props) {
  const watchers = useWatchers()
  const [busy, setBusy] = useState(false)
  const trimmed = query.trim()
  const existing = watcherForQuery(watchers, trimmed)

  if (!trimmed) return null

  async function toggle() {
    setBusy(true)
    try {
      if (existing) {
        await removeWatcher(existing.id)
      } else {
        await addWatcher({
          kind: 'saved_search',
          label: trimmed,
          // Every enabled site: a new listing is worth hearing about wherever it
          // turns up, and the site toggles in Settings already scope that.
          config: { query: trimmed, sources: [] },
        })
      }
    } catch {
      // Nothing changed server-side, and the store still shows the real state.
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void toggle()}
      aria-pressed={Boolean(existing)}
      title={
        existing
          ? `Stop watching searches for “${trimmed}”`
          : `Report new results for “${trimmed}”. Watches the search words — the filters here are not part of it.`
      }
      className={`btn btn-sm gap-2 ${existing ? 'btn-primary' : 'btn-outline'}`}
    >
      {busy ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        /* Filled bell when watching, outline when not — shape as well as colour. */
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill={existing ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h16l-1.4-1.4a2 2 0 01-.6-1.4z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17a3 3 0 11-6 0" />
        </svg>
      )}
      {existing ? 'Watching this search' : 'Watch this search'}
    </button>
  )
}
