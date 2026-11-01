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

/** Back to wherever the page was opened from; Home when it was opened directly. */
export function goBack() {
  if (history.length > 1) history.back()
  else location.hash = '#/home'
}

// Desktop: the page's title, ⋯ menu and tabs go into slots in the glass card
// AppShell keeps above every page, around the search field. AppShell
// registers the slot elements; <PageHeader> portals into them.

export type DeskSlot = 'title' | 'menu' | 'tabs'
let slots: Partial<Record<DeskSlot, HTMLElement>> = {}
const slotListeners = new Set<() => void>()

/** A callback ref for one slot element. */
export const deskSlotRef = (slot: DeskSlot) => (el: HTMLElement | null) => {
  if ((slots[slot] ?? null) === el) return
  slots = { ...slots, [slot]: el ?? undefined }
  slotListeners.forEach(l => l())
}

export function useDeskSlots(): Partial<Record<DeskSlot, HTMLElement>> {
  return useSyncExternalStore(
    l => { slotListeners.add(l); return () => slotListeners.delete(l) },
    () => slots,
  )
}
