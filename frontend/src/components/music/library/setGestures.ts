import { useEffect, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { endDrag } from '../edit/focus'
import { carriedNow, carryProps, endCarry } from './carry'
import { clearSelection, getSelection } from './selection'

// The playlist's gestures (SPEC-blend-playlists §5): drops land between two items, a selected item carries
// the selection as a block, and an item let go far enough off the container is removed.

export type Axis = 'x' | 'y'

/** What the gestures do to the playlist they sit on. */
export interface SetActions {
  move: (ids: string[], to: number, shown: MusicTrack[]) => void
  /** `to` is undefined when the list is empty. */
  add: (tracks: MusicTrack[], label: string, to: number | undefined, shown: MusicTrack[]) => void
  remove: (ids: string[]) => void
}

/** The slot under the pointer among the container's `[data-set-item]` children. */
function slotAt(box: HTMLElement | null, p: number, axis: Axis): number {
  const items = [...(box?.querySelectorAll<HTMLElement>('[data-set-item]') ?? [])]
  const i = items.findIndex(el => { const r = el.getBoundingClientRect(); return axis === 'x' ? p < r.left + r.width / 2 : p < r.top + r.height / 2 })
  return i < 0 ? items.length : i
}

/** Drag over and drop: a move inside the playlist or tracks coming in. */
export function useSetDrop(box: React.RefObject<HTMLElement | null>, shown: MusicTrack[], axis: Axis, on: SetActions) {
  const [slot, setSlot] = useState<number | null>(null)
  const at = (e: React.DragEvent) => slotAt(box.current, axis === 'x' ? e.clientX : e.clientY, axis)
  return {
    slot,
    onDragOver: (e: React.DragEvent) => {
      if (!carriedNow()) return
      e.preventDefault()
      setSlot(shown.length ? at(e) : 0)
    },
    onDragLeave: () => setSlot(null),
    onDrop: (e: React.DragEvent) => {
      const c = carriedNow()
      setSlot(null)
      if (!c) return
      e.preventDefault()
      const to = shown.length ? at(e) : undefined
      if (c.from === 'set') {
        on.move(c.tracks.map(t => t.id), to ?? 0, shown)
      } else on.add(c.tracks, c.label, to, shown)
      endCarry()
      endDrag()
    },
  }
}

/** Delete removes the selected tracks of the playlist. */
export function useDeleteKey(remove: SetActions['remove']) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]')) return
      const sel = getSelection()
      if (sel.scope !== 'set' || !sel.ids.size) return
      remove([...sel.ids])
      clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [remove])
}

/** How far off the container a dragged item is let go to remove it: above or below the lane, beside the list. */
const OFF_PX: Record<Axis, number> = { x: 36, y: 50 }

/**
 * Moves inside the set: a selected item carries the whole selection as a block; dragged far
 * enough off the container, a red label says release removes them, and it does.
 */
export function useDragOff(box: React.RefObject<HTMLElement | null>, shown: MusicTrack[], picked: ReadonlySet<string>, axis: Axis, remove: SetActions['remove']) {
  const [off, setOff] = useState<number | null>(null)
  const moving = useRef<string[]>([])
  const isOff = useRef(false)
  const onOver = useRef((e: DragEvent) => {
    const r = box.current?.getBoundingClientRect()
    const d = OFF_PX[axis]
    // A row of items is left by going above or below it; a column, by going to either side.
    const now = !!r && (axis === 'x' ? e.clientY < r.top - d || e.clientY > r.bottom + d : e.clientX < r.left - d || e.clientX > r.right + d)
    if (now !== isOff.current) {
      isOff.current = now
      setOff(now ? moving.current.length : null)
    }
  })
  const moveProps = (t: MusicTrack) => {
    const block = picked.has(t.id) && picked.size > 1 ? shown.filter(x => picked.has(x.id)) : [t]
    const cp = carryProps(block, block.length > 1 ? `${block.length} tracks` : t.title, 'set')
    return {
      ...cp,
      onDragStart: (e: React.DragEvent) => {
        cp.onDragStart(e)
        moving.current = block.map(x => x.id)
        document.addEventListener('dragover', onOver.current)
      },
      onDragEnd: () => {
        cp.onDragEnd()
        document.removeEventListener('dragover', onOver.current)
        if (isOff.current) {
          remove(moving.current)
          clearSelection()
        }
        isOff.current = false
        setOff(null)
      },
    }
  }
  return { off, moveProps }
}
