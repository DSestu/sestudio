import { useEffect, useSyncExternalStore } from 'react'
import { startPlayback } from './components/music/player'
import type { Lean, Layer, Setting } from './blend'
import type { QueueState } from './musicQueue'

// Flows and mixes (docs/SPEC-music-flows.md): the server's documents, the calls
// that play them, and the pure helpers the cards and the path strip draw from.

const BASE = '/api/music'

export type Curve = [number, number][]
export interface HarmonyEvent { at: number; kind: string }
export interface GenreBlock { from: number; to: number; genres: string[]; strict?: 'must' | 'prefer' }
/** A stretch of a chunk leaning up, level or down (SPEC-blend). */
export interface LeanBlock { from: number; to: number; lean: Lean }
export interface Layers {
  /** Older flows only: the server reads it as a start tempo. */
  tempo?: Curve
  /** Leans; older flows have a curve, which the server reads as leans and a start. */
  energy?: Curve | LeanBlock[]
  /** What the first track is near: energy 0..1, tempo in BPM. */
  start?: { energy?: number; tempo?: number }
  settings?: Partial<Record<Layer, Setting>>
  harmony?: HarmonyEvent[]
  genre?: GenreBlock[]
}

const isCurve = (e: Layers['energy']): e is Curve => Array.isArray(e?.[0])
/** How far a lean moves over a whole chunk, on the 0..1 axis: only to draw it. */
const LEAN_RISE = 0.3

/** A chunk's energy as [0..1 position, 0..1 energy] points: a curve as it is, leans drawn from the start. */
export function energyPoints(layers: Layers): Curve {
  const e = layers.energy
  if (!e?.length) return []
  if (isCurve(e)) return e
  let v = layers.start?.energy ?? 0.5
  const out: Curve = [[e[0].from, v]]
  for (const b of e as LeanBlock[]) {
    v = Math.max(0.05, Math.min(0.95, v + (b.lean === 'lift' ? 1 : b.lean === 'ease' ? -1 : 0) * LEAN_RISE * (b.to - b.from)))
    out.push([b.to, v])
  }
  return out
}
/** What a fork may wait for (SPEC §5): skips in the last tracks, minutes into the mix, a clock time. */
export type Condition =
  | { kind: 'skips'; count: number; of: number }
  | { kind: 'session'; minutes: number }
  | { kind: 'time'; after: string }
export interface Chunk { id: string; share: number; next: string[]; layers: Layers; when?: Record<string, Condition> }
export interface Flow {
  id: string
  name: string
  created: number
  chunks: Chunk[]
  pull: 'light' | 'strong' | 'only'
  /** A named length, or the lanes editor's own minutes ("95"). */
  length: '30' | '60' | '120' | 'endless' | `${number}`
  allowOnline: boolean
  preset: boolean
}
export interface Mix {
  id: string
  name: string
  created: number
  flow: string | null
  choices: Record<string, string>
  minutes: number | null
  seed: number
  pins: Record<string, string>
  frozen: string[] | null
}

export const KINDS: Record<string, string> = {
  match: 'Match', relative: 'Relative', up: 'Up a fifth', down: 'Down a fifth',
  'mode+': 'Brighter mode', 'mode-': 'Darker mode', shift: 'Shift', lift: 'Lift', lower: 'Drop', break: 'Break',
}
export const LENGTHS: { id: Flow['length']; label: string }[] = [
  { id: '30', label: '30 min' }, { id: '60', label: '1 h' }, { id: '120', label: '2 h' }, { id: 'endless', label: 'Endless' },
]

// --- the store -----------------------------------------------------------------

let snap: { flows: Flow[]; mixes: Mix[]; loaded: boolean } = { flows: [], mixes: [], loaded: false }
const listeners = new Set<() => void>()

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function refreshFlows() {
  const [flows, mixes] = await Promise.all([json<Flow[]>('/flows'), json<Mix[]>('/mixes')])
  snap = { flows, mixes, loaded: true }
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** The saved flows (presets included) and mixes, loaded on first use. */
export function useFlows() {
  useEffect(() => { if (!snap.loaded) void refreshFlows().catch(() => {}) }, [])
  return useSyncExternalStore(subscribe, () => snap)
}

/** Sources and what happens when they run out (flowSources.ts `scopeBody`). */
export interface ScopeBody { sources?: { kind: string; value: string; rule: string }[]; then?: 'stop' | 'similar' }

export const playFlow = (id: string, body: { choices?: Record<string, string>; minutes?: number; seed?: number } & ScopeBody = {}) =>
  startPlayback(async () => { await json(`/flows/${id}/play`, { method: 'POST', body: JSON.stringify(body) }) })

export const playMix = (id: string) =>
  startPlayback(async () => { await json(`/mixes/${id}/play`, { method: 'POST' }) })

export async function saveFlow(name: string, flow: Partial<Flow>, id?: string): Promise<Flow> {
  const out = id
    ? await json<Flow>(`/flows/${id}`, { method: 'PATCH', body: JSON.stringify({ name, flow }) })
    : await json<Flow>('/flows', { method: 'POST', body: JSON.stringify({ name, flow }) })
  await refreshFlows()
  return out
}

export async function deleteFlow(id: string) {
  await json(`/flows/${id}`, { method: 'DELETE' })
  await refreshFlows()
}

/** One slot of a rendered mix: the track and the join it makes with the one before. */
export interface Slot { track_id: string; join: string | null; chunk: string }

/** What the flow would play now, without playing it. */
export const renderFlow = (id: string, body: { minutes?: number; seed?: number } & ScopeBody = {}) =>
  json<{ mix: Slot[]; minutes: number }>(`/flows/${id}/render`, { method: 'POST', body: JSON.stringify(body) })

export async function reroute(body: { choices?: Record<string, string>; seed?: number }) {
  await json('/queue/reroute', { method: 'POST', body: JSON.stringify(body) })
}

// --- the dial ------------------------------------------------------------------

/** The one name the dial keeps rewriting, so playing it many times is still one flow. */
export const DIAL_NAME = 'Now'

/** A one-chunk flow around the dial's three values (energy and mood 0..1, tempo in BPM). */
export function dialFlow(energy: number, tempo: number, length: Flow['length']): Partial<Flow> {
  // shortcut: mood has no analysis yet (SPEC §11.1), so it does not shape the flow; wire it with PR 12.
  return {
    chunks: [{ id: 'now', share: 1, next: [], layers: { tempo: [[0, tempo], [1, tempo]], energy: [[0, energy], [1, energy]], harmony: [] } }],
    pull: 'strong',
    length,
  }
}

// --- what the cards draw -------------------------------------------------------

/** The first route through the flow, as the generator would start it. */
export function firstPath(flow: Pick<Flow, 'chunks'>): Chunk[] {
  const by = new Map(flow.chunks.map(c => [c.id, c]))
  const out: Chunk[] = []
  let c = flow.chunks[0]
  while (c && !out.includes(c)) {
    out.push(c)
    c = by.get(c.next[0] ?? '')!
  }
  return out
}

/** How many ends the flow can reach: 1 for a straight flow, more with forks. */
export function futures(flow: Pick<Flow, 'chunks'>): number {
  const by = new Map(flow.chunks.map(c => [c.id, c]))
  const count = (id: string, seen: Set<string>): number => {
    const c = by.get(id)
    if (!c || seen.has(id)) return 1
    const next = c.next.filter(n => by.has(n))
    if (!next.length) return 1
    const s = new Set(seen).add(id)
    return next.reduce((n, x) => n + count(x, s), 0)
  }
  return flow.chunks.length ? count(flow.chunks[0].id, new Set()) : 0
}

/** The energy curve along the first path, as [0..1 position, 0..1 energy] points; null where no chunk has energy. */
export function energyShape(flow: Pick<Flow, 'chunks'>): Curve | null {
  const path = firstPath(flow)
  const total = path.reduce((s, c) => s + c.share, 0) || 1
  const out: Curve = []
  let at = 0
  for (const c of path) {
    const w = c.share / total
    for (const [f, v] of energyPoints(c.layers)) out.push([at + f * w, v])
    at += w
  }
  return out.length >= 2 ? out : null
}

/** The harmony events along the first path, placed on the whole flow's 0..1 axis. */
export function eventDots(flow: Pick<Flow, 'chunks'>): { at: number; kind: string }[] {
  const path = firstPath(flow)
  const total = path.reduce((s, c) => s + c.share, 0) || 1
  const out: { at: number; kind: string }[] = []
  let at = 0
  for (const c of path) {
    const w = c.share / total
    for (const e of c.layers.harmony ?? []) out.push({ at: at + e.at * w, kind: e.kind })
    at += w
  }
  return out
}

/** "warm-up · peak or deep · come-down": the chunks in order, a fork's futures joined by "or". */
export function outline(flow: Pick<Flow, 'chunks'>): string {
  const by = new Map(flow.chunks.map(c => [c.id, c]))
  const parts: string[] = []
  let layer = flow.chunks.slice(0, 1)
  const seen = new Set<string>()
  while (layer.length && parts.length < 8) {
    layer.forEach(c => seen.add(c.id))
    parts.push(layer.map(c => c.id).join(' or '))
    const next = [...new Set(layer.flatMap(c => c.next))].filter(id => by.has(id) && !seen.has(id))
    layer = next.map(id => by.get(id)!)
  }
  return parts.join(' · ')
}

/** "Upcoming events": a short readable line for a card. */
export function eventsLine(flow: Pick<Flow, 'chunks'>): string {
  const dots = eventDots(flow)
  if (!dots.length) return 'matches only'
  return dots.map(d => KINDS[d.kind] ?? d.kind).join(', ')
}

/** A fork the queue reaches within this many tracks is asked about (board 2). */
const AHEAD = 2

/** The fork coming up: the playing chunk splits, and few of its tracks are left. */
export function forkAhead(q: QueueState, flow: Flow | undefined): { chunk: string; futures: string[]; taken: string; left: number } | null {
  const cur = q.items[q.current]?.flow?.chunk
  const src = q.source
  if (!cur || !src || !flow) return null
  const chunk = flow.chunks.find(c => c.id === cur)
  if (!chunk || chunk.next.length < 2) return null
  const rest = q.items.slice(q.current + 1)
  const left = rest.findIndex(i => i.flow?.chunk !== cur)
  if (left < 0 || left > AHEAD) return null
  const at = src.path.indexOf(cur)
  return { chunk: cur, futures: chunk.next, taken: src.path[at + 1] ?? '', left }
}
