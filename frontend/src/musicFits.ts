import { useSyncExternalStore } from 'react'

// The track the Music page's Tracks tab ranks the library after ("Fits after this").
// Any row's menu sets it; MusicView shows the mode while it is set.

let ref: string | undefined
const listeners = new Set<() => void>()

export const setFitsRef = (id?: string) => {
  ref = id
  listeners.forEach(l => l())
}

export const useFitsRef = (): string | undefined =>
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => ref)
