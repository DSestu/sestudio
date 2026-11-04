// The timeline's joins as drop targets (SPEC-music-player §5.5): where each track
// after the playing one starts on screen, written by the timeline every frame and
// read by the row drag. `at` is the queue index a drop there inserts at.

export interface Join {
  at: number
  x: number
}

export const joins = {
  list: [] as Join[],
  /** The vertical band a drop counts in (client px). */
  band: [0, 0] as [number, number],
  /** The queue index a library row is held over, shown as a slot on the timeline. */
  slot: null as number | null,
  /** A library row is being dragged: the timeline shows its joins. */
  dragging: false,
}

/** The join a drop at (x, y) lands on: the nearest within 90 px, inside the band. */
export function joinNear(list: Join[], band: [number, number], x: number, y: number): Join | null {
  if (y < band[0] || y > band[1]) return null
  let best: Join | null = null
  let d = 90
  for (const j of list) {
    const dj = Math.abs(j.x - x)
    if (dj < d) { d = dj; best = j }
  }
  return best
}
