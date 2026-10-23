import { useSyncExternalStore } from 'react'
import { loadPlayerPrefs, savePlayerPrefs } from './playerPrefs'

// The frame rate the browser player is asked for, shared between the player,
// which plays at it, and the picker under it, which sets it. 0 — the source's
// own. Saved, so the next video asks for the same.

let fps = loadPlayerPrefs().fps ?? 0
const listeners = new Set<() => void>()

export function setBrowserFps(next: number): void {
  fps = next
  savePlayerPrefs({ fps: next || undefined })
  listeners.forEach(l => l())
}

export function useBrowserFps(): number {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => fps,
  )
}
