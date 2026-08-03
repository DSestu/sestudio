import { getLibrary, importLibrary, type LibrarySnapshot } from './api'
import type { CollectionEntry } from './collections'
import { hydrateCollections } from './collections'
import type { PlayerPrefs } from './playerPrefs'
import { hydratePlayerPrefs } from './playerPrefs'
import { hydrateCollapsed } from './playlistCollapsed'
import type { WatchEntry } from './watchState'
import { hydrateWatch } from './watchState'

// Startup hydration of the server-side library (#24): fetch the snapshot and
// push it into the four client stores. On a fresh server with existing local
// data, run a one-time migration instead. All failures degrade silently to the
// localStorage caches the stores already loaded.

const WATCH_KEY = 'sestudio.watch.v1'
const COLLECTIONS_KEY = 'sestudio.collections.v1'
const PLAYER_KEY = 'sestudio.player.v1'
const COLLAPSE_KEY = 'sestudio.playlist.collapsed'

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function snapshotIsEmpty(s: LibrarySnapshot): boolean {
  return (
    Object.keys(s.watch).length === 0 &&
    Object.keys(s.collections.watchlist).length === 0 &&
    Object.keys(s.collections.favourites).length === 0 &&
    s.player === null
  )
}

function localSnapshot(): LibrarySnapshot {
  const collections = readLocal<{
    watchlist?: Record<string, CollectionEntry>
    favourites?: Record<string, CollectionEntry>
  }>(COLLECTIONS_KEY, {})
  let collapsed = false
  try {
    collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    // ignore
  }
  return {
    watch: readLocal<Record<string, WatchEntry>>(WATCH_KEY, {}),
    collections: {
      watchlist: collections.watchlist ?? {},
      favourites: collections.favourites ?? {},
    },
    player: readLocal<PlayerPrefs | null>(PLAYER_KEY, null),
    playlist_collapsed: collapsed,
  }
}

function apply(s: LibrarySnapshot): void {
  hydrateWatch(s.watch)
  hydrateCollections(s.collections)
  hydratePlayerPrefs(s.player)
  hydrateCollapsed(s.playlist_collapsed)
}

export async function hydrateLibrary(): Promise<void> {
  try {
    const server = await getLibrary()
    if (snapshotIsEmpty(server)) {
      const local = localSnapshot()
      if (!snapshotIsEmpty(local) || local.playlist_collapsed) {
        await importLibrary(local) // idempotent server-side (no-op once populated)
        apply(local) // local is now authoritative for this session
        return
      }
    }
    apply(server)
  } catch {
    // offline / server down — keep the localStorage-seeded caches as-is
  }
}
