import type { MusicTrack } from '../../../musicLibrary'

// Where every track and group header sits on the tape (SPEC-music-library §2.4): width by
// duration at `zoom` px/s, never narrower than `minW`, a gap between groups; when the tracks
// do not fill the viewport the zoom is solved so they end at the right margin.

export const ZOOM = 0.2
export const MIN_W = 32
export const TRACK_H = 95
export const GAP = 26
export const MARGIN = 24
/** Space taken by a join diamond between two tracks in Best blend. */
export const JOIN_W = 6

export interface TapeGroup {
  key: string
  /** The level name, large and dim (an album's artist, a folder's library); '' for a one-level grouping. */
  head: string
  name: string
  tracks: MusicTrack[]
}

export interface Laid {
  t: MusicTrack
  x: number
  w: number
  group: string
}

export interface Head {
  key: string
  x: number
  /** The width the header may use: its group's tracks plus a little. */
  maxW: number
  head: string
  name: string
  tracks: MusicTrack[]
}

export interface Layout {
  items: Laid[]
  heads: Head[]
  /** The x after the last track (before the trailing margin). */
  end: number
  zoom: number
}

const widthOf = (t: MusicTrack, zoom: number, minW: number) => Math.max(minW, t.duration * zoom)

/** Lay out the groups at `zoom`. `joins` leaves room for a diamond between tracks (one flat group). */
export function layoutTape(groups: TapeGroup[], zoom = ZOOM, minW = MIN_W, gap = GAP, joins = false): Layout {
  const items: Laid[] = []
  const heads: Head[] = []
  let x = MARGIN
  for (const g of groups) {
    heads.push({ key: g.key, x, maxW: Math.max(60, g.tracks.reduce((a, t) => a + widthOf(t, zoom, minW), 0) + 10), head: g.head, name: g.name, tracks: g.tracks })
    g.tracks.forEach((t, i) => {
      const w = widthOf(t, zoom, minW)
      items.push({ t, x, w, group: g.key })
      x += w + (joins && i < g.tracks.length - 1 ? JOIN_W : 0)
    })
    x += gap
  }
  return { items, heads, end: groups.length ? x - gap : x, zoom }
}

/**
 * The zoom at which the tracks fill `target` px exactly (bisection on duration → px; the
 * minimum width makes it non-linear). Returns `zoom` itself when they already overflow.
 */
export function solveZoom(groups: TapeGroup[], target: number, zoom = ZOOM, minW = MIN_W, gap = GAP, joins = false): number {
  const at = (k: number) => layoutTape(groups, k, minW, gap, joins).end
  if (at(zoom) >= target - 1) return zoom
  let lo = zoom
  let hi = zoom * 2
  while (at(hi) < target && hi < zoom * 1e4) hi *= 2
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (at(mid) > target) hi = mid
    else lo = mid
  }
  return lo
}

/** The layout that fills `viewport` when it can, else the natural one. */
export function fitTape(groups: TapeGroup[], viewport: number, joins = false): Layout {
  const target = viewport - MARGIN
  return layoutTape(groups, solveZoom(groups, target, ZOOM, MIN_W, GAP, joins), MIN_W, GAP, joins)
}

/** Best blend's energy shapes, as the server names them. */
export const SHAPES = ['Hold', 'Lift', 'Ease', 'Arc'] as const
export type Shape = (typeof SHAPES)[number]

const HEAD_H = 70
const LABEL_H = 18
/** The tape's full height: header band, sigils, labels. */
export const TAPE_H = HEAD_H + 12 + TRACK_H + LABEL_H + 12
export { HEAD_H, LABEL_H }

/** A join diamond's colour on the tape, the lane and the list. */
export const MARK_COLOR: Record<'smooth' | 'close' | 'rough', string> = {
  smooth: 'oklch(78% .17 150)',
  close: 'oklch(82% .16 85)',
  rough: 'oklch(68% .2 25)',
}
