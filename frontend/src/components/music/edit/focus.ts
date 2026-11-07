import { useSyncExternalStore, type DragEvent } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { addPayload } from '../../../musicQueue'

// What the playlist editor's Fits column is about (SPEC-playlist-edit): the thing the
// pointer rested on for FOLLOW_MS, kept after it leaves, frozen by Pin; and the drag in
// progress, which Fits previews while it is over the playlist.

export const FOLLOW_MS = 250

export type Target =
  | { k: 'track'; track: MusicTrack }
  | { k: 'row'; item: string }
  | { k: 'join'; item: string }

export interface Drag {
  track: MusicTrack
  /** The playlist item being moved, for a row of the playlist itself. */
  item?: string
  /** The flat index it would land at, while over the playlist. */
  gap?: number
}

export type Sheet = 'lib' | 'online' | 'fits' | null

interface State {
  target?: Target
  pinned: boolean
  drag?: Drag
  /** The open sheet on phones. */
  sheet: Sheet
}

let state: State = { pinned: false, sheet: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(l => l()) }
let timer = 0

const keyOf = (t?: Target) => !t ? '' : t.k === 'track' ? `track:${t.track.id}` : `${t.k}:${t.item}`

/** Aim Fits at a target now: a click or a tap says so, so it holds even when pinned. */
export function aim(t: Target) {
  window.clearTimeout(timer)
  if (state.drag || keyOf(t) === keyOf(state.target)) return
  set({ target: t })
}

const follow = (t: Target) => { if (!state.pinned && !state.drag && keyOf(t) !== keyOf(state.target)) set({ target: t }) }

/** The pointer rests on a target: Fits follows it after FOLLOW_MS. Leaving keeps it. */
export function hover(t: Target) {
  window.clearTimeout(timer)
  if (state.pinned || state.drag || keyOf(t) === keyOf(state.target)) return
  timer = window.setTimeout(() => follow(t), FOLLOW_MS)
}

/** The pointer left before FOLLOW_MS: nothing changes. */
export const unhover = () => window.clearTimeout(timer)

export const togglePin = () => set({ pinned: !state.pinned })
export const setSheet = (sheet: Sheet) => set({ sheet })
export const startDrag = (d: Drag) => { window.clearTimeout(timer); set({ drag: d }) }
export const dragGap = (gap: number | undefined) => { if (state.drag && state.drag.gap !== gap) set({ drag: { ...state.drag, gap } }) }
export const endDrag = () => { if (state.drag) set({ drag: undefined }) }
/** Leaving the editor forgets the target. */
export const resetFocus = () => { window.clearTimeout(timer); set({ target: undefined, pinned: false, drag: undefined, sheet: null }) }

export const useFocus = (): State => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => state)
export const getFocus = () => state

/** One song, whatever its library: the "In playlist" mark compares these. */
export const songKey = (t: { title?: string; artist?: string }) => `${t.title ?? ''}\u0000${t.artist ?? ''}`.toLowerCase()

/** A track as a playlist add (an online one carries what the row shows). */
export const refOf = (t: MusicTrack) => addPayload([t], 'append').tracks[0]

/** The props that make a row draggable into the playlist (desktop: HTML drag and drop). */
export const dragProps = (track: MusicTrack, item?: string) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.effectAllowed = item ? 'move' : 'copy'
    e.dataTransfer.setData('text/plain', track.title)
    startDrag({ track, item })
  },
  onDragEnd: () => endDrag(),
})
