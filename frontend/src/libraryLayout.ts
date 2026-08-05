import { useSyncExternalStore } from 'react'
import { putPreference } from './api'

// Which layout each list surface uses. A UI preference, persisted server-side
// like the rest (#24) so it follows you across devices, with localStorage as the
// instant offline cache.
//
// Per surface rather than global because the content differs: a resume list earns
// the space detail rows take, a wall of saved titles is better browsed as
// posters. One preference for both would always be wrong for one of them.
//
// Search results are a surface here too, so they inherit the same store and
// validation. The persisted key stays `library_layout` — the value is one opaque
// JSON blob, so widening it needs no server change, and renaming the key would
// need a migration for nothing the user would see.

const STORAGE_KEY = 'sestudio.libraryLayout.v1'

export type Layout = 'grid' | 'detail'
export type LayoutTab = 'watching' | 'watchlist' | 'favourites'
/** Every list that has a layout choice — the library's tabs, plus search. */
export type LayoutSurface = LayoutTab | 'search' | 'browse'
export type LayoutPrefs = Record<LayoutSurface, Layout>

const DEFAULTS: LayoutPrefs = {
  watching: 'detail',
  watchlist: 'grid',
  favourites: 'grid',
  // Search and browse stay poster walls by default: they are scanned, not read.
  search: 'grid',
  browse: 'grid',
}

const SURFACES: LayoutSurface[] = [
  'watching', 'watchlist', 'favourites', 'search', 'browse',
]

function coerce(raw: unknown): LayoutPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const value = raw as Partial<Record<LayoutSurface, unknown>>
  // A blob written before a surface existed simply falls back to its default.
  const pick = (surface: LayoutSurface): Layout =>
    value[surface] === 'grid' || value[surface] === 'detail'
      ? value[surface]
      : DEFAULTS[surface]
  return Object.fromEntries(SURFACES.map(s => [s, pick(s)])) as LayoutPrefs
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

export function setLibraryLayout(surface: LayoutSurface, layout: Layout): void {
  if (prefs[surface] === layout) return
  prefs = { ...prefs, [surface]: layout }
  persist()
  void putPreference('library_layout', prefs).catch(() => {})
}

/** Replace from a server snapshot (startup hydration, #24). */
export function hydrateLibraryLayout(value: unknown): void {
  prefs = coerce(value)
  persist()
}
