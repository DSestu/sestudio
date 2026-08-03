import { useSyncExternalStore } from 'react'
import { putPreference } from './api'

// Whether the watch view's episode sidebar is collapsed. A UI preference, but
// persisted server-side like the rest (#24) so it follows you across devices,
// with localStorage as the instant offline cache.

const STORAGE_KEY = 'sestudio.playlist.collapsed'

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let collapsed = read()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // ignore
  }
  listeners.forEach(l => l())
}

export function usePlaylistCollapsed(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => collapsed,
  )
}

export function togglePlaylistCollapsed(): void {
  collapsed = !collapsed
  persist()
  void putPreference('playlist_collapsed', collapsed).catch(() => {})
}

/** Replace from a server snapshot (startup hydration, #24). */
export function hydrateCollapsed(value: boolean): void {
  collapsed = value
  persist()
}
