import { useSyncExternalStore } from 'react'
import type { MusicTrack } from './musicLibrary'
import type { Shape } from './components/music/library/tapeLayout'

// The Music page's set (SPEC-music-library §2.6): a working list apart from the queue, where
// tracks land when dragged or added. `tracks` is "your order"; a pinned track keeps its index
// in it, and Best blend orders the free ones around the pins. Kept across visits.

export type SetMode = 'mine' | 'blend'

export interface Landed {
  ids: string[]
  label: string
  pinned: boolean
  skipped: number
  at: number
}

export interface SetState {
  tracks: MusicTrack[]
  pinned: string[]
  mode: SetMode
  shape: Shape
  pinOnDrop: boolean
  /** Where the last drop landed, for the message under the lane (3 s). */
  landed?: Landed
  /** What the last removal took, for Undo (8 s). */
  undo?: { tracks: MusicTrack[]; pinned: string[]; mode: SetMode; count: number; at: number }
}

const KEY = 'music.set'
export const UNDO_MS = 8000
export const LANDED_MS = 3000

function read(): SetState {
  const base: SetState = { tracks: [], pinned: [], mode: 'blend', shape: 'Arc', pinOnDrop: true }
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<SetState>
    return { ...base, tracks: s.tracks ?? [], pinned: s.pinned ?? [], mode: s.mode ?? 'blend', shape: s.shape ?? 'Arc', pinOnDrop: s.pinOnDrop ?? true }
  } catch {
    return base
  }
}

let state = read()
const listeners = new Set<() => void>()
function set(patch: Partial<SetState>) {
  state = { ...state, ...patch }
  const { tracks, pinned, mode, shape, pinOnDrop } = state
  try { localStorage.setItem(KEY, JSON.stringify({ tracks, pinned, mode, shape, pinOnDrop })) } catch { /* private mode: kept for this session */ }
  listeners.forEach(l => l())
}

export const useSet = (): SetState => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)
export const getSet = () => state

/** Pins as the server takes them: `{index in your order: id}`. */
export const pinsOf = (s: Pick<SetState, 'tracks' | 'pinned'>): Record<number, string> =>
  Object.fromEntries(s.tracks.flatMap((t, i) => (s.pinned.includes(t.id) ? [[i, t.id]] : [])))

/**
 * Add `tracks` (those not in yet) at index `at` of the order on screen, or at the end.
 * `shown` is that order (Best blend's), so a drop between two tracks lands there; with
 * Pin on drop the added tracks are pinned there, else Best blend places them.
 */
export function addToSet(tracks: MusicTrack[], label: string, at?: number, shown?: MusicTrack[]): Landed {
  const have = new Set(state.tracks.map(t => t.id))
  const fresh = tracks.filter((t, i) => !have.has(t.id) && tracks.findIndex(x => x.id === t.id) === i)
  const base = shown && shown.length === state.tracks.length ? shown : state.tracks
  const i = at === undefined ? base.length : Math.max(0, Math.min(base.length, at))
  const pin = at !== undefined && state.pinOnDrop
  const landed: Landed = { ids: fresh.map(t => t.id), label, pinned: pin, skipped: tracks.length - fresh.length, at: Date.now() }
  set({
    tracks: [...base.slice(0, i), ...fresh, ...base.slice(i)],
    pinned: pin ? [...state.pinned, ...landed.ids] : state.pinned,
    landed,
  })
  return landed
}

export function removeFromSet(ids: string[]) {
  const drop = new Set(ids)
  const left = state.tracks.filter(t => !drop.has(t.id))
  if (left.length === state.tracks.length) return
  set({
    undo: { tracks: state.tracks, pinned: state.pinned, mode: state.mode, count: state.tracks.length - left.length, at: Date.now() },
    tracks: left,
    pinned: state.pinned.filter(id => !drop.has(id)),
  })
}

export const clearSet = () => removeFromSet(state.tracks.map(t => t.id))

export function undoRemove() {
  const u = state.undo
  if (u) set({ tracks: u.tracks, pinned: u.pinned, mode: u.mode, undo: undefined })
}

/** Move tracks as one block to index `to` of the order on screen (in their order there); a hand move switches to Your order. */
export function moveBlock(ids: string[], to: number, shown: MusicTrack[]) {
  const moving = new Set(ids)
  const block = shown.filter(t => moving.has(t.id))
  const before = shown.slice(0, to).filter(t => !moving.has(t.id))
  const after = shown.slice(to).filter(t => !moving.has(t.id))
  set({ tracks: [...before, ...block, ...after], mode: 'mine' })
}

/** Pin or unpin; pinning in Best blend first freezes the order on screen so it stays put. */
export function togglePin(id: string, shown: MusicTrack[]) {
  const on = state.pinned.includes(id)
  set({
    tracks: !on && state.mode === 'blend' && shown.length === state.tracks.length ? shown : state.tracks,
    pinned: on ? state.pinned.filter(x => x !== id) : [...state.pinned, id],
  })
}

export const unpinAll = () => set({ pinned: [] })
export const setSetMode = (mode: SetMode) => set({ mode })
export const setSetShape = (shape: Shape) => set({ shape })
export const setPinOnDrop = (pinOnDrop: boolean) => set({ pinOnDrop })
