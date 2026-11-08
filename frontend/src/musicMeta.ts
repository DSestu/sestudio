import { useEffect, useSyncExternalStore } from 'react'
import { fmtBpm } from './components/music/format'
import type { Reading } from './components/music/crates/proximity'
import { DEFAULT_THEORY, keyDisplay, keyLabel, type Theory } from './harmony'

// What a track row shows of the analysis: tempo, key, genre and balance. A
// light summary, fetched for many rows in one request (the full analysis is
// 60 KB a track), and asked again while the server has none.

export interface Summary {
  bpm?: number
  /** "F minor". */
  key?: string
  camelot?: string
  keyConf?: number
  genre?: string
  genreConf?: number
  /** Where the genre came from: the file's tag, an online source, the model, the rules or the user. */
  genreSource?: 'tag' | 'source' | 'model' | 'rules' | 'user'
  /** Tonic, mode and notes of the track, and its energy on the library scale (0..100). */
  harmony?: { track?: Reading }
  energyScale?: { track?: number; intro?: number; outro?: number }
  /** Mean bass, mids, highs, 0..1. */
  balance?: [number, number, number]
}

export const SUMMARY_RETRY_MS = 10_000
const CHUNK = 150
const known = new Map<string, Summary>()
/** The background analysis is working (on tracks, or on the tonic and mode pass). */
let busy = false
const missedAt = new Map<string, number>()
const wanted = new Set<string>()
const listeners = new Set<() => void>()
let timer = 0
let version = 0

async function flush() {
  const ids = [...wanted]
  wanted.clear()
  for (let i = 0; i < ids.length; i += CHUNK) {
    try {
      const res = await fetch(`/api/music/tracks/summary?ids=${encodeURIComponent(ids.slice(i, i + CHUNK).join(','))}`)
      if (!res.ok) continue
      const found: Record<string, Summary> = await res.json()
      for (const [id, s] of Object.entries(found)) {
        known.set(id, s)
        missedAt.delete(id)
      }
      version++
      listeners.forEach(l => l())
    } catch {
      // Offline or restarting: the retry asks again.
    }
  }
}

/** A summary still lacking its harmony: the track is being analysed, or waits for the harmony pass. */
export const pending = (s?: Summary) => !s?.harmony

/** Queue a track's summary for the next batch, unless known (and complete, while the analysis runs) or missed less than a retry ago. */
export function requestSummary(id: string) {
  const at = missedAt.get(id)
  if ((known.has(id) && !(busy && pending(known.get(id)))) || wanted.has(id) || (at !== undefined && Date.now() - at < SUMMARY_RETRY_MS)) return
  missedAt.set(id, Date.now())
  wanted.add(id)
  timer ||= window.setTimeout(() => { timer = 0; void flush() }, 40)
}

/** A genre was confirmed or changed: read the track's summary again. */
export function refreshSummary(id: string) {
  known.delete(id)
  missedAt.delete(id)
  requestSummary(id)
}

export function useSummary(id: string | undefined): Summary | undefined {
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  useEffect(() => {
    if (!id) return
    requestSummary(id)
    const t = window.setInterval(() => requestSummary(id), SUMMARY_RETRY_MS)
    return () => window.clearInterval(t)
  }, [id])
  return id ? known.get(id) : undefined
}

let watchers = 0
let poll = 0

async function checkBusy() {
  try {
    const s: { running: boolean; modes: { done: number; total: number } } = await (await fetch('/api/music/analysis/status')).json()
    const now = s.running || s.modes.done < s.modes.total
    if (now === busy) return
    busy = now
    // The pass just ended: read the last results.
    if (!busy) known.forEach((v, id) => { if (pending(v)) { missedAt.delete(id); requestSummary(id) } })
    version++
    listeners.forEach(l => l())
  } catch {
    // Offline or restarting: the next poll asks again.
  }
}

/** Whether a track's tonic, mode and energy are still being worked out: the analysis is running and has not got to it. */
export function useAnalysing(id: string | undefined): boolean {
  useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  useEffect(() => {
    if (!watchers++) { void checkBusy(); poll = window.setInterval(checkBusy, 3000) }
    return () => { if (!--watchers) window.clearInterval(poll) }
  }, [])
  return id !== undefined && busy && pending(known.get(id))
}

export { keyLabel }

/** The short name of a genre for a chip, and its colour (a neutral grey for the genres with none). */
const GENRE_SHORT: Record<string, string> = { 'Drum & Bass': 'DnB', Neurofunk: 'Neuro', 'Liquid Drum & Bass': 'Liquid', Electronic: 'Electro' }
const GENRE_COLOR: Record<string, string> = {
  'Drum & Bass': 'oklch(74% .11 185)',
  Neurofunk: 'oklch(74% .11 185)',
  'Liquid Drum & Bass': 'oklch(74% .11 185)',
  Dubstep: 'oklch(80% .15 128)',
  Ambient: 'oklch(78% .06 265)',
  Trance: 'oklch(76% .12 310)',
  Techno: 'oklch(72% .1 20)',
  House: 'oklch(80% .12 75)',
  'Hip-hop': 'oklch(76% .1 50)',
}
export const genreShort = (g: string): string => GENRE_SHORT[g] ?? g
export const genreColor = (g: string): string => GENRE_COLOR[g] ?? 'oklch(75% .02 265)'

/** "174 · F min (4A) · Liquid": the one muted line phones show (and queue rows). */
export const metaLine = (s: Summary | undefined, bpm?: number, theory: Theory = DEFAULT_THEORY): string =>
  [(s?.bpm || bpm) && fmtBpm((s?.bpm || bpm)!), keyDisplay(theory, s)?.text, s?.genre && genreShort(s.genre)].filter(Boolean).join(' · ')

/** Summaries of many tracks (a library view): the getter, and a number that changes as more arrive. */
/** A track's summary if known; asks for it otherwise (outside React, e.g. a frame loop). */
export function summaryOf(id: string): Summary | undefined {
  requestSummary(id)
  return known.get(id)
}

export function useSummaries(ids: string[]): { get: (id: string) => Summary | undefined; v: number } {
  const v = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => version)
  useEffect(() => {
    const ask = () => ids.forEach(requestSummary)
    ask()
    const t = window.setInterval(ask, SUMMARY_RETRY_MS)
    return () => window.clearInterval(t)
  }, [ids])
  return { get: id => known.get(id), v }
}

/** The most common genre among some summaries, if any. */
export function dominantGenre(list: (Summary | undefined)[]): string | undefined {
  const n = new Map<string, number>()
  for (const s of list) if (s?.genre) n.set(s.genre, (n.get(s.genre) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** "172–175 BPM · Liquid" for a card's subline; '' when nothing is analysed. */
export function factsLine(list: (Summary | undefined)[], fallback: (number | undefined)[] = []): string {
  const bpms = list.map((s, i) => s?.bpm || fallback[i]).filter((b): b is number => !!b).map(Math.round)
  const lo = Math.min(...bpms)
  const hi = Math.max(...bpms)
  const range = bpms.length ? `${lo === hi ? lo : `${lo}–${hi}`} BPM` : ''
  return [range, dominantGenre(list)].filter(Boolean).join(' · ')
}
