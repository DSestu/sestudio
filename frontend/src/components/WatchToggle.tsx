import { useState } from 'react'
import { addWatcher, removeWatcher, useWatchers, watcherForPage } from '../watchers'

interface Props {
  pageUrl: string
  source: string
  seriesName: string
  posterUrl: string
  isFilm: boolean
  size?: 'sm' | 'md'
  /**
   * 'icon' is a bare square button for dense rows. 'button' is labelled — use it
   * where the control has to be findable rather than compact, since an unlabelled
   * bell sitting between other unlabelled icons reads as decoration.
   */
  variant?: 'icon' | 'button'
}

/**
 * Start or stop watching a title for new episodes and languages.
 *
 * Watches every language rather than only the one being viewed: the point is to
 * hear that VF landed on a series you have been following in VOSTFR, which a
 * language-filtered watcher could not tell you.
 */
export default function WatchToggle({
  pageUrl,
  source,
  seriesName,
  posterUrl,
  isFilm,
  size = 'md',
  variant = 'icon',
}: Props) {
  const watchers = useWatchers()
  const existing = watcherForPage(watchers, pageUrl)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    try {
      if (existing) {
        await removeWatcher(existing.id)
      } else {
        await addWatcher({
          kind: isFilm ? 'film_available' : 'title_lang',
          label: seriesName,
          config: {
            page_url: pageUrl,
            source,
            langs: [],
            series_name: seriesName,
            poster_url: posterUrl,
          },
        })
      }
    } catch {
      // Nothing changed server-side, and the store still shows the real state.
    } finally {
      setBusy(false)
    }
  }

  const label = isFilm ? 'availability' : 'new episodes'
  const labelled = variant === 'button'
  const sizing = size === 'sm' ? 'btn-sm' : 'btn-md sm:btn-sm'
  const btn = labelled
    ? // Outlined-primary when off, solid when on: the control has to read as an
      // offer before it has been used, not as a dimmed icon.
      `btn gap-2 ${sizing} ${existing ? 'btn-primary' : 'btn-outline btn-primary'}`
    : `btn btn-ghost btn-square ${sizing} ${
        existing ? 'text-primary' : 'text-base-content/40 hover:text-primary'
      }`

  return (
    <button
      type="button"
      disabled={busy}
      onClick={e => {
        e.stopPropagation()
        void toggle()
      }}
      aria-pressed={Boolean(existing)}
      aria-label={
        existing ? `Stop watching ${seriesName} for ${label}` : `Watch ${seriesName} for ${label}`
      }
      title={
        existing
          ? `Watching for ${label} — new ones are reported under Activity`
          : `Watch for ${label}, reported under Activity`
      }
      className={btn}
    >
      {busy ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        /* Filled bell when watching, outline when not — the shape changes too, so
           the state never rests on colour alone. */
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill={existing ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h16l-1.4-1.4a2 2 0 01-.6-1.4z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17a3 3 0 11-6 0" />
        </svg>
      )}
      {labelled && (
        <>
          {/* Two lengths rather than a hidden label: the point of this variant is
              being readable, and a bare icon on mobile would undo that. */}
          <span className="hidden sm:inline">
            {existing
              ? isFilm
                ? 'Watching for release'
                : 'Watching for new episodes'
              : isFilm
                ? 'Tell me when it lands'
                : 'Watch for new episodes'}
          </span>
          <span className="sm:hidden">{existing ? 'Watching' : 'Watch'}</span>
        </>
      )}
    </button>
  )
}
