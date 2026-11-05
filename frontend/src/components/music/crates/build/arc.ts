import { GENRES } from '../setBuilder'
import type { Arc } from '../harmonyApi'

type Segments = Arc['genre']

/** Closest a genre change may get to its neighbours or the ends (share of the set). */
export const MIN_BLOCK = 0.05
export const MIN_POINTS = 2
export const MAX_POINTS = 12

/** The same line with `n` evenly spaced points. */
export function resample(points: number[], n: number): number[] {
  if (points.length === n) return points
  return Array.from({ length: n }, (_, i) => {
    const p = (i / (n - 1)) * (points.length - 1)
    const lo = Math.floor(p)
    const hi = Math.min(points.length - 1, lo + 1)
    return points[lo] + (points[hi] - points[lo]) * (p - lo)
  })
}

/** Move the change between block `k` and `k + 1` to `x`, never past its neighbours. */
export function moveChange(segs: Segments, k: number, x: number): Segments {
  const lo = (k ? segs[k - 1].x1 : 0) + MIN_BLOCK
  const hi = segs[k + 1].x1 - MIN_BLOCK
  return segs.map((s, i) => (i === k ? { ...s, x1: Math.max(lo, Math.min(hi, x)) } : s))
}

/** Split the widest block in two; the new right half gets the next genre in the list. */
export function addChange(segs: Segments): Segments {
  const start = (i: number) => (i ? segs[i - 1].x1 : 0)
  const k = segs.reduce((best, s, i) => (s.x1 - start(i) > segs[best].x1 - start(best) ? i : best), 0)
  const mid = (start(k) + segs[k].x1) / 2
  const next = GENRES[(GENRES.indexOf(segs[k].g) + 1) % GENRES.length]
  return [...segs.slice(0, k), { g: segs[k].g, x1: mid }, { g: next, x1: segs[k].x1 }, ...segs.slice(k + 1)]
}

/** Drop block `k`: its neighbour grows over it (the last block's takes it from the one before). */
export function removeBlock(segs: Segments, k: number): Segments {
  if (segs.length < 2) return segs
  if (k === segs.length - 1) return [...segs.slice(0, k - 1), { ...segs[k - 1], x1: 1 }]
  return segs.filter((_, i) => i !== k)
}

export const setBlockGenre = (segs: Segments, k: number, g: string): Segments => segs.map((s, i) => (i === k ? { ...s, g } : s))
