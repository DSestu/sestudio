import { useMemo, useState } from 'react'
import type { WatcherEvent } from '../api'
import DetailRow from '../components/library/DetailRow'
import EmptyState from '../components/EmptyState'
import WatcherKindBadge from '../components/WatcherKindBadge'
import WatchersAccordion from '../components/WatchersAccordion'
import WatchersIntro from '../components/WatchersIntro'
import type { Navigate } from '../nav'
import {
  dayLabel,
  loadMoreNotifications,
  markRead,
  timeAgo,
  useNotifications,
} from '../notifications'
import { useWatchers } from '../watchers'

interface Props {
  /** Open the title an event points at, at that episode and language. */
  onOpen: (event: WatcherEvent) => void
  /** Whether TMDB is configured, for the criteria-watcher form. */
  tmdbConfigured?: boolean
  navigate: Navigate
}

/**
 * The watcher timeline: what appeared since you last looked, newest first.
 *
 * Days are plain headings rather than collapsible sections — a feed exists to be
 * scanned, and collapsing the most recent day would hide the news it is for.
 */
export default function NotificationsView({ onOpen, tmdbConfigured, navigate }: Props) {
  const { events, unread, loaded, hasMore } = useNotifications()
  const watchers = useWatchers()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const shown = useMemo(
    () => (unreadOnly ? events.filter(e => e.read_at === null) : events),
    [events, unreadOnly],
  )

  // Group into day buckets, preserving the server's newest-first order.
  const groups = useMemo(() => {
    const out: { label: string; events: WatcherEvent[] }[] = []
    for (const event of shown) {
      const label = dayLabel(event.created_at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.events.push(event)
      else out.push({ label, events: [event] })
    }
    return out
  }, [shown])

  async function loadMore() {
    setBusy(true)
    try {
      await loadMoreNotifications()
    } finally {
      setBusy(false)
    }
  }

  const empty = loaded && events.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-semibold flex-1">
          Activity
          {unread > 0 && <span className="badge badge-primary badge-sm ml-2">{unread} new</span>}
        </h2>
        {!empty && (
          <>
            <label className="label cursor-pointer gap-2 py-0">
              <span className="label-text text-sm">Unread only</span>
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={unreadOnly}
                onChange={e => setUnreadOnly(e.target.checked)}
              />
            </label>
            <button
              className="btn btn-sm btn-ghost"
              disabled={unread === 0}
              onClick={() => void markRead({ all: true })}
            >
              Mark all read
            </button>
          </>
        )}
      </div>

      {/* What is being watched sits above the feed it produces — and stays put
          when the feed is empty, since an empty feed is exactly when you want to
          check what is actually being watched. */}
      <WatchersIntro navigate={navigate} hasWatchers={watchers.length > 0} />

      <WatchersAccordion tmdbConfigured={tmdbConfigured} />

      {empty && (
        <EmptyState
          title="Nothing new yet"
          message="New episodes, new languages and new releases show up here. A watcher's first check only records what already exists, so only what arrives after that is reported."
        />
      )}

      {groups.map(group => (
        <section key={group.label} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
            {group.label}
          </h3>
          {group.events.map(event =>
            event.event_type === 'new_item' ? (
              <ItemRow key={event.id} event={event} onOpen={onOpen} />
            ) : (
              <ProblemRow key={event.id} event={event} />
            ),
          )}
        </section>
      ))}

      {unreadOnly && shown.length === 0 && (
        <p className="text-sm text-base-content/60 py-8 text-center">Nothing unread.</p>
      )}

      {hasMore && !unreadOnly && (
        <button className="btn btn-sm btn-ghost self-center" disabled={busy} onClick={loadMore}>
          {busy ? <span className="loading loading-spinner loading-xs" /> : 'Load older'}
        </button>
      )}
    </div>
  )
}

function DownloadNote({ event }: { event: WatcherEvent }) {
  if (event.download_state === 'queued') {
    return <span className="badge badge-info badge-sm">Downloading</span>
  }
  if (event.download_state === 'skipped') {
    return <span className="badge badge-ghost badge-sm">Already on disk</span>
  }
  if (event.download_state === 'error') {
    return <span className="badge badge-error badge-sm">Download failed</span>
  }
  return null
}

function ItemRow({
  event,
  onOpen,
}: {
  event: WatcherEvent
  onOpen: (event: WatcherEvent) => void
}) {
  const unread = event.read_at === null
  return (
    // The left edge is unread state here, so kind is carried by the badge alone —
    // two competing left borders on one row would read as one confused signal.
    <div className={unread ? 'border-l-2 border-primary pl-2 -ml-2' : undefined}>
      <DetailRow
        poster_url={event.poster_url}
        title={event.title}
        meta={event.subtitle}
        submeta={
          <>
            <WatcherKindBadge kind={event.watcher_kind} length="short" />
            <span>{timeAgo(event.created_at)}</span>
          </>
        }
        onOpen={() => {
          if (unread) void markRead({ ids: [event.id] })
          onOpen(event)
        }}
        actions={
          <>
            <button className="btn btn-primary btn-sm" onClick={() => onOpen(event)}>
              Watch
            </button>
            {unread && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void markRead({ ids: [event.id] })}
              >
                Mark read
              </button>
            )}
            <DownloadNote event={event} />
          </>
        }
      />
    </div>
  )
}

/** A watcher that is failing, or was switched off after failing repeatedly. */
function ProblemRow({ event }: { event: WatcherEvent }) {
  const disabled = event.event_type === 'watcher_disabled'
  const unread = event.read_at === null
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-box bg-base-200/40 ring-1 ${
        disabled ? 'ring-error/40' : 'ring-warning/40'
      }`}
    >
      <span className={`badge badge-sm mt-0.5 ${disabled ? 'badge-error' : 'badge-warning'}`}>
        {disabled ? 'Off' : 'Warning'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight truncate">{event.title}</p>
        <p className="text-sm text-base-content/70">{event.subtitle}</p>
        {event.data.error && (
          <p className="text-xs text-base-content/50 mt-0.5 break-words">{event.data.error}</p>
        )}
        <p className="text-xs text-base-content/50 mt-0.5">{timeAgo(event.created_at)}</p>
      </div>
      {unread && (
        <button
          className="btn btn-ghost btn-xs shrink-0"
          onClick={() => void markRead({ ids: [event.id] })}
        >
          Mark read
        </button>
      )}
    </div>
  )
}
