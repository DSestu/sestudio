import { useSyncExternalStore } from 'react'
import { fitsAfter, type Filters, type Join, type ProxTrack } from './components/music/crates/proximity'
import { getSettings } from './api'
import type { Summary } from './musicMeta'
import type { MusicTrack } from './musicLibrary'

// The track the Music page's Tracks tab ranks the library after ("Fits after this"),
// and the kind of move wanted. Any row's menu sets it; MusicView shows the mode while it is set.

export interface FitsFilters {
  harmony: 'same' | 'close' | 'any'
  mood: 'any' | 'up' | 'same' | 'down'
  energy: 'any' | 'lift' | 'hold' | 'ease'
  genre: 'same' | 'any'
  tempo: 'near' | 'any'
}

const DEFAULTS: FitsFilters = { harmony: 'same', mood: 'any', energy: 'any', genre: 'same', tempo: 'near' }

interface State { ref?: string; filters: FitsFilters }
let state: State = { filters: DEFAULTS }
const listeners = new Set<() => void>()
const set = (s: State) => { state = s; listeners.forEach(l => l()) }

/** Filters start from the settings' harmony rule and reset with each new reference. */
export const setFitsRef = (id?: string) => {
  set({ ref: id, filters: DEFAULTS })
  if (!id) return
  getSettings().then(s => {
    const rule = s.music_harmony_rule
    if (rule && state.ref === id && state.filters === DEFAULTS) set({ ref: id, filters: { ...DEFAULTS, harmony: rule } })
  }).catch(() => {})
}

export const setFitsFilter = <K extends keyof FitsFilters>(k: K, v: FitsFilters[K]) =>
  set({ ...state, filters: { ...state.filters, [k]: v } })

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export const useFitsRef = (): string | undefined => useSyncExternalStore(subscribe, () => state.ref)
export const useFitsFilters = (): FitsFilters => useSyncExternalStore(subscribe, () => state.filters)

/** A track and its summary as proximity ranks them. */
export const proxOf = (t: MusicTrack, s?: Summary): ProxTrack => ({
  id: t.id, bpm: s?.bpm || t.bpm, camelot: s?.camelot, genre: s?.genre, harmony: s?.harmony, energyScale: s?.energyScale,
})

/** The pool ranked after `ref` under the chosen moves; "Same notes" is all 7 shared, "Close" 6 or more. */
export function rankFits(ref: ProxTrack, pool: ProxTrack[], f: FitsFilters): { id: string; join: Join }[] {
  const filters: Filters = {
    harmony: f.harmony === 'any' ? 'any' : 'safe',
    tempo: f.tempo,
    mood: f.mood === 'any' ? undefined : f.mood,
    energy: f.energy === 'any' ? undefined : f.energy,
    genre: f.genre,
  }
  const out = fitsAfter(ref, pool, filters, Infinity)
  return f.harmony === 'same' ? out.filter(r => r.join.shared === 7) : out
}
