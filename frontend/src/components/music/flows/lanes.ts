import type { Flow, GenreBlock } from '../../../musicFlows'
import { firstPath } from '../../../musicFlows'

// The lanes editor's model (docs/proto/flows/lanes.html): three lanes of bricks over minutes.
// A flow it saves is one chunk; its layers are read back into the same bricks.

export type LaneKind = 'energy' | 'genre' | 'colour'
export interface Brick { v: string; len: number }
export type Lanes = Record<LaneKind, Brick[]>
export const KINDS: LaneKind[] = ['energy', 'genre', 'colour']

/** Energy bricks: start and end on the library's scale (0..1). */
export const ENERGY: Record<string, [number, number]> = {
  Calm: [0.1, 0.1], Low: [0.3, 0.3], Mid: [0.5, 0.5], High: [0.7, 0.7], Peak: [0.9, 0.9], Build: [0.3, 0.9], Ease: [0.9, 0.3],
}
export const COLOURS = ['Any', 'bright', 'warm', 'dark', 'exotic']
/** Each key colour's swatch (the editor's Harmony lane, and the playlist's). */
export const CCOL: Record<string, string> = { Any: 'oklch(62% .02 240)', bright: 'oklch(87% .11 95)', warm: 'oklch(77% .11 55)', dark: 'oklch(64% .11 275)', exotic: 'oklch(71% .12 320)' }
export const ANY = 'Any'
export const STEP = 5
const FLAT = ['Calm', 'Low', 'Mid', 'High', 'Peak']

export const total = (l: Lanes) => l.energy.reduce((s, b) => s + b.len, 0)
export const starts = (bs: Brick[]) => bs.reduce<number[]>((a, _, i) => (a.push(i ? a[i - 1] + bs[i - 1].len : 0), a), [])
const snap = (m: number) => Math.max(STEP, Math.round(m / STEP) * STEP)
const copy = (l: Lanes): Lanes => ({ energy: l.energy.map(b => ({ ...b })), genre: l.genre.map(b => ({ ...b })), colour: l.colour.map(b => ({ ...b })) })

/** A new flow's lanes: a one-hour rise, plateau and fall, any genre, any colour. */
export const fresh = (): Lanes => ({
  energy: [{ v: 'Build', len: 20 }, { v: 'High', len: 30 }, { v: 'Ease', len: 10 }],
  genre: [{ v: ANY, len: 60 }],
  colour: [{ v: ANY, len: 60 }],
})

/** Genres a genre brick plays, from its value ("Drum & Bass", or several joined by "|"). */
export const genresOf = (v: string) => (v === ANY ? [] : v.split('|'))
export const genreLabel = (v: string) => { const g = genresOf(v); return g.length > 1 ? `${g[0]} +${g.length - 1}` : g[0] ?? ANY }

function energyName(a: number, b: number): string {
  if (Math.abs(a - b) < 0.15) return FLAT[Math.max(0, Math.min(4, Math.round((a + b) / 2 * 5 - 0.5)))]
  return a < b ? 'Build' : 'Ease'
}

// --- lanes → flow --------------------------------------------------------------------

/**
 * One chunk whose layers carry the three lanes; the length is the lanes' minutes. `harmony: []` asks
 * every join to match its neighbour's key: without the key the generator treats joins as free.
 */
export function toFlow(l: Lanes): Pick<Flow, 'chunks' | 'length'> {
  const T = total(l) || 1
  const energy: [number, number][] = []
  starts(l.energy).forEach((s, i) => {
    const [a, b] = ENERGY[l.energy[i].v] ?? ENERGY.Mid
    energy.push([s / T, a], [(s + l.energy[i].len) / T, b])
  })
  const blocks = (k: 'genre' | 'colour') => starts(l[k]).flatMap((s, i) => {
    const b = l[k][i]
    if (b.v === ANY) return []
    const span = { from: s / T, to: (s + b.len) / T }
    return [k === 'genre' ? { ...span, genres: genresOf(b.v), strict: 'must' as const } : { ...span, colour: b.v }]
  })
  return {
    chunks: [{ id: 'all', share: 1, next: [], layers: { energy, genre: blocks('genre') as GenreBlock[], colour: blocks('colour'), harmony: [] } as never }],
    length: String(T) as Flow['length'],
  }
}

// --- flow → lanes ----------------------------------------------------------------------

const NAMED: Record<string, number> = { '30': 30, '60': 60, '120': 120 }

/** The minutes a flow plays: its own minutes, a named length, else an hour. */
export const minutesOf = (f: Pick<Flow, 'length'>) => NAMED[f.length] ?? (/^\d+$/.test(f.length) ? Number(f.length) : 60)

/** Fit bricks to *T* minutes: snapped lengths, merged neighbours, the last takes the rounding. */
function fitTo(bs: Brick[], T: number, merge: boolean): Brick[] {
  const out: Brick[] = []
  for (const b of bs) {
    const len = snap(b.len)
    const last = out[out.length - 1]
    if (merge && last && last.v === b.v) last.len += len
    else out.push({ v: b.v, len })
  }
  if (!out.length) return [{ v: merge ? ANY : 'Mid', len: T }]
  while (out.length > 1 && out.slice(0, -1).reduce((s, b) => s + b.len, 0) >= T) out.pop()
  out[out.length - 1].len = T - out.slice(0, -1).reduce((s, b) => s + b.len, 0)
  return out
}

/** Blocks on the 0..1 axis as bricks, the gaps as Any. */
function blockBricks(blocks: { from: number; to: number; v: string }[], T: number): Brick[] {
  const out: Brick[] = []
  let at = 0
  for (const b of [...blocks].sort((x, y) => x.from - y.from)) {
    if (b.from > at + 1e-6) out.push({ v: ANY, len: (b.from - at) * T })
    out.push({ v: b.v, len: (b.to - Math.max(at, b.from)) * T })
    at = Math.max(at, b.to)
  }
  if (at < 1 - 1e-6) out.push({ v: ANY, len: (1 - at) * T })
  return fitTo(out.filter(b => b.len > 0), T, true)
}

/**
 * The lanes of a saved flow. A lanes flow reads back exactly; any other flow along its first
 * path, as near as bricks allow (tempo, harmony events and forks have no lane).
 */
export function fromFlow(flow: Pick<Flow, 'chunks' | 'length'>): { lanes: Lanes; lossy: boolean } {
  const T = snap(minutesOf(flow))
  const path = firstPath(flow)
  const shares = path.reduce((s, c) => s + c.share, 0) || 1
  const energy: [number, number][] = []
  const genre: { from: number; to: number; v: string }[] = []
  const colour: { from: number; to: number; v: string }[] = []
  let at = 0
  for (const c of path) {
    const w = c.share / shares
    const L = c.layers as Record<string, unknown> & typeof c.layers
    for (const [f, v] of L.energy ?? []) energy.push([at + f * w, v])
    for (const g of L.genre ?? []) if (g.genres?.length) genre.push({ from: at + g.from * w, to: at + g.to * w, v: g.genres.join('|') })
    for (const k of (L.colour as { from: number; to: number; colour: string }[] | undefined) ?? []) colour.push({ from: at + k.from * w, to: at + k.to * w, v: k.colour })
    at += w
  }
  const eb: Brick[] = []
  for (let i = 1; i < energy.length; i++) {
    const [x0, y0] = energy[i - 1], [x1, y1] = energy[i]
    if (x1 - x0 > 1e-6) eb.push({ v: energyName(y0, y1), len: (x1 - x0) * T })
  }
  const lossy = path.length > 1 || flow.chunks.length > 1 || path.some(c => c.layers.tempo?.length || c.layers.harmony?.length)
  return {
    lanes: { energy: fitTo(eb, T, false), genre: blockBricks(genre, T), colour: blockBricks(colour, T) },
    lossy,
  }
}

// --- edits (each returns new lanes) ---------------------------------------------------------

export function setValue(l: Lanes, k: LaneKind, i: number, v: string): Lanes {
  const n = copy(l); n[k][i].v = v; return n
}

/** A 15-minute brick at *i*; the flow grows, so the other lanes' last bricks stretch. */
export function addBrick(l: Lanes, k: LaneKind, i: number, v?: string): Lanes {
  const n = copy(l)
  n[k].splice(i, 0, { v: v ?? n[k][Math.max(0, i - 1)].v, len: 15 })
  for (const o of KINDS) if (o !== k) n[o][n[o].length - 1].len += 15
  return n
}

export function split(l: Lanes, k: LaneKind, i: number): Lanes {
  const b = l[k][i]
  if (b.len < 2 * STEP) return l
  const n = copy(l), a = snap(b.len / 2)
  n[k].splice(i, 1, { ...b, len: a }, { ...b, len: b.len - a })
  return n
}

/** Remove a brick; its neighbour takes its minutes, so the flow keeps its length. */
export function remove(l: Lanes, k: LaneKind, i: number): Lanes {
  if (l[k].length < 2) return l
  const n = copy(l)
  const [b] = n[k].splice(i, 1)
  n[k][Math.max(0, i - 1)].len += b.len
  return n
}

export function swap(l: Lanes, k: LaneKind, i: number, j: number): Lanes {
  const n = copy(l);
  [n[k][i].v, n[k][j].v] = [n[k][j].v, n[k][i].v]
  return n
}

/**
 * Pull the right edge of brick *i* by *dm* minutes from where the drag began (*from*: that moment's lanes).
 * Inside a lane it moves the border with the next brick; the last edge stretches the whole flow.
 */
export function pullEdge(from: Lanes, k: LaneKind, i: number, dm: number): Lanes {
  const n = copy(from), L = n[k]
  if (i < L.length - 1) {
    const pair = L[i].len + L[i + 1].len
    const len = Math.min(pair - STEP, snap(L[i].len + dm))
    L[i].len = len; L[i + 1].len = pair - len
    return n
  }
  const d = Math.max(...KINDS.map(o => STEP - n[o][n[o].length - 1].len), Math.round(dm / STEP) * STEP)
  for (const o of KINDS) n[o][n[o].length - 1].len += d
  return n
}

// --- stretches: where any lane changes ----------------------------------------------------

export interface Stretch { s: number; e: number; energy: string; genre: string; colour: string }

export function stretches(l: Lanes): Stretch[] {
  const T = total(l)
  const cuts = [...new Set(KINDS.flatMap(k => starts(l[k])))].filter(x => x < T).sort((a, b) => a - b)
  return cuts.map((s, i) => {
    const e = cuts[i + 1] ?? T, mid = (s + e) / 2
    const at = (k: LaneKind) => { const st = starts(l[k]); let j = st.length - 1; while (j > 0 && st[j] > mid) j--; return l[k][j].v }
    return { s, e, energy: at('energy'), genre: at('genre'), colour: at('colour') }
  })
}
