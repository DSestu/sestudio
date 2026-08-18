import { useSyncExternalStore } from 'react'
import {
  getNotifications,
  markNotificationsRead,
  type NotificationPage,
  type WatcherEvent,
} from './api'

// The notification timeline, held once for the whole app: the nav badge needs the
// unread count on every screen, and the timeline view needs the rows. A shared
// store rather than a per-caller hook, so both cost one request — and so marking
// something read updates the badge without a refetch.

const PAGE_SIZE = 50

interface State {
  events: WatcherEvent[]
  unread: number
  loaded: boolean
  /** False once a page comes back short, so the view can stop offering "more". */
  hasMore: boolean
}

let state: State = { events: [], unread: 0, loaded: false, hasMore: false }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

const onFocus = () => {
  void refreshNotifications()
}

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  listeners.forEach(l => l())
}

function apply(page: NotificationPage, replace: boolean): void {
  const events = replace ? page.events : [...state.events, ...page.events]
  set({
    events,
    unread: page.unread,
    loaded: true,
    hasMore: page.events.length === PAGE_SIZE,
  })
}

/** Reload the first page. Concurrent callers share the one request in flight. */
export function refreshNotifications(): Promise<void> {
  if (inflight) return inflight
  inflight = getNotifications({ limit: PAGE_SIZE })
    .then(page => apply(page, true))
    .catch(() => {
      // Server down: keep whatever is on screen rather than blanking it.
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Append the next page. No-op while a load is already running. */
export async function loadMoreNotifications(): Promise<void> {
  if (inflight || !state.hasMore) return
  const offset = state.events.length
  try {
    apply(await getNotifications({ limit: PAGE_SIZE, offset }), false)
  } catch {
    // Leave the list as it is; the user can try again.
  }
}

/**
 * Mark rows read. Applied locally first so the badge responds immediately, then
 * reconciled with the count the server reports.
 */
export async function markRead(target: { ids: number[] } | { all: true }): Promise<void> {
  const ids = 'all' in target ? null : new Set(target.ids)
  const stamp = Math.floor(Date.now() / 1000)
  set({
    events: state.events.map(e =>
      e.read_at === null && (ids === null || ids.has(e.id)) ? { ...e, read_at: stamp } : e,
    ),
    unread: ids === null ? 0 : Math.max(0, state.unread - ids.size),
  })
  try {
    const result = await markNotificationsRead(target)
    set({ unread: result.unread })
  } catch {
    // The optimistic state was wrong; the next refresh corrects it.
    void refreshNotifications()
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Watchers fire on the server's schedule and nothing pushes the result, so
  // returning to the tab is when it is worth looking again.
  if (listeners.size === 1) window.addEventListener('focus', onFocus)
  if (!state.loaded) void refreshNotifications()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('focus', onFocus)
  }
}

export function useNotifications(): State {
  return useSyncExternalStore(subscribe, () => state)
}

/** Just the badge count, for chrome that does not render the list. */
export function useUnreadCount(): number {
  return useSyncExternalStore(subscribe, () => state.unread)
}

/**
 * Watch-route params for an event.
 *
 * Shared by the Activity feed and Home's peek so the two cannot drift: an event
 * already carries everything the route needs, so opening one costs no lookup.
 */
export function watchParamsForEvent(
  event: WatcherEvent,
  fallbackLang: string,
): Record<string, string | number | undefined> {
  const data = event.data
  return {
    u: data.page_url,
    t: data.series_name || event.title,
    p: event.poster_url,
    lang: data.lang ?? fallbackLang,
    ep: data.number || undefined,
    src: data.source,
  }
}

/** A short relative age, e.g. "4h ago". Timeline rows are scanned, not read. */
export function timeAgo(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000) - unixSeconds)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`
}

/** Day bucket for grouping the timeline, in the viewer's own timezone. */
export function dayLabel(unixSeconds: number, now = new Date()): string {
  const date = new Date(unixSeconds * 1000)
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}
