import { useSyncExternalStore } from 'react'

// Bridges the in-browser player's controls to surfaces that live outside the
// watch view — namely the mini-player (issue #20), which needs play/pause and
// the paused state but doesn't own the player instance. VideoPane registers
// itself here while mounted.

export interface BrowserPlayerControls {
  isPaused: boolean
  playPause: () => void
  /** Seek to a position (seconds) and resume — used to hand a stopped cast's
   *  timestamp back to the local player. */
  resumeAt: (seconds: number) => void
  /** Where it plays now, in seconds. */
  position: () => number
  /** Seconds buffered past that. */
  bufferedAhead: () => number
  /** The height playing, 0 until known. */
  height: () => number
  /** Heights the source plays at, best first; empty when it has one. */
  qualities: number[]
  /** Play at *height*, or the closest below; 0 for Auto, undefined for the
   *  source's own picture. Remembered. */
  setQuality: (height: number | undefined) => void
}

let state: BrowserPlayerControls | null = null
const listeners = new Set<() => void>()

export function setBrowserPlayerControls(next: BrowserPlayerControls | null): void {
  state = next
  listeners.forEach(l => l())
}

export function useBrowserPlayerControls(): BrowserPlayerControls | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => state,
  )
}
