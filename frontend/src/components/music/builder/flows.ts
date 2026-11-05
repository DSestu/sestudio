import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useDownloadedLibrary } from '../../../downloadedLibrary'
import { albumsOf, type MusicTrack } from '../../../musicLibrary'
import { useLibraryTracks } from '../../../musicLibraries'
import { useSummaries, type Summary } from '../../../musicMeta'
import type { AddPayload } from '../../../musicQueue'
import { join, tempoOk, type ProxTrack } from '../crates/proximity'

// The mix builder's flows (master plan E5): draft mixes and branches kept on the
// server (src/sestudio/music/flows.py). This module is the API calls, a small
// shared copy of the list, and the pure helpers over it.

export type FlowRef = AddPayload['tracks'][number]
export interface Flow {
  id: string
  name: string
  mode: 'mix' | 'branch'
  position: number
  /** A branch: the track it starts after, and the set that is the trunk. */
  fork: FlowRef | null
  base: string | null
  items: FlowRef[]
}

/** One colour per flow, in order. */
export const FLOW_COLORS = ['oklch(74% .14 230)', 'oklch(78% .14 150)', 'oklch(78% .15 60)', 'oklch(72% .15 320)', 'oklch(76% .12 20)']
export const flowColor = (i: number) => FLOW_COLORS[i % FLOW_COLORS.length]

export const refKey = (r: Pick<FlowRef, 'library' | 'track_id'>) => `${r.library}:${r.track_id}`

export const refOf = (t: MusicTrack): FlowRef =>
  t.library === 'online'
    ? { library: t.library, track_id: t.id, source: t.source, title: t.title, artist: t.artist, duration: t.duration }
    : { library: t.library, track_id: t.id }

/** `ref` put at `at` (the end by default) of the list; a track already there moves instead of doubling. */
export function inserted(items: FlowRef[], ref: FlowRef, at?: number): FlowRef[] {
  const out = [...items]
  const old = out.findIndex(r => refKey(r) === refKey(ref))
  if (old >= 0) {
    out.splice(old, 1)
    if (at !== undefined && old < at) at--
  }
  out.splice(at === undefined || at > out.length ? out.length : at, 0, ref)
  return out
}

/**
 * The lists that change when `ref` is dropped at `at` of flow `to`; `from` is the flow it was
 * dragged out of (none: it comes from the picker). A flow's list is only touched when it changes.
 */
export function dropped(lists: Record<string, FlowRef[]>, ref: FlowRef, to: string, at?: number, from?: string): Record<string, FlowRef[]> {
  const out = { [to]: inserted(lists[to] ?? [], ref, at) }
  if (from && from !== to) Object.assign(out, { [from]: (lists[from] ?? []).filter(r => refKey(r) !== refKey(ref)) })
  return out
}

// --- what a row shows -----------------------------------------------------------

export interface Row {
  ref: FlowRef
  title: string
  artist: string
  duration: number
  prox: ProxTrack
  mode?: string
  /** Energy on the library scale, 0..100. */
  energy?: number
  /** The track is not in the loaded libraries. */
  missing: boolean
}

export const proxOf = (id: string, s: Summary | undefined, bpm?: number): ProxTrack => ({
  id, bpm: s?.bpm || bpm, camelot: s?.camelot, genre: s?.genre, harmony: s?.harmony, energyScale: s?.energyScale,
})

export function rowOf(ref: FlowRef, byId: Map<string, MusicTrack>, get: (id: string) => Summary | undefined): Row {
  const t = byId.get(ref.track_id)
  const s = get(ref.track_id)
  return {
    ref,
    title: t?.title ?? ref.title ?? ref.track_id,
    artist: t?.artist ?? ref.artist ?? '',
    duration: t?.duration ?? ref.duration ?? 0,
    prox: proxOf(ref.track_id, s, t?.bpm),
    mode: s?.harmony?.track?.mode,
    energy: s?.energyScale?.track,
    missing: !t && ref.library !== 'online',
  }
}

export interface FlowStats {
  count: number
  duration: number
  clashes: number
  tempoJumps: number
}

/** A flow's summary; `fork` is the track it follows, which only the first join counts against. */
export function flowStats(rows: Row[], fork?: Row): FlowStats {
  const s: FlowStats = { count: rows.length, duration: rows.reduce((d, r) => d + r.duration, 0), clashes: 0, tempoJumps: 0 }
  const seq = fork ? [fork, ...rows] : rows
  for (let i = 1; i < seq.length; i++) {
    const j = join(seq[i - 1].prox, seq[i].prox)
    if (j.kind === 'clash') s.clashes++
    if (!tempoOk(j)) s.tempoJumps++
  }
  return s
}

// --- server ---------------------------------------------------------------------

const BASE = '/api/music/flows'

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `flows: ${res.status}`)
  return res.json()
}

let flows: Flow[] = []
let loaded = false
const listeners = new Set<() => void>()
const set = (next: Flow[]) => { flows = next; listeners.forEach(l => l()) }

export async function loadFlows(): Promise<void> {
  set(await call<Flow[]>('', 'GET'))
  loaded = true
}

/** The shared list, fetched on first use. */
export function useFlows(): { flows: Flow[]; loaded: boolean } {
  useEffect(() => {
    if (!loaded) loadFlows().catch(() => {})
  }, [])
  const list = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => flows)
  return { flows: list, loaded }
}

export const flowApi = {
  create: async (name: string, mode: Flow['mode'] = 'mix', extra: { fork?: FlowRef | null; base?: string | null; items?: FlowRef[] } = {}) => {
    const f = await call<Flow>('', 'POST', { name, mode, ...extra })
    set([...flows, f])
    return f
  },
  /** Shown at once; the server catches up, and the list is read again if it refuses. */
  patch: (id: string, fields: Partial<Pick<Flow, 'name' | 'fork' | 'base' | 'items'>>) => {
    set(flows.map(f => (f.id === id ? { ...f, ...fields } : f)))
    return call<Flow>(`/${id}`, 'PATCH', fields).catch(e => { void loadFlows(); throw e })
  },
  remove: (id: string) => {
    set(flows.filter(f => f.id !== id))
    return call(`/${id}`, 'DELETE').catch(e => { void loadFlows(); throw e })
  },
}

/** A new empty flow named "Mix 3" or "Branch 2" after the ones of its kind. */
export const newFlow = (mode: Flow['mode']) =>
  flowApi.create(`${mode === 'mix' ? 'Mix' : 'Branch'} ${flows.filter(f => f.mode === mode).length + 1}`, mode)

/** Every track the builder can place: this PC's and the other libraries'. */
export function useAllTracks() {
  const titles = useDownloadedLibrary()
  const others = useLibraryTracks()
  const all = useMemo(() => [...albumsOf(titles).flatMap(a => a.tracks), ...others], [titles, others])
  const byId = useMemo(() => new Map(all.map(t => [t.id, t])), [all])
  const ids = useMemo(() => all.filter(t => t.library !== 'online').map(t => t.id), [all])
  return { all, byId, ...useSummaries(ids) }
}
