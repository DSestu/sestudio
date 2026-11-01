import { useSyncExternalStore } from 'react'

// Phones: whether the top card and the dock are out of the way because the
// page is being scrolled down (docs/SPEC-nav-redesign.md §4.3). AppShell
// drives it; the card, the dock and the playing strip follow it.

let hidden = false
const listeners = new Set<() => void>()

export function setBarsHidden(next: boolean) {
  if (next === hidden) return
  hidden = next
  listeners.forEach(l => l())
}

export function useBarsHidden(): boolean {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l) },
    () => hidden,
  )
}

/**
 * Classes for a bar that leaves while scrolling: `off` moves it out (pass the
 * full class, so Tailwind sees it). Leaving is quicker than coming back;
 * reduced motion only fades.
 */
export function AWAY(away: boolean, off: string): string {
  return away
    ? `${off} opacity-0 pointer-events-none duration-[220ms] ease-in motion-reduce:translate-y-0`
    : 'duration-[340ms] ease-smooth'
}
