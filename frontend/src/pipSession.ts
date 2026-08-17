import { useSyncExternalStore } from 'react'

/**
 * The open Document Picture-in-Picture window, as shared state.
 *
 * Module-level rather than threaded through props because three unrelated
 * places need it: the watch view (which must release the player node), the
 * mini-player (which must not claim it), and the portal that mounts it into the
 * PiP window. Same shape as `browserPlayerControls`.
 *
 * Only one PiP window exists at a time — the player node is a single DOM node
 * and exactly one mount point may hold it.
 */

let current: Window | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPiPWindow(): Window | null {
  return current
}

/** Subscribe to the open PiP window (null when closed). */
export function usePiPWindow(): Window | null {
  return useSyncExternalStore(subscribe, getPiPWindow, () => null)
}

export function setPiPWindow(win: Window | null): void {
  if (current === win) return
  current = win
  emit()
}

/** Close the window if open; the `pagehide` handler clears the state. */
export function closePiP(): void {
  current?.close()
  setPiPWindow(null)
}
