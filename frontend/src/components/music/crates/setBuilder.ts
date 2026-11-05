import type { Plan } from '../timeline/sampling'
import { cost as joinCost, join, keyDistance, type Join, type ProxTrack } from './proximity'

export { keyDistance }

// The pure parts of the set builder (SPEC-music §11, PR 21): key compatibility,
// auto-ordering, the "Fill from library" ranking and the planned transitions.

/** What ordering and filling need to know about a track. */
export interface SetTrack extends ProxTrack {
  bpm?: number
  /** "F minor". */
  key?: string
  /** Mean energy, 0..1. */
  energy?: number
  /** Energy per bar, whole percents, for the set curve. */
  curve?: number[]
  duration: number
}

/** The genres the tag menu offers (the detector's own names). */
export const GENRES = ['Drum & Bass', 'Neurofunk', 'Liquid Drum & Bass', 'Dubstep', 'Trance', 'Techno', 'House', 'Hip-hop', 'Ambient', 'Electronic']

/** Same number, one step round the wheel, or A to B on the same number. */
export const harmonic = (a?: string, b?: string) => keyDistance(a, b) <= 1

export type OrderMode = 'tempo' | 'harmonic' | 'energy'

/** The ids in the order a mode wants them; stable, and tracks without the needed fact keep their place at the end. */
export function autoOrder(tracks: SetTrack[], mode: OrderMode): string[] {
  if (mode === 'tempo') {
    const known = tracks.filter(t => t.bpm).sort((a, b) => a.bpm! - b.bpm!)
    return [...known, ...tracks.filter(t => !t.bpm)].map(t => t.id)
  }
  if (mode === 'energy') {
    const mean = tracks.reduce((s, t) => s + (t.energy ?? 0), 0) / (tracks.length || 1)
    const sorted = [...tracks].sort((a, b) => (a.energy ?? mean) - (b.energy ?? mean))
    // Alternate up the sorted list: the loudest lands in the middle, a rise then a fall.
    return [...sorted.filter((_, i) => i % 2 === 0), ...sorted.filter((_, i) => i % 2 === 1).reverse()].map(t => t.id)
  }
  // Harmonic path: keep the first track, then always on to the best next join (shared notes, then tempo and energy).
  const left = tracks.slice(1)
  const out = tracks.slice(0, 1)
  while (left.length) {
    const from = out[out.length - 1]
    let best = 0
    let bestCost = Infinity
    left.forEach((t, i) => {
      const c = joinCost(join(from, t))
      if (c < bestCost) { bestCost = c; best = i }
    })
    out.push(...left.splice(best, 1))
  }
  return out.map(t => t.id)
}

export interface Chip {
  text: string
  tone: 'ok' | 'warn'
}

/** The planned handover between two rows, as the chips drawn between them. */
export function transitionChips(p: Plan, a: SetTrack, b: SetTrack, hint?: string): Chip[] {
  const chips: Chip[] = []
  if (p.mode === 'sync') chips.push({ text: `${p.bars ?? 8} bars · synced`, tone: 'ok' })
  else if (p.why === 'tempo') chips.push({ text: `fade ${p.len} s · ${Math.round(a.bpm!)} → ${Math.round(b.bpm!)} is too far to sync${hint ? `. ${hint}` : ''}`, tone: 'warn' })
  else if (p.why === 'short') chips.push({ text: `fade ${p.len} s · track too short to sync`, tone: 'warn' })
  else chips.push({ text: `fade ${p.len} s${!a.bpm || !b.bpm ? ' · tempo not known yet' : ''}`, tone: 'ok' })
  return chips
}

export const isClash = (j: Join) => j.kind === 'clash'

/** A join the mixer chose to keep, as `kept` holds it: item ids, "a>b". */
export const keptKey = (a: { id: string }, b: { id: string }) => `${a.id}>${b.id}`

/** Clashes and tempo jumps over a run of tracks, for the set header; joins in `kept` don't count as clashes. */
export function countJoins(tracks: SetTrack[], kept: ReadonlySet<string> = new Set()): { clashes: number; jumps: number } {
  let clashes = 0
  let jumps = 0
  for (let i = 1; i < tracks.length; i++) {
    const j = join(tracks[i - 1], tracks[i])
    if (isClash(j) && !kept.has(keptKey(tracks[i - 1], tracks[i]))) clashes++
    if (j.tempoJump) jumps++
  }
  return { clashes, jumps }
}

/** Moving the track at `from` so it ends at index `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const out = [...list]
  out.splice(to, 0, ...out.splice(from, 1))
  return out
}

/** A reorder that leaves fewer clashes: the track at `from` goes to `to`. */
export interface Reorder { from: number; to: number; before: number; after: number }

/** For the clash between tracks i and i+1: the best swap with a neighbour and the best move of either to anywhere, when they cut clashes. */
export function bestReorders(tracks: SetTrack[], i: number, kept: ReadonlySet<string> = new Set()): { swap?: Reorder; move?: Reorder } {
  const before = countJoins(tracks, kept).clashes
  const swaps = [[i, i - 1], [i, i + 1], [i + 1, i + 2]].filter(([, to]) => to >= 0 && to < tracks.length)
  const pick = (cands: number[][]): Reorder | undefined => {
    const best = cands
      .map(([from, to]) => ({ from, to, before, after: countJoins(moved(tracks, from, to), kept).clashes }))
      .sort((x, y) => x.after - y.after || Math.abs(x.to - x.from) - Math.abs(y.to - y.from))[0]
    return best && best.after < before ? best : undefined
  }
  const moves = [i, i + 1].flatMap(from => tracks.map((_, to) => [from, to])).filter(([from, to]) => Math.abs(to - from) > 1)
  return { swap: pick(swaps), move: pick(moves) }
}

/** Where the server should put item `id` so it ends at flat index `to`: its part, and its index among that part without it. */
export function placement(groups: { id: string | null; items: string[] }[], id: string, to: number): { part: string | null; index: number } {
  const rest = groups.map(g => ({ id: g.id, items: g.items.filter(x => x !== id) }))
  let seen = 0
  for (const g of rest) {
    if (to <= seen + g.items.length) return { part: g.id, index: to - seen }
    seen += g.items.length
  }
  const last = rest[rest.length - 1]
  return { part: last.id, index: last.items.length }
}
