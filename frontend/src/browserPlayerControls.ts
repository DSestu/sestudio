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
  /** Carry the position playing now across a change that reloads the source
   *  (another frame rate), rather than the watch progress — which is saved
   *  every few seconds, and not at all in the first 30. */
  holdPosition: () => void
  /** Where it plays now, in seconds. */
  position: () => number
  /** Seconds buffered past that. */
  bufferedAhead: () => number
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
