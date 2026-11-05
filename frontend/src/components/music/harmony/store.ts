import { useSyncExternalStore } from 'react'

// Whether the Harmony basics explainer is open: any screen calls openHarmonyBasics(),
// the one <HarmonyBasics /> mounted in App shows it.

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => { open = v; listeners.forEach(l => l()) }

export const openHarmonyBasics = () => set(true)
export const closeHarmonyBasics = () => set(false)
export const useHarmonyBasicsOpen = () =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => open)
