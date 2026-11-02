import { useSyncExternalStore } from 'react'

// Whether the phone's Discover menu is unfolded. Shared because the tab bar
// toggles it, the Discover heading opens it, and App renders it.

let open = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (next === open) return
  open = next
  listeners.forEach(l => l())
}

export function useDiscoverMenuOpen(): boolean {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l) },
    () => open,
  )
}

export const openDiscoverMenu = () => set(true)
export const closeDiscoverMenu = () => set(false)
export const toggleDiscoverMenu = () => set(!open)

/**
 * Fold the menu, then act. An open menu holds a history entry (back closes
 * it), and folding steps back over it; navigating before that step lands
 * would be undone by it, so the action waits for it.
 */
export function closeDiscoverMenuThen(act: () => void) {
  if (!open) { act(); return }
  window.addEventListener('popstate', () => act(), { once: true })
  set(false)
}

// Whether the open menu has grown to the top of the screen (searching), where
// the phone's top card would cover its search field; the card leaves meanwhile.
let tall = false
const tallListeners = new Set<() => void>()

export function setDiscoverTall(next: boolean) {
  if (next === tall) return
  tall = next
  tallListeners.forEach(l => l())
}

export function useDiscoverTall(): boolean {
  return useSyncExternalStore(
    l => { tallListeners.add(l); return () => tallListeners.delete(l) },
    () => tall,
  )
}
