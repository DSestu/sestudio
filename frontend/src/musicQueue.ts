import { useEffect, useSyncExternalStore } from 'react'
import { downloadedFileUrl, getDownloadedLibrary } from './api'
import type { MusicTrack } from './musicLibrary'

// The music queue lives on the server (SPEC-music §6). This module is the
// client side: the API calls, the Server-Sent Events subscription that keeps a
// local copy current, and the position extrapolated between events.

const BASE = '/api/music'

export interface TrackRef {
  library: string
  track_id: string
}
export interface QueueItem extends TrackRef {
  item_id: string
}
export interface MixSettings {
  mode: string
  bars: number
  tempo: boolean
  swap: boolean
  nudge: number
}
export interface QueueState {
  rev: number
  items: QueueItem[]
  /** Index into items, -1 when nothing is current. */
  current: number
  position: number
  /** Server clock (seconds) when position was set. */
  updated_at: number
  server_time: number
  playing: boolean
  repeat: boolean
  default_mix: string
  mix: Record<string, MixSettings>
}
/** One pushed change: `op` names it, the rest is that op's own fields. */
export interface QueueEvent {
  rev: number
  op: string
  [field: string]: unknown
}

export const EMPTY_QUEUE: QueueState = {
  rev: 0, items: [], current: -1, position: 0, updated_at: 0, server_time: 0,
  playing: false, repeat: false, default_mix: 'sync', mix: {},
}

/** Seconds into the current track now. `skew` is server clock minus client clock. */
export function positionNow(s: QueueState, skew: number, nowMs: number, duration = Infinity): number {
  if (!s.playing) return Math.min(s.position, duration)
  return Math.min(s.position + Math.max(0, nowMs / 1000 + skew - s.updated_at), duration)
}

/** Apply one event to the state. `serverNow` stamps the ops that restart the
 *  position without carrying a time. Returns null when the event does not
 *  follow the state's revision (a missed one): the caller refetches. */
export function applyEvent(s: QueueState, ev: QueueEvent, serverNow: number): QueueState | null {
  if (ev.rev !== s.rev + 1) return null
  const restart = (current: number, playing: boolean): Partial<QueueState> => ({
    current, playing, position: 0, updated_at: serverNow,
  })
  const next: QueueState = { ...s, rev: ev.rev }
  const curId = s.items[s.current]?.item_id
  const keep = (items: QueueItem[]) => items.findIndex(i => i.item_id === curId)
  switch (ev.op) {
    case 'ins': {
      const items = [...s.items]
      items.splice(ev.index as number, 0, ...(ev.items as QueueItem[]))
      next.items = items
      if (ev.play) Object.assign(next, restart(ev.index as number, true))
      else if (s.current < 0) Object.assign(next, { current: 0, position: 0, updated_at: serverNow })
      else next.current = keep(items)
      return next
    }
    case 'set':
      next.items = ev.items as QueueItem[]
      return Object.assign(next, restart(0, true))
    case 'rm': {
      const i = ev.index as number
      const items = s.items.filter(x => x.item_id !== ev.item_id)
      next.items = items
      if (ev.item_id === curId) {
        // The next row slides into the removed one's place.
        return Object.assign(next, restart(items.length ? Math.min(i, items.length - 1) : -1, items.length > 0 && s.playing))
      }
      next.current = keep(items)
      return next
    }
    case 'mv': {
      const items = [...s.items]
      items.splice(ev.to as number, 0, ...items.splice(ev.from as number, 1))
      return Object.assign(next, { items, current: keep(items) })
    }
    case 'go':
      return Object.assign(next, restart(ev.index as number, (ev.playing as boolean | undefined) ?? true))
    case 'transport':
      return Object.assign(next, {
        playing: ev.playing as boolean, position: ev.position as number,
        repeat: ev.repeat as boolean, updated_at: ev.updated_at as number,
      })
    case 'mix': {
      const { from, to, settings } = ev as unknown as { from: string; to: string; settings: MixSettings }
      return Object.assign(next, { mix: { ...s.mix, [`${from}>${to}`]: settings } })
    }
    case 'mixd':
      return Object.assign(next, { default_mix: ev.mode as string })
    default:
      return null
  }
}

// --- the store ---------------------------------------------------------------

let state: QueueState = EMPTY_QUEUE
let skew = 0
let source: EventSource | null = null
const listeners = new Set<() => void>()
const eventListeners = new Set<(ev: QueueEvent, before: QueueState, after: QueueState) => void>()

const emit = () => listeners.forEach(l => l())

function setState(s: QueueState) {
  state = s
  if (s.server_time) skew = s.server_time - Date.now() / 1000
  emit()
}

async function refetch() {
  const res = await fetch(`${BASE}/queue`)
  if (res.ok) setState(await res.json())
}

const OPS = ['ins', 'rm', 'mv', 'go', 'set', 'mix', 'mixd', 'transport']

function connect() {
  if (source) return
  source = new EventSource(`${BASE}/queue/events`)
  // The snapshot is sent on every (re)connect, so a dropped stream heals itself.
  source.addEventListener('state', e => setState(JSON.parse((e as MessageEvent).data)))
  for (const op of OPS) {
    source.addEventListener(op, e => {
      const ev: QueueEvent = JSON.parse((e as MessageEvent).data)
      if (ev.rev <= state.rev) return
      const next = applyEvent(state, ev, Date.now() / 1000 + skew)
      if (!next) { void refetch(); return }
      const before = state
      state = next
      emit()
      eventListeners.forEach(l => l(ev, before, next))
    })
  }
}

/** Run *fn* for every pushed change, after the state has been updated. */
export function onQueueEvent(fn: (ev: QueueEvent, before: QueueState, after: QueueState) => void) {
  eventListeners.add(fn)
  return () => { eventListeners.delete(fn) }
}

export const getQueue = () => state
export const serverNow = () => Date.now() / 1000 + skew
export const clockSkew = () => skew

/** The queue, live. Opens the event stream on first use. */
export function useMusicQueue(): QueueState {
  useEffect(connect, [])
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, getQueue)
}

// --- actions: every change goes through the server -----------------------------

async function send(method: string, path: string, body?: unknown): Promise<void> {
  for (let tries = 0; tries < 2; tries++) {
    const res = await fetch(`${BASE}/queue${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'If-Match': String(state.rev) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // Stale: the body is the current state; take it and try once more.
    if (res.status === 409) { setState(await res.json()); continue }
    return
  }
}

export const queueActions = {
  play: (itemId: string) => send('POST', '/play', { item_id: itemId }),
  remove: (itemId: string) => send('DELETE', `/${itemId}`),
  move: (itemId: string, to: number) => send('POST', '/move', { item_id: itemId, to }),
  transport: (
    action: 'play' | 'pause' | 'seek' | 'next' | 'prev' | 'repeat',
    extra: { position?: number; repeat?: boolean } = {},
  ) => send('POST', '/transport', { action, ...extra }),
}

// --- adding from the library views ----------------------------------------------

export interface AddPayload {
  tracks: { library: string; track_id: string }[]
  play_now?: boolean
  replace?: boolean
}

export function addPayload(tracks: MusicTrack[], mode: 'play_now' | 'replace' | 'append'): AddPayload {
  return {
    tracks: tracks.map(t => ({ library: t.library, track_id: t.id })),
    ...(mode === 'play_now' && { play_now: true }),
    // The server starts at the first track of a replacement.
    ...(mode === 'replace' && { replace: true }),
  }
}

export async function post(payload: AddPayload): Promise<void> {
  const res = await fetch('/api/music/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`queue: ${res.status}`)
}

export const addToQueue = (t: MusicTrack) => post(addPayload([t], 'append'))

// --- what the queue's tracks are called ------------------------------------------

export interface TrackInfo {
  id: string
  title: string
  artist: string
  duration: number
  url: string
}
export interface Analysis {
  bpm?: number
  beat0?: number
  hue?: number
  /** Mean bass, mids, highs, 0..1. */
  balance?: [number, number, number]
}

let tracks = new Map<string, TrackInfo>()
let tracksLoading: Promise<void> | null = null
const trackListeners = new Set<() => void>()

function loadTracks(): Promise<void> {
  tracksLoading ??= getDownloadedLibrary()
    .then(titles => {
      const next = new Map<string, TrackInfo>()
      for (const t of titles) for (const f of t.files) {
        if (!f.id) continue
        next.set(f.id, { id: f.id, title: f.title, artist: f.artist ?? '', duration: f.duration ?? 0, url: downloadedFileUrl(f.path) })
      }
      tracks = next
      trackListeners.forEach(l => l())
    })
    .finally(() => { tracksLoading = null })
  return tracksLoading
}

export const trackInfo = (id: string | undefined) => (id ? tracks.get(id) : undefined)

/** Track metadata by id, reloaded when the queue holds one it has not seen. */
export function useTrackInfo(q: QueueState): (id: string) => TrackInfo | undefined {
  useSyncExternalStore(l => { trackListeners.add(l); return () => trackListeners.delete(l) }, () => tracks)
  const missing = q.items.some(i => !tracks.has(i.track_id))
  useEffect(() => { if (missing) void loadTracks() }, [missing, q.rev])
  return id => tracks.get(id)
}

const analyses = new Map<string, Analysis | null>()
const analysisListeners = new Set<() => void>()
let analysisVersion = 0

/** Server analysis of a track; null while absent (the endpoint may not exist yet). */
export function useAnalysis(id: string | undefined): Analysis | null {
  useSyncExternalStore(l => { analysisListeners.add(l); return () => analysisListeners.delete(l) }, () => analysisVersion)
  useEffect(() => {
    if (!id || analyses.has(id)) return
    analyses.set(id, null)
    fetch(`${BASE}/tracks/${encodeURIComponent(id)}/analysis`)
      .then(r => (r.ok ? r.json() : null))
      .then(a => {
        if (!a) return
        analyses.set(id, parseAnalysis(a))
        analysisVersion++
        analysisListeners.forEach(l => l())
      })
      .catch(() => {})
  }, [id])
  return id ? analyses.get(id) ?? null : null
}

/** Accepts the analysis in either shape the server may serve: the means
 *  directly, or the 8 band envelopes (bass = 60 + 120 Hz, mids = 250 + 500 + 1000,
 *  highs = the rest, SPEC-music-player §6.1). */
export function parseAnalysis(a: Record<string, unknown>): Analysis {
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined)
  const out: Analysis = { bpm: num(a.bpm), beat0: num(a.beat0), hue: num(a.hue) }
  const bands = a.bands as number[][] | undefined
  if (Array.isArray(bands) && bands.length === 8 && bands[0]?.length) {
    // The server serves whole percents.
    const mean = (rows: number[][]) => rows.reduce((s, r) => s + r.reduce((x, y) => x + y, 0) / r.length, 0) / rows.length / 100
    out.balance = [mean(bands.slice(0, 2)), mean(bands.slice(2, 5)), mean(bands.slice(5))]
  } else if (Array.isArray(a.balance) && a.balance.length === 3) {
    out.balance = a.balance as [number, number, number]
  }
  return out
}
