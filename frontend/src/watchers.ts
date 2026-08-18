import { useSyncExternalStore } from 'react'
import {
  createWatcher,
  deleteWatcher,
  getWatchers,
  patchWatcher,
  type Watcher,
  type WatcherKind,
} from './api'

// The watcher list, held once: the title page needs to know whether the title in
// front of you is already watched, and the settings list manages the same rows.
// One store means toggling in one place is reflected in the other.

let watchers: Watcher[] = []
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(l => l())
}

export function refreshWatchers(): Promise<void> {
  if (inflight) return inflight
  inflight = getWatchers()
    .then(next => {
      watchers = next
      loaded = true
      notify()
    })
    .catch(() => {
      // Server down: keep the list as it is rather than claiming there are none.
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (!loaded) void refreshWatchers()
  return () => {
    listeners.delete(cb)
  }
}

export function useWatchers(): Watcher[] {
  return useSyncExternalStore(subscribe, () => watchers)
}

/**
 * The watcher covering a title page, if there is one.
 *
 * Compared on path and the season parameters rather than the whole URL, because
 * senpai rotates its domain and a stored URL goes stale — the same reason item
 * keys hold no host.
 */
export function watcherForPage(all: Watcher[], pageUrl: string): Watcher | undefined {
  const wanted = pageIdentity(pageUrl)
  if (!wanted) return undefined
  return all.find(w => {
    const url = w.config.page_url
    return typeof url === 'string' && pageIdentity(url) === wanted
  })
}

/** The saved-search watcher for a query, if there is one. */
export function watcherForQuery(all: Watcher[], query: string): Watcher | undefined {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return undefined
  return all.find(
    w =>
      w.kind === 'saved_search' &&
      typeof w.config.query === 'string' &&
      w.config.query.trim().toLowerCase() === wanted,
  )
}

function pageIdentity(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    const parts = ['sn', 'sid']
      .map(name => {
        const value = parsed.searchParams.get(name)
        return value ? `${name}=${value}` : ''
      })
      .filter(Boolean)
      .sort()
    const path = parsed.pathname.replace(/\/$/, '').toLowerCase()
    return parts.length ? `${path}?${parts.join('&')}` : path
  } catch {
    return url.toLowerCase()
  }
}

export async function addWatcher(body: {
  kind: WatcherKind
  config: Record<string, unknown>
  label?: string
  auto_download?: boolean
}): Promise<Watcher> {
  const created = await createWatcher(body)
  watchers = [created, ...watchers]
  loaded = true
  notify()
  return created
}

export async function updateWatcher(
  id: number,
  patch: Parameters<typeof patchWatcher>[1],
): Promise<Watcher> {
  const next = await patchWatcher(id, patch)
  watchers = watchers.map(w => (w.id === next.id ? next : w))
  notify()
  return next
}

export async function removeWatcher(id: number): Promise<void> {
  await deleteWatcher(id)
  watchers = watchers.filter(w => w.id !== id)
  notify()
}
