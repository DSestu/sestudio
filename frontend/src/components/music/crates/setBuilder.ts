import type { Plan } from '../timeline/sampling'

// The pure parts of the set builder (SPEC-music §11, PR 21): key compatibility,
// auto-ordering, the "Fill from library" ranking and the planned transitions.

/** What ordering and filling need to know about a track. */
export interface SetTrack {
  id: string
  bpm?: number
  /** "F minor". */
  key?: string
  /** Camelot key, "8A". */
  camelot?: string
  /** Mean energy, 0..1. */
  energy?: number
  genre?: string
  /** Energy per bar, whole percents, for the set curve. */
  curve?: number[]
  duration: number
}

/** The genres the tag menu offers (the detector's own names). */
export const GENRES = ['Drum & Bass', 'Neurofunk', 'Liquid Drum & Bass', 'Dubstep', 'Trance', 'Techno', 'House', 'Hip-hop', 'Ambient', 'Electronic']

const parseKey = (k?: string) => {
  const m = /^(\d{1,2})([AB])$/.exec(k ?? '')
  return m ? { n: Number(m[1]), l: m[2] } : null
}

/** Steps on the Camelot wheel; a letter change at the same number is one step. Infinity when a key is unknown. */
export function keyDistance(a?: string, b?: string): number {
  const x = parseKey(a)
  const y = parseKey(b)
  if (!x || !y) return Infinity
  const d = Math.abs(x.n - y.n)
  return Math.min(d, 12 - d) + (x.l === y.l ? 0 : 1)
}

/** Same number, one step round the wheel, or A to B on the same number. */
export const harmonic = (a?: string, b?: string) => keyDistance(a, b) <= 1

export type OrderMode = 'tempo' | 'harmonic' | 'energy'

const bpmGap = (a: SetTrack, b: SetTrack) => (a.bpm && b.bpm ? Math.abs(a.bpm - b.bpm) : 20)

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
  // Harmonic: from the slowest track, always on to the nearest key (then the nearest tempo).
  const left = tracks.filter(t => t.bpm).sort((a, b) => a.bpm! - b.bpm!).concat(tracks.filter(t => !t.bpm))
  const out = left.splice(0, 1)
  while (left.length) {
    const from = out[out.length - 1]
    let best = 0
    let bestCost = Infinity
    left.forEach((t, i) => {
      const k = keyDistance(from.camelot, t.camelot)
      const cost = (Number.isFinite(k) ? k : 6) * 100 + bpmGap(from, t)
      if (cost < bestCost) { bestCost = cost; best = i }
    })
    out.push(...left.splice(best, 1))
  }
  return out.map(t => t.id)
}

export interface FillQuery {
  /** Empty means any genre. */
  genres: string[]
  bpmMin?: number
  bpmMax?: number
  /** Wanted length in seconds. */
  length: number
  /** The track the new ones would follow, to rank by how well they continue it. */
  after?: SetTrack
}

/** Library tracks fitting the query, best fit first, until their durations reach the wanted length. */
export function rankFill(pool: SetTrack[], q: FillQuery, inSet: ReadonlySet<string>): SetTrack[] {
  const want = new Set(q.genres.map(g => g.toLowerCase()))
  const mid = q.bpmMin !== undefined && q.bpmMax !== undefined ? (q.bpmMin + q.bpmMax) / 2 : undefined
  const fit = (t: SetTrack) => {
    const bpm = q.after?.bpm ?? mid
    const k = keyDistance(q.after?.camelot, t.camelot)
    return (bpm && t.bpm ? Math.abs(bpm - t.bpm) : 15) + (Number.isFinite(k) ? k * 3 : 9)
  }
  const ranked = pool
    .filter(t => !inSet.has(t.id) && t.bpm)
    .filter(t => !want.size || want.has((t.genre ?? '').toLowerCase()))
    .filter(t => (q.bpmMin === undefined || t.bpm! >= q.bpmMin) && (q.bpmMax === undefined || t.bpm! <= q.bpmMax))
    .map(t => [fit(t), t] as const)
    .sort((a, b) => a[0] - b[0])
  const out: SetTrack[] = []
  let total = 0
  for (const [, t] of ranked) {
    if (total >= q.length) break
    out.push(t)
    total += t.duration
  }
  return out
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
  if (a.camelot && b.camelot) {
    const ok = harmonic(a.camelot, b.camelot)
    chips.push({ text: `${a.camelot} → ${b.camelot} · ${ok ? 'harmonic' : 'key clash'}`, tone: ok ? 'ok' : 'warn' })
  }
  return chips
}
