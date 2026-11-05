import { useSyncExternalStore } from 'react'

// The track whose key card is open: any row calls openKeyCard(), the one <KeyCard />
// mounted in App shows it.

let open: { id: string; title: string } | null = null
const listeners = new Set<() => void>()
const set = (v: typeof open) => { open = v; listeners.forEach(l => l()) }

export const openKeyCard = (id: string, title: string) => set({ id, title })
export const closeKeyCard = () => set(null)
export const useKeyCard = () =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => open)
