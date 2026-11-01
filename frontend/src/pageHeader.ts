import { useSyncExternalStore } from 'react'

// Whether a page is showing its own phone top card (<PageHeader>). AppShell
// shows a default card (wordmark + Settings) on pages that don't.

let mounted = 0
const listeners = new Set<() => void>()

export function pageHeaderMounted(delta: 1 | -1) {
  mounted += delta
  listeners.forEach(l => l())
}

export function usePageHeaderMounted(): boolean {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l) },
    () => mounted > 0,
  )
}

/** A round button on the glass: the ⋯, Settings and back controls. */
export const GLASS_BUTTON =
  'grid place-items-center w-10 h-10 shrink-0 rounded-xl bg-white/6 text-base-content/85 transition-transform duration-100 active:scale-92'
