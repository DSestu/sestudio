import type { WatcherEvent } from '../api'
import { markRead, timeAgo, useNotifications } from '../notifications'

/** Rows shown on Home before deferring to the Activity feed. */
const PEEK_LIMIT = 3

interface Props {
  onOpen: (event: WatcherEvent) => void
  onSeeAll: () => void
}

/**
 * The newest watcher findings, on Home.
 *
 * Compact rows rather than the Activity feed's poster rows, and rather than a
 * poster strip: several new episodes of one series would be several identical
 * posters, so the episode and language are the only things worth the space.
 *
 * Renders nothing when there is nothing new, so Home does not grow a permanent
 * empty shelf.
 */
export default function ActivityPeek({ onOpen, onSeeAll }: Props) {
  const { events, unread } = useNotifications()
  if (events.length === 0) return null

  const shown = events.slice(0, PEEK_LIMIT)

  return (
    <section aria-label="Latest activity">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-base sm:text-lg font-semibold tracking-tight">
          New for you
          {unread > 0 && <span className="badge badge-primary badge-sm ml-2">{unread}</span>}
        </h2>
        <button
          onClick={onSeeAll}
          className="text-xs font-medium text-base-content/50 hover:text-primary transition-colors"
        >
          See all
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map(event => {
          const problem = event.event_type !== 'new_item'
          const unreadRow = event.read_at === null
          return (
            <button
              key={event.id}
              onClick={() => {
                if (unreadRow) void markRead({ ids: [event.id] })
                if (!problem) onOpen(event)
                else onSeeAll()
              }}
              className={`flex items-center gap-3 p-2 rounded-box bg-base-200/40 ring-1 text-left transition ${
                unreadRow ? 'ring-primary/40' : 'ring-base-300 hover:ring-primary/40'
              }`}
            >
              {/* Unread is marked by a dot as well as the ring, never colour alone. */}
              <span
                aria-hidden="true"
                className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                  unreadRow ? 'bg-primary' : 'bg-transparent'
                }`}
              />
              <span className="shrink-0 w-8 rounded overflow-hidden bg-base-300">
                {event.poster_url ? (
                  <img
                    src={event.poster_url}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-[2/3] object-cover"
                  />
                ) : (
                  <span className="block w-full aspect-[2/3]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{event.title}</span>
                <span className="block text-xs text-base-content/60 truncate">
                  {event.subtitle}
                </span>
              </span>
              <span className="shrink-0 text-xs text-base-content/40">
                {timeAgo(event.created_at)}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
