import { useSyncExternalStore } from 'react'
import { DEFAULT_GROUPING, DIMS, MAX_LEVELS, PRESETS, type Dim, type Grouping, type Preset } from './components/music/library/grouping'

// The Music page's grouping (SPEC-music-library §2.2): one choice for the explorer and the
// tape, kept across visits.

const KEY = 'music.grouping'
const read = (): Grouping => {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Grouping>
    const dims = (g.dims ?? []).filter((d): d is Dim => d in DIMS).slice(0, MAX_LEVELS)
    return { ...DEFAULT_GROUPING, ...g, dims }
  } catch {
    return DEFAULT_GROUPING
  }
}
let state = read()
const listeners = new Set<() => void>()
const set = (patch: Partial<Grouping>) => {
  state = { ...state, ...patch }
  localStorage.setItem(KEY, JSON.stringify(state))
  listeners.forEach(l => l())
}

export const useGrouping = (): Grouping => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)
export const getGrouping = () => state
export const setGrouping = set
export const applyPreset = (id: Preset) => set({ files: id === 'files', dims: id === 'files' ? state.dims : PRESETS.find(p => p.id === id)!.dims })
/** Custom: click stacks a level at the end, click again removes it. */
export const toggleDim = (d: Dim) => {
  const dims = state.dims.includes(d) ? state.dims.filter(x => x !== d) : state.dims.length < MAX_LEVELS ? [...state.dims, d] : state.dims
  set({ files: false, dims })
}
