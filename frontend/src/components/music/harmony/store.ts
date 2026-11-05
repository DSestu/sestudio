import { useSyncExternalStore } from 'react'

// Whether the Harmony basics explainer is open: any screen calls openHarmonyBasics(),
// the one <HarmonyBasics /> mounted in App shows it.

let open = false
let step = 0
const listeners = new Set<() => void>()
const set = (v: boolean) => { open = v; listeners.forEach(l => l()) }

/** Open the guide, on a step (0-based) when given; the argument is ignored when it is not a number, so it can be an onClick. */
export const openHarmonyBasics = (at?: unknown) => { step = typeof at === 'number' ? at : 0; set(true) }
export const harmonyBasicsStep = () => step
export const closeHarmonyBasics = () => set(false)
export const useHarmonyBasicsOpen = () =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => open)
