// How well one track follows another (harmony master plan E0.5). The same rules,
// thresholds and move names as src/sestudio/music/proximity.py: keep both in step.

/** One reading of a track's scale (the analysis' `harmony.track`). */
export interface Reading {
  tonic: string
  mode: string
  /** The 7 note names of the scale. */
  notes: string[]
  /** Lydian +3 .. Locrian -3; absent for the exotic modes. */
  brightness?: number | null
}

/** What proximity needs to know about a track. */
export interface ProxTrack {
  id: string
  bpm?: number
  /** Camelot key, "8A": the fallback while a track has no harmony yet. */
  camelot?: string
  genre?: string
  harmony?: { track?: Reading }
  /** Energy on the library's scale, 0..100. */
  energyScale?: { track?: number; intro?: number; outro?: number }
}

export type Kind = 'same-key' | 'pivot' | 'modal-shift' | 'next-door' | 'clash'
export const KINDS: Record<Kind, string> = {
  'same-key': 'Same key',
  pivot: 'Same notes',
  'modal-shift': 'One note changes',
  'next-door': 'Next door',
  clash: 'Clash',
}
/** Shared notes (of 7) from which a join counts as safe. */
export const SAFE_NOTES = 6
/** Largest tempo change inside one genre, as a share of A's tempo. */
export const TEMPO_TOL = 0.06
/** Energy points (0..100) within which an energy step "holds". */
export const ENERGY_HOLD = 8
/** Candidates tried at each step of a path. */
export const BEAM = 30

export interface Join {
  shared: number | null
  kind: Kind | null
  kindLabel: string | null
  safe: boolean
  mood: 'brighter' | 'darker' | 'same' | null
  energy: { step: 'lifts' | 'holds' | 'eases off' | null; delta: number | null }
  genreChange: boolean
  bpmDelta: number | null
  tempoJump: boolean
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

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

const reading = (t: ProxTrack) => {
  const h = t.harmony?.track
  const tonic = h ? NAMES.indexOf(h.tonic) : -1
  return h && tonic >= 0 ? { tonic, mask: h.notes.reduce((m, n) => m | (1 << NAMES.indexOf(n)), 0), brightness: h.brightness ?? null } : null
}

const popcount = (n: number) => { let c = 0; for (; n; n &= n - 1) c++; return c }

const kindOf = (shared: number, sameTonic: boolean): Kind =>
  shared === 7 ? (sameTonic ? 'same-key' : 'pivot') : shared === SAFE_NOTES ? (sameTonic ? 'modal-shift' : 'next-door') : 'clash'

/** Shared notes and move kind from the note sets; Camelot stands in when a track has no harmony yet. */
export function harmonyOf(a: ProxTrack, b: ProxTrack): { shared: number | null; kind: Kind | null } {
  const x = reading(a)
  const y = reading(b)
  if (x && y) {
    const shared = popcount(x.mask & y.mask)
    return { shared, kind: kindOf(shared, x.tonic === y.tonic) }
  }
  const p = parseKey(a.camelot)
  const q = parseKey(b.camelot)
  if (!p || !q) return { shared: null, kind: null }
  const d = Math.min(Math.abs(p.n - q.n), 12 - Math.abs(p.n - q.n))
  if (d === 0) return { shared: 7, kind: p.l === q.l ? 'same-key' : 'pivot' }
  if (d === 1 && p.l === q.l) return { shared: SAFE_NOTES, kind: 'next-door' }
  return { shared: null, kind: 'clash' }
}

const edge = (t: ProxTrack, which: 'intro' | 'outro' | 'track') => t.energyScale?.[which] ?? t.energyScale?.track ?? null

/** Everything worth saying about the move from a to b (unknown facts are null). */
export function join(a: ProxTrack, b: ProxTrack): Join {
  const { shared, kind } = harmonyOf(a, b)
  const ba = reading(a)?.brightness ?? null
  const bb = reading(b)?.brightness ?? null
  const ea = edge(a, 'outro')
  const eb = edge(b, 'intro')
  const delta = ea === null || eb === null ? null : eb - ea
  const ga = (a.genre ?? '').toLowerCase()
  const gb = (b.genre ?? '').toLowerCase()
  return {
    shared,
    kind,
    kindLabel: kind ? KINDS[kind] : null,
    safe: shared !== null && shared >= SAFE_NOTES,
    mood: ba === null || bb === null ? null : bb > ba ? 'brighter' : bb < ba ? 'darker' : 'same',
    energy: { step: delta === null ? null : delta > ENERGY_HOLD ? 'lifts' : delta < -ENERGY_HOLD ? 'eases off' : 'holds', delta },
    genreChange: !!(ga && gb && ga !== gb),
    bpmDelta: a.bpm && b.bpm ? Math.round((b.bpm - a.bpm) * 10) / 10 : null,
    tempoJump: !!(a.bpm && b.bpm && Math.abs(b.bpm - a.bpm) > a.bpm * TEMPO_TOL),
  }
}

/** A tempo jump is only fine across a genre change. */
export const tempoOk = (j: Join) => !j.tempoJump || j.genreChange

/** Lower is a better follow-up: notes first, then the tempo gap and the energy step. */
export const cost = (j: Join) =>
  (j.shared === null ? 4 : 7 - j.shared) * 3 + Math.min(Math.abs(j.bpmDelta ?? 0) / 10, 2) + Math.abs(j.energy.delta ?? 0) / 50

export interface Filters {
  harmony?: 'safe' | 'any'
  tempo?: 'near' | 'any'
  mood?: 'up' | 'down' | 'same'
  energy?: 'lift' | 'hold' | 'ease'
  /** 'any', 'same' or a genre name. */
  genre?: string
}

const MOOD = { up: 'brighter', down: 'darker', same: 'same' } as const
const STEP = { lift: 'lifts', hold: 'holds', ease: 'eases off' } as const

function passes(j: Join, t: ProxTrack, f: Filters) {
  if ((f.harmony ?? 'safe') === 'safe' && !j.safe) return false
  if ((f.tempo ?? 'near') === 'near' && !tempoOk(j)) return false
  if (f.mood && j.mood !== MOOD[f.mood]) return false
  if (f.energy && j.energy.step !== STEP[f.energy]) return false
  const g = (f.genre ?? 'any').toLowerCase()
  return g === 'any' || (g === 'same' && !j.genreChange) || g === (t.genre ?? '').toLowerCase()
}

/** Order by a key list, as Python orders tuples. */
const byKey = <T extends { k: (number | string)[] }>(x: T, y: T) => {
  for (let i = 0; i < x.k.length; i++) if (x.k[i] !== y.k[i]) return x.k[i] < y.k[i] ? -1 : 1
  return 0
}

/** Tracks of the pool that follow `track`, best first, each with its explained join. */
export function fitsAfter(track: ProxTrack, pool: ProxTrack[], filters: Filters = {}, limit = 50, exclude: Iterable<string> = []): { id: string; join: Join }[] {
  const skip = new Set(exclude)
  const out: { k: (number | string)[]; id: string; join: Join }[] = []
  for (const t of pool) {
    if (t.id === track.id || skip.has(t.id)) continue
    const j = join(track, t)
    if (passes(j, t, filters)) out.push({ k: [cost(j), t.id], id: t.id, join: j })
  }
  return out.sort(byKey).slice(0, limit).map(({ id, join: j }) => ({ id, join: j }))
}

/** Single tracks safe both after a and before b, the energy nearest between them first. */
export function bridges(a: ProxTrack, b: ProxTrack, pool: ProxTrack[], limit = 10, exclude: Iterable<string> = []): { id: string; before: Join; after: Join }[] {
  const ea = edge(a, 'outro')
  const eb = edge(b, 'intro')
  const mid = ea !== null && eb !== null ? (ea + eb) / 2 : null
  const skip = new Set([a.id, b.id, ...exclude])
  const out: { k: (number | string)[]; id: string; before: Join; after: Join }[] = []
  for (const t of pool) {
    if (skip.has(t.id)) continue
    const before = join(a, t)
    const after = join(t, b)
    if ([before, after].every(j => j.safe && tempoOk(j))) {
      const e = edge(t, 'track')
      out.push({ k: [mid !== null && e !== null ? Math.abs(e - mid) : 50, cost(before) + cost(after), t.id], id: t.id, before, after })
    }
  }
  return out.sort(byKey).slice(0, limit).map(({ id, before, after }) => ({ id, before, after }))
}

/** The fewest in-between track ids (at most `steps`) leading safely from a to b; [] when already safe, null when no path. */
export function bridgePath(a: ProxTrack, b: ProxTrack, pool: ProxTrack[], steps = 3, exclude: Iterable<string> = []): string[] | null {
  const skip = new Set([a.id, b.id, ...exclude])
  const rest = pool.filter(t => !skip.has(t.id))
  const ok = (x: ProxTrack, y: ProxTrack) => {
    const j = join(x, y)
    return j.safe && tempoOk(j)
  }
  const walk = (cur: ProxTrack, left: number, seen: string[]): string[] | null => {
    if (left === 0) return ok(cur, b) ? [] : null
    const near = rest
      .filter(t => !seen.includes(t.id) && ok(cur, t))
      .map(t => ({ k: [-(join(t, b).shared ?? 0), cost(join(cur, t)), t.id], t }))
      .sort(byKey)
    for (const { t } of near.slice(0, BEAM)) {
      const tail = walk(t, left - 1, [...seen, t.id])
      if (tail) return [t.id, ...tail]
    }
    return null
  }
  for (let k = 0; k <= steps; k++) {
    const p = walk(a, k, [])
    if (p) return p
  }
  return null
}
