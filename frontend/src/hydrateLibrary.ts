import { batchLibrary, getLibrary, importLibrary, type LibrarySnapshot } from './api'
import type { CollectionEntry, ListName } from './collections'
import { foldToTitles, hydrateCollections } from './collections'
import type { PlayerPrefs } from './playerPrefs'
import { hydratePlayerPrefs } from './playerPrefs'
import { hydrateLibraryLayout } from './libraryLayout'
import { hydrateCollapsed } from './playlistCollapsed'
import type { WatchEntry } from './watchState'
import { hydrateWatch } from './watchState'

// Startup hydration of the server-side library (#24): fetch the snapshot and
// push it into the four client stores. On a fresh server with existing local
// data, run a one-time migration instead. All failures degrade silently to the
// localStorage caches the stores already loaded.

const WATCH_KEY = 'sestudio.watch.v1'
// v2 by the time this runs: the collections module upgrades a v1 cache at import.
const COLLECTIONS_KEY = 'sestudio.collections.v2'
const PLAYER_KEY = 'sestudio.player.v1'
const COLLAPSE_KEY = 'sestudio.playlist.collapsed'
const LAYOUT_KEY = 'sestudio.libraryLayout.v1'

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
    library_layout: readLocal<unknown>(LAYOUT_KEY, null),
  }
}

/**
 * Fold any episode-level collection entries the server still holds up to their
 * title, and drop the superseded keys (#26).
 *
 * Returns the snapshot unchanged when there is nothing to fold, which is the
 * case from the second run onward — so this is safe on every load. When there
 * is, it rewrites the whole list rather than computing a minimal diff; it only
 * ever happens once, and one transaction is cheaper than the bookkeeping.
 */
async function foldCollections(s: LibrarySnapshot): Promise<LibrarySnapshot> {
  const folded = {
    watchlist: foldToTitles(s.collections.watchlist),
    favourites: foldToTitles(s.collections.favourites),
  }
  const lists = Object.keys(folded) as ListName[]
  const stale = lists.flatMap(list =>
    folded[list].staleKeys.map(key => ({ list, key })),
  )
  if (!stale.length) return s

  const collections = { watchlist: folded.watchlist.entries, favourites: folded.favourites.entries }
  try {
    await batchLibrary({
      collections_delete: stale,
      collections_put: lists.flatMap(list =>
        Object.entries(collections[list]).map(([key, entry]) => ({ list, key, entry })),
      ),
    })
  } catch {
    // Server unreachable — fold locally anyway; the next load retries the write.
  }
  return { ...s, collections }
}

function apply(s: LibrarySnapshot): void {
  hydrateWatch(s.watch)
  hydrateCollections(s.collections)
  hydratePlayerPrefs(s.player)
  hydrateCollapsed(s.playlist_collapsed)
  hydrateLibraryLayout(s.library_layout)
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
    apply(await foldCollections(server))
  } catch {
    // offline / server down — keep the localStorage-seeded caches as-is
  }
}
