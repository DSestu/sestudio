import type { Lean, Setting } from '../../../blend'
import type { Flow, GenreBlock, LeanBlock, Layers } from '../../../musicFlows'
import { firstPath } from '../../../musicFlows'

// The lanes editor's model (docs/proto/flows/lanes.html, SPEC-blend PR 4): three lanes of bricks over
// minutes, each lane Must / Prefer / Ignore, plus tempo's setting. A flow it saves is one chunk; its
// layers are read back into the same bricks.

export type LaneKind = 'energy' | 'genre' | 'colour'
export interface Brick { v: string; len: number }
/** The layers a lane setting governs: the Harmony lane is the key's colour and the key joins together. */
export type SettingKind = 'energy' | 'tempo' | 'genre' | 'colour'
export type Lanes = Record<LaneKind, Brick[]> & {
  settings: Record<SettingKind, Setting>
  /** What the first track is near, kept as the flow had it (Right now sets it; the lanes do not draw it). */
  start?: Layers['start']
}
export const KINDS: LaneKind[] = ['energy', 'genre', 'colour']
export const SETTING_KINDS: SettingKind[] = ['energy', 'tempo', 'genre', 'colour']

/** Energy bricks: which way each pick leans from the one before. */
export const LEANS: Record<string, Lean> = { Lift: 'lift', Hold: 'hold', Ease: 'ease' }
const LEAN_NAME: Record<Lean, string> = { lift: 'Lift', hold: 'Hold', ease: 'Ease' }
/** An old curve stretch rising more than this (0..1) reads as Lift, falling more as Ease (flows.SLOPE). */
const SLOPE = 0.1
const DEFAULT_SETTINGS: Record<SettingKind, Setting> = { energy: 'prefer', tempo: 'prefer', genre: 'prefer', colour: 'prefer' }
export const COLOURS = ['Any', 'bright', 'warm', 'dark', 'exotic']
/** Each key colour's swatch (the editor's Harmony lane, and the playlist's). */
export const CCOL: Record<string, string> = { Any: 'oklch(62% .02 240)', bright: 'oklch(87% .11 95)', warm: 'oklch(77% .11 55)', dark: 'oklch(64% .11 275)', exotic: 'oklch(71% .12 320)' }
export const ANY = 'Any'
export const STEP = 5

export const total = (l: Lanes) => l.energy.reduce((s, b) => s + b.len, 0)
export const starts = (bs: Brick[]) => bs.reduce<number[]>((a, _, i) => (a.push(i ? a[i - 1] + bs[i - 1].len : 0), a), [])
const snap = (m: number) => Math.max(STEP, Math.round(m / STEP) * STEP)
const copy = (l: Lanes): Lanes => ({ ...l, energy: l.energy.map(b => ({ ...b })), genre: l.genre.map(b => ({ ...b })), colour: l.colour.map(b => ({ ...b })), settings: { ...l.settings } })

/** A new flow's lanes: an hour that lifts, holds and eases, any genre, any colour, every lane Prefer. */
export const fresh = (): Lanes => ({
  energy: [{ v: 'Lift', len: 20 }, { v: 'Hold', len: 30 }, { v: 'Ease', len: 10 }],
  genre: [{ v: ANY, len: 60 }],
  colour: [{ v: ANY, len: 60 }],
  settings: { ...DEFAULT_SETTINGS },
})

/** Genres a genre brick plays, from its value ("Drum & Bass", or several joined by "|"). */
export const genresOf = (v: string) => (v === ANY ? [] : v.split('|'))
export const genreLabel = (v: string) => { const g = genresOf(v); return g.length > 1 ? `${g[0]} +${g.length - 1}` : g[0] ?? ANY }

// --- lanes → flow --------------------------------------------------------------------

/**
 * One chunk whose layers carry the three lanes and their settings; the length is the lanes' minutes.
 * `harmony: []` asks every join to match its neighbour's key; the Harmony lane's setting governs both
 * the key's colour and those joins.
 */
export function toFlow(l: Lanes): Pick<Flow, 'chunks' | 'length'> {
  const T = total(l) || 1
  const energy: LeanBlock[] = starts(l.energy).map((s, i) => ({ from: s / T, to: (s + l.energy[i].len) / T, lean: LEANS[l.energy[i].v] ?? 'hold' }))
  const strict = l.settings.genre === 'must' ? 'must' as const : 'prefer' as const
  const blocks = (k: 'genre' | 'colour') => starts(l[k]).flatMap((s, i) => {
    const b = l[k][i]
    if (b.v === ANY) return []
    const span = { from: s / T, to: (s + b.len) / T }
    return [k === 'genre' ? { ...span, genres: genresOf(b.v), strict } : { ...span, colour: b.v }]
  })
  const settings = { ...l.settings, harmony: l.settings.colour }
  const layers = { energy, genre: blocks('genre') as GenreBlock[], colour: blocks('colour'), harmony: [], settings, ...(l.start ? { start: l.start } : {}) }
  return {
    chunks: [{ id: 'all', share: 1, next: [], layers: layers as never }],
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
  if (!out.length) return [{ v: merge ? ANY : 'Hold', len: T }]
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
  const leans: { from: number; to: number; v: string }[] = []
  const genre: { from: number; to: number; v: string }[] = []
  const colour: { from: number; to: number; v: string }[] = []
  let at = 0
  for (const c of path) {
    const w = c.share / shares
    const L = c.layers as Record<string, unknown> & typeof c.layers
    for (const b of leansOf(L)) leans.push({ from: at + b.from * w, to: at + b.to * w, v: LEAN_NAME[b.lean] })
    for (const g of L.genre ?? []) if (g.genres?.length) genre.push({ from: at + g.from * w, to: at + g.to * w, v: g.genres.join('|') })
    for (const k of (L.colour as { from: number; to: number; colour: string }[] | undefined) ?? []) colour.push({ from: at + k.from * w, to: at + k.to * w, v: k.colour })
    at += w
  }
  const eb: Brick[] = leans.filter(b => b.to - b.from > 1e-6).map(b => ({ v: b.v, len: (b.to - b.from) * T }))
  const first = path[0]?.layers ?? {}
  const lossy = path.length > 1 || flow.chunks.length > 1 || path.some(c => c.layers.harmony?.length)
  return {
    lanes: { energy: fitTo(eb, T, false), genre: blockBricks(genre, T), colour: blockBricks(colour, T), settings: settingsOf(first), start: startOf(first) },
    lossy,
  }
}

/** A chunk's leans; an older curve read as the server reads it (each stretch by its slope, neighbours merged). */
export function leansOf(L: Layers): LeanBlock[] {
  const e = L.energy
  if (!e?.length) return []
  if (!Array.isArray(e[0])) return e as LeanBlock[]
  const out: LeanBlock[] = []
  const pts = e as [number, number][]
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    if (x1 <= x0) continue
    const lean: Lean = y1 - y0 > SLOPE ? 'lift' : y0 - y1 > SLOPE ? 'ease' : 'hold'
    const last = out[out.length - 1]
    if (last && last.lean === lean) last.to = x1
    else out.push({ from: x0, to: x1, lean })
  }
  return out
}

/** The lane settings a chunk carries, with the server's defaults for older flows (flows.upgrade). */
function settingsOf(L: Layers): Record<SettingKind, Setting> {
  const s = L.settings ?? {}
  const colourBlocks = ((L as { colour?: unknown[] }).colour ?? []).length > 0
  const g = (L.genre ?? []).find(b => b.genres?.length)
  return {
    energy: s.energy ?? 'prefer',
    tempo: s.tempo ?? 'prefer',
    genre: s.genre ?? (g ? g.strict ?? 'must' : 'prefer'),
    colour: s.colour ?? (colourBlocks ? 'must' : 'prefer'),
  }
}

function startOf(L: Layers): Layers['start'] {
  const st = { ...(L.start ?? {}) }
  const e = L.energy
  if (st.energy === undefined && e?.length && Array.isArray(e[0])) st.energy = (e as [number, number][])[0][1]
  if (st.tempo === undefined && L.tempo?.length) st.tempo = L.tempo[0][1]
  return Object.keys(st).length ? st : undefined
}

// --- edits (each returns new lanes) ---------------------------------------------------------

export function setValue(l: Lanes, k: LaneKind, i: number, v: string): Lanes {
  const n = copy(l); n[k][i].v = v; return n
}

export function setSetting(l: Lanes, k: SettingKind, v: Setting): Lanes {
  const n = copy(l); n.settings[k] = v; return n
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
