import { useState } from 'react'
import type { Navigate } from '../nav'

const STORE_KEY = 'watchers-intro-dismissed-v1'

function stored(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1'
  } catch {
    // Private mode or a full quota: treat as not dismissed rather than throwing.
    return false
  }
}

interface Props {
  navigate: Navigate
  /** Whether any watcher exists — the intro stays put until the first one does. */
  hasWatchers: boolean
}

/**
 * How watchers work, on the page where their findings land.
 *
 * Dismissable, but not dismissable into nothing: it sticks around until at least
 * one watcher exists, because "no watchers and no explanation" is the state where
 * this page looks broken rather than empty. Once dismissed it stays gone.
 */
export default function WatchersIntro({ navigate, hasWatchers }: Props) {
  const [dismissed, setDismissed] = useState(stored)

  if (dismissed) return null

  function dismiss() {
    try {
      localStorage.setItem(STORE_KEY, '1')
    } catch {
      // Not persisting is survivable; hiding it for this session is the point.
    }
    setDismissed(true)
  }

  return (
    <div className="rounded-box border border-primary/30 bg-primary/5 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <h3 className="text-sm font-semibold flex-1">
          Watchers check for new releases while you are away
        </h3>
        {/* Only offered once there is a watcher to show for it. */}
        {hasWatchers && (
          <button
            onClick={dismiss}
            className="btn btn-ghost btn-xs"
            aria-label="Dismiss this explanation"
          >
            Got it
          </button>
        )}
      </div>

      <ol className="flex flex-col gap-2 text-sm">
        <Step n={1} title="Watch a series or film">
          Open it and press{' '}
          <span className="font-medium text-base-content">Watch for new episodes</span> next to
          the title. New episodes and new languages get reported — including VF arriving on
          something you have been following in VOSTFR.
        </Step>
        <Step n={2} title="Watch a search">
          Search for anything and press{' '}
          <span className="font-medium text-base-content">Watch this search</span>. Useful when
          it finds nothing yet:{' '}
          <button
            onClick={() => navigate('search')}
            className="link link-primary"
          >
            try a search
          </button>
          .
        </Step>
        <Step n={3} title="Watch by genre and rating">
          Open <span className="font-medium text-base-content">Watchers</span> below and use{' '}
          <span className="font-medium text-base-content">Watch for new releases…</span> — any
          thriller rated 7+, say. Reported once a source actually carries it, so nothing here is
          something you cannot watch.
        </Step>
      </ol>

      <p className="text-xs text-base-content/60">
        The first check only records what already exists, so you are never told about a back
        catalogue you already had — only what turns up afterwards. Set{' '}
        <span className="font-medium">Download automatically</span> on a watcher to have it
        fetched as it lands, or{' '}
        <button onClick={() => navigate('settings')} className="link link-primary">
          set up WhatsApp
        </button>{' '}
        to hear about it off-device.
      </p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-semibold flex items-center justify-center mt-0.5"
      >
        {n}
      </span>
      <span className="text-base-content/70">
        <span className="font-medium text-base-content">{title}.</span> {children}
      </span>
    </li>
  )
}
