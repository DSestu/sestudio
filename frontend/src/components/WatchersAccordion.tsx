import { useState } from 'react'
import { pollWatcher, type Watcher } from '../api'
import { refreshNotifications, timeAgo } from '../notifications'
import { refreshWatchers, removeWatcher, updateWatcher, useWatchers } from '../watchers'
import CriteriaWatcherForm from './CriteriaWatcherForm'
import WatcherKindBadge from './WatcherKindBadge'
import { kindMeta } from '../watcherKinds'

const INTERVALS = [
  { value: 1800, label: 'Every 30 minutes' },
  { value: 3600, label: 'Hourly' },
  { value: 21600, label: 'Every 6 hours' },
  { value: 86400, label: 'Daily' },
]

/**
 * What is being watched, above the timeline it feeds.
 *
 * Collapsed by default: the feed is what you came to read, and the watcher list
 * is a sidebar to it. The count on the summary is what makes it worth opening,
 * so it has to be readable without opening it.
 *
 * Creating a watcher happens where the thing to watch is — the bell on a title —
 * so this is only ever a list of what already exists.
 */
interface Props {
  /** Whether TMDB is configured — criteria watchers have nothing to filter on
   *  without it. */
  tmdbConfigured?: boolean
}

export default function WatchersAccordion({ tmdbConfigured = false }: Props) {
  const watchers = useWatchers()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act<T>(id: number, run: () => Promise<T>): Promise<T | undefined> {
    setBusy(id)
    setError(null)
    try {
      return await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function check(watcher: Watcher) {
    const result = await act(watcher.id, () => pollWatcher(watcher.id))
    if (!result) return
    // The check may have produced events and will have moved the schedule on.
    void refreshNotifications()
    void refreshWatchers()
    if (result.error) setError(`${watcher.label || 'Watcher'}: ${result.error}`)
  }

  const paused = watchers.filter(w => !w.enabled).length

  return (
    <details className="group rounded-box border border-base-300">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none hover:bg-base-200 rounded-box">
        <svg
          className="w-3.5 h-3.5 shrink-0 text-base-content/40 transition-transform group-open:rotate-90"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
          Watchers
        </span>
        <span className="text-xs text-base-content/40">
          {watchers.length === 0
            ? 'none yet'
            : `${watchers.length} watching${paused ? ` · ${paused} paused` : ''}`}
        </span>
      </summary>

      <div className="px-3 pb-3 flex flex-col gap-3">
        {watchers.length === 0 ? (
          <p className="text-sm text-base-content/60">
            Open a series and press the bell to have new episodes and languages reported
            here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {watchers.map(watcher => (
              <li
                key={watcher.id}
                // Coloured left edge as well as the badge: it is what lets you see
                // the groups while scrolling, without reading a single label.
                className={`flex flex-col gap-2 rounded-box bg-base-200/40 ring-1 ring-base-300 p-3 border-l-4 ${
                  kindMeta(watcher.kind).edge
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-tight truncate">
                      {watcher.label || `Watcher ${watcher.id}`}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <WatcherKindBadge kind={watcher.kind} />
                      <span className="text-xs text-base-content/50">
                        {watcher.baselined_at === null
                          ? 'not checked yet'
                          : watcher.last_ok_at
                            ? `checked ${timeAgo(watcher.last_ok_at)}`
                            : ''}
                      </span>
                    </div>
                  </div>
                  {!watcher.enabled && (
                    <span className="badge badge-ghost badge-sm">Paused</span>
                  )}
                  {watcher.consecutive_failures > 0 && (
                    <span className="badge badge-warning badge-sm">
                      {watcher.consecutive_failures} failed
                    </span>
                  )}
                </div>

                {watcher.last_error && watcher.consecutive_failures > 0 && (
                  <p className="text-xs text-base-content/50 break-words">
                    {watcher.last_error}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={watcher.enabled}
                      onChange={async e => {
                        await act(watcher.id, () =>
                          updateWatcher(watcher.id, { enabled: e.target.checked }),
                        )
                      }}
                    />
                    <span>Active</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={watcher.auto_download}
                      onChange={async e => {
                        await act(watcher.id, () =>
                          updateWatcher(watcher.id, { auto_download: e.target.checked }),
                        )
                      }}
                    />
                    <span>Download automatically</span>
                  </label>

                  <select
                    aria-label="Check frequency"
                    className="select select-bordered select-sm"
                    value={watcher.interval_seconds}
                    onChange={async e => {
                      await act(watcher.id, () =>
                        updateWatcher(watcher.id, {
                          interval_seconds: Number(e.target.value),
                        }),
                      )
                    }}
                  >
                    {INTERVALS.some(i => i.value === watcher.interval_seconds) ? null : (
                      <option value={watcher.interval_seconds}>
                        Every {Math.round(watcher.interval_seconds / 60)} minutes
                      </option>
                    )}
                    {INTERVALS.map(i => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex gap-2 ml-auto">
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busy === watcher.id}
                      onClick={() => void check(watcher)}
                    >
                      {busy === watcher.id ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        'Check now'
                      )}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost text-error"
                      disabled={busy === watcher.id}
                      onClick={() => void act(watcher.id, () => removeWatcher(watcher.id))}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-error">{error}</p>}

        {/* Series and films are watched from their own page, where the thing to
            watch is. Criteria have no page to start from, so they are created
            here. */}
        <CriteriaWatcherForm tmdbConfigured={tmdbConfigured} />

        <p className="text-xs text-base-content/50">
          A watcher’s first check only records what already exists, so you are not told
          about a back catalogue you already had.
        </p>
      </div>
    </details>
  )
}
