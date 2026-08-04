import { useSyncExternalStore } from 'react'

// Whether the library is in batch-selection mode. Lives outside React because
// AppShell needs it (to yield the mobile tab bar's slot to the selection bar)
// and AppShell is nowhere near LibraryView in the tree.
//
// Not persisted: selection is per-visit, unlike the layout preference.

let active = false
const listeners = new Set<() => void>()

export function useSelectionActive(): boolean {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => active,
  )
}

export function setSelectionActive(value: boolean): void {
  if (active === value) return
  active = value
  listeners.forEach(l => l())
}
