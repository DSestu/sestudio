import { useEffect, useSyncExternalStore } from 'react'
import { fmtBpm } from './components/music/format'

// What a track row shows of the analysis: tempo, key, genre and balance. A
// light summary, fetched for many rows in one request (the full analysis is
// 60 KB a track), and asked again while the server has none.

export interface Summary {
  bpm?: number
  camelot?: string
  keyConf?: number
  genre?: string
  genreConf?: number
  /** Where the genre came from: the file's tag, an online source, the model, the rules or the user. */
  genreSource?: 'tag' | 'source' | 'model' | 'rules' | 'user'
  /** Mean bass, mids, highs, 0..1. */
  balance?: [number, number, number]
}

export const SUMMARY_RETRY_MS = 10_000
const CHUNK = 150
const known = new Map<string, Summary>()
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

/** Queue a track's summary for the next batch, unless known or missed less than a retry ago. */
export function requestSummary(id: string) {
  const at = missedAt.get(id)
  if (known.has(id) || wanted.has(id) || (at !== undefined && Date.now() - at < SUMMARY_RETRY_MS)) return
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
    const t = window.setInterval(() => { if (known.has(id)) window.clearInterval(t); else requestSummary(id) }, SUMMARY_RETRY_MS)
    return () => window.clearInterval(t)
  }, [id])
  return id ? known.get(id) : undefined
}

/** "174 · 8A · Liquid": the one muted line phones show (and queue rows). */
export const metaLine = (s: Summary | undefined, bpm?: number): string =>
  [(s?.bpm || bpm) && fmtBpm((s?.bpm || bpm)!), s?.camelot, s?.genre].filter(Boolean).join(' · ')

/** Summaries of many tracks (a library view): the getter, and a number that changes as more arrive. */
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
