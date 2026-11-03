import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { downloadedFileUrl, getDownloadedLibrary } from './api'
import { fetchLibraryTracks, libraryAudioUrl } from './musicLibraries'
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
  /** A streamed track (library "online") carries what the queue shows. */
  source?: string
  title?: string
  artist?: string
  duration?: number
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
  /** The station's playback clock while one runs (SPEC-music §7). */
  station?: StationClock | null
}
export interface StationClock {
  item_id: string | null
  /** Seconds into that item, at server time `at`. */
  position: number
  playing: boolean
  at: number
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
      // `keep`: a jump on the timeline lands at a position and leaves play / pause as it was.
      if (ev.keep) return Object.assign(next, restart(ev.index as number, s.playing), { position: ev.position as number })
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

/** What the station (the TV's stream) is playing now, on the server's clock. */
export function withStation(s: QueueState, st: StationClock | null | undefined): QueueState {
  if (!st?.item_id) return s
  const i = s.items.findIndex(x => x.item_id === st.item_id)
  return i < 0 ? s : { ...s, current: i, position: st.position, updated_at: st.at, playing: st.playing }
}

// --- the store ---------------------------------------------------------------

// `raw` is the queue as the server has it, which events apply to; `state` is what is shown:
// the same, except on the TV page, which follows the station's clock (the sound it is sent).
let raw: QueueState = EMPTY_QUEUE
let state: QueueState = EMPTY_QUEUE
let station: StationClock | null = null
let following = false
let skew = 0
let source: EventSource | null = null
const listeners = new Set<() => void>()
const eventListeners = new Set<(ev: QueueEvent, before: QueueState, after: QueueState) => void>()

const emit = () => listeners.forEach(l => l())

const show = () => { state = following ? withStation(raw, station) : raw }

function setState(s: QueueState) {
  raw = s
  station = s.station ?? null
  show()
  if (s.server_time) skew = s.server_time - Date.now() / 1000
  emit()
}

/** The TV page: show what the station plays, not the queue's own clock. */
export function followStation() {
  following = true
  show()
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
      if (ev.rev <= raw.rev) return
      const next = applyEvent(raw, ev, Date.now() / 1000 + skew)
      if (!next) { void refetch(); return }
      const before = state
      raw = next
      show()
      emit()
      eventListeners.forEach(l => l(ev, before, state))
    })
  }
  // A clock, not a change: no revision.
  source.addEventListener('station', e => {
    const ev = JSON.parse((e as MessageEvent).data) as StationClock
    station = ev.item_id ? ev : null
    show()
    emit()
  })
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
  play: (itemId: string, position?: number) => send('POST', '/play', { item_id: itemId, position }),
  remove: (itemId: string) => send('DELETE', `/${itemId}`),
  move: (itemId: string, to: number) => send('POST', '/move', { item_id: itemId, to }),
  transport: (
    action: 'play' | 'pause' | 'seek' | 'next' | 'prev' | 'repeat',
    extra: { position?: number; repeat?: boolean } = {},
  ) => send('POST', '/transport', { action, ...extra }),
  /** A pair's own mix settings (every field: the server stores them whole). */
  setMix: (from: string, to: string, settings: MixSettings) =>
    send('PUT', `/mix/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, settings),
  setDefaultMix: (mode: 'fade' | 'sync') => send('PUT', '/mix/default', { mode }),
}

// --- adding from the library views ----------------------------------------------

export interface AddPayload {
  tracks: (TrackRef & Partial<Pick<QueueItem, 'source' | 'title' | 'artist' | 'duration'>>)[]
  play_now?: boolean
  replace?: boolean
  /** Where in the queue to insert (default: the end). */
  index?: number
}

export function addPayload(tracks: MusicTrack[], mode: 'play_now' | 'replace' | 'append'): AddPayload {
  return {
    // A streamed track carries what the queue shows; the server does not look it up again.
    tracks: tracks.map(t => t.library === 'online'
      ? { library: t.library, track_id: t.id, source: t.source, title: t.title, artist: t.artist, duration: t.duration }
      : { library: t.library, track_id: t.id }),
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

/** A pasted YouTube / YouTube Music link as queue items (a playlist: every entry). */
export interface OnlineLink {
  kind: 'video' | 'playlist'
  title: string
  tracks: AddPayload['tracks']
}
export async function resolveLink(url: string): Promise<OnlineLink> {
  const res = await fetch(`${BASE}/online/link?${new URLSearchParams({ url })}`)
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `link: ${res.status}`)
  return res.json()
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
  bar0?: number
  hue?: number
  /** Mean bass, mids, highs, 0..1. */
  balance?: [number, number, number]
}

let tracks = new Map<string, TrackInfo>()
let tracksLoading: Promise<void> | null = null
const trackListeners = new Set<() => void>()

function loadTracks(): Promise<void> {
  tracksLoading ??= Promise.all([getDownloadedLibrary(), fetchLibraryTracks().catch(() => [])])
    .then(([titles, others]) => {
      const next = new Map<string, TrackInfo>()
      for (const t of titles) for (const f of t.files) {
        if (!f.id) continue
        next.set(f.id, { id: f.id, title: f.title, artist: f.artist ?? '', duration: f.duration ?? 0, url: downloadedFileUrl(f.path) })
      }
      for (const t of others) if (t.library !== 'online') next.set(t.id, { id: t.id, title: t.title, artist: t.artist, duration: t.duration, url: libraryAudioUrl(t) })
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
  const online = useMemo(() => new Map(q.items.filter(i => i.library === 'online').map(i => [i.track_id, {
    id: i.track_id, title: i.title ?? '', artist: i.artist ?? '', duration: i.duration ?? 0,
    url: `${BASE}/online/${encodeURIComponent(i.track_id)}/audio`,
  }])), [q.items])
  const missing = q.items.some(i => i.library !== 'online' && !tracks.has(i.track_id))
  useEffect(() => { if (missing) void loadTracks() }, [missing, q.rev])
  return id => tracks.get(id) ?? online.get(id)
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
  const out: Analysis = { bpm: num(a.bpm), beat0: num(a.beat0), bar0: num(a.bar0), hue: num(a.hue) }
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
