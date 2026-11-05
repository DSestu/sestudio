import { useSyncExternalStore } from 'react'
import type { ProxTrack } from './components/music/crates/proximity'
import type { Summary } from './musicMeta'
import type { MusicTrack } from './musicLibrary'

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

/** A track and its summary as proximity ranks them. */
export const proxOf = (t: MusicTrack, s?: Summary): ProxTrack => ({
  id: t.id, bpm: s?.bpm || t.bpm, camelot: s?.camelot, genre: s?.genre, harmony: s?.harmony, energyScale: s?.energyScale,
})
