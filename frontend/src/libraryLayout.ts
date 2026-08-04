import { useSyncExternalStore } from 'react'
import { putPreference } from './api'

// Which layout each library tab uses. A UI preference, persisted server-side
// like the rest (#24) so it follows you across devices, with localStorage as the
// instant offline cache.
//
// Per tab rather than global because the content differs: a resume list earns
// the space detail rows take, a wall of saved titles is better browsed as
// posters. One preference for both would always be wrong for one of them.

const STORAGE_KEY = 'sestudio.libraryLayout.v1'

export type Layout = 'grid' | 'detail'
export type LayoutTab = 'watching' | 'watchlist' | 'favourites'
export type LayoutPrefs = Record<LayoutTab, Layout>

const DEFAULTS: LayoutPrefs = {
  watching: 'detail',
  watchlist: 'grid',
  favourites: 'grid',
}

function coerce(raw: unknown): LayoutPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const value = raw as Partial<Record<LayoutTab, unknown>>
  const pick = (tab: LayoutTab): Layout =>
    value[tab] === 'grid' || value[tab] === 'detail' ? value[tab] : DEFAULTS[tab]
  return { watching: pick('watching'), watchlist: pick('watchlist'), favourites: pick('favourites') }
}

function read(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? coerce(JSON.parse(raw)) : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

let prefs = read()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // quota/unavailable — keep working in memory
  }
  listeners.forEach(l => l())
}

export function useLibraryLayout(): LayoutPrefs {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => prefs,
  )
}

export function setLibraryLayout(tab: LayoutTab, layout: Layout): void {
  if (prefs[tab] === layout) return
  prefs = { ...prefs, [tab]: layout }
  persist()
  void putPreference('library_layout', prefs).catch(() => {})
}

/** Replace from a server snapshot (startup hydration, #24). */
export function hydrateLibraryLayout(value: unknown): void {
  prefs = coerce(value)
  persist()
}
