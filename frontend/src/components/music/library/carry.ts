import type { MusicTrack } from '../../../musicLibrary'
import { getFocus } from '../edit/focus'

// What an HTML drag carries into the set (SPEC-music-library §2.2 Drag): a whole group from
// the explorer or the tape, or one track (the editor's `dragProps`, read from its focus store).
// A move inside the lane carries `from`.

export interface Carried { tracks: MusicTrack[]; label: string; from?: 'set' }

let carried: Carried | null = null

export const carryProps = (tracks: MusicTrack[], label: string, from?: 'set') => ({
  draggable: true,
  onDragStart: (e: React.DragEvent) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = from ? 'move' : 'copy'
    e.dataTransfer.setData('text/plain', label)
    carried = { tracks, label, from }
  },
  onDragEnd: () => { carried = null },
})

/** What the drag in progress carries, if it is music. */
export function carriedNow(): Carried | null {
  if (carried) return carried
  const d = getFocus().drag
  return d ? { tracks: [d.track], label: d.track.title } : null
}

export const endCarry = () => { carried = null }
