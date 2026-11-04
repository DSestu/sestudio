import { useEffect, useState } from 'react'
import type { MixSettings, QueueItem, QueueState, TrackInfo } from '../../../musicQueue'
import { prepTrack, type Plan, type RawAnalysis, type Track } from '../timeline/sampling'
import { plan } from './plan'

// The server's analysis of each queued track, shared by the timeline (its
// curves) and the engine (its transitions).

const URL = '/api/music/tracks/analysis'
/** Tracks the server had no analysis for are asked again after this long. */
export const RETRY_MS = 15_000
/** Tracks being analysed are asked again this often, so the timeline draws their bands as they come. */
export const PARTIAL_MS = 400
const CHUNK = 40

/** `part`: the bands so far of a track the server is analysing; `raw` stays null until it is done. */
const cache = new Map<string, { raw: RawAnalysis | null; part?: RawAnalysis; at: number; track?: Track }>()

/** Fetch what is missing; true when something new arrived. */
export async function loadAnalyses(ids: string[]): Promise<boolean> {
  const now = Date.now()
  const want = ids.filter(id => {
    const c = cache.get(id)
    return !c || (!c.raw && now - c.at > (c.part ? PARTIAL_MS : RETRY_MS))
  })
  for (const id of want) cache.set(id, { ...cache.get(id), raw: cache.get(id)?.raw ?? null, at: now })
  let changed = false
  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK)
    try {
      const res = await fetch(`${URL}?ids=${encodeURIComponent(chunk.join(','))}`)
      if (!res.ok) continue
      const found: Record<string, RawAnalysis> = await res.json()
      for (const id of chunk) {
        const a = found[id]
        if (a?.partial) {
          // Unchanged since the last ask: keep the prepared track.
          if (a.bands?.[0]?.length === cache.get(id)?.part?.bands?.[0]?.length) continue
          cache.set(id, { raw: null, part: a, at: now })
        } else if (a) cache.set(id, { raw: a, at: now })
        else if (cache.get(id)?.part) cache.set(id, { raw: null, at: now }) // the analysis failed
        else continue
        changed = true
      }
    } catch {
      // Offline or restarting: the retry picks it up.
    }
  }
  return changed
}

export const rawOf = (id: string) => cache.get(id)?.raw

/** Load the analyses of some tracks; the number changes when new ones arrive, and `reload` forces a redraw. */
export function useAnalyses(ids: string[]): [number, () => void] {
  const [tick, setTick] = useState(0)
  const key = ids.join(',')
  useEffect(() => {
    let live = true
    loadAnalyses(key ? key.split(',') : []).then(changed => { if (live && changed) setTick(t => t + 1) })
    return () => { live = false }
  }, [key])
  return [tick, () => setTick(t => t + 1)]
}

/** Confirm or fix a track's genre on the server (null clears it) and in the local copy. */
export async function setGenre(id: string, genre: string | null): Promise<void> {
  const res = await fetch(`/api/music/tracks/${encodeURIComponent(id)}/genre`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genre }),
  })
  if (!res.ok) throw new Error(`genre: ${res.status}`)
  const c = cache.get(id)
  if (!c?.raw) return
  if (genre) c.raw = { ...c.raw, genre, genreConf: 1 }
  else cache.delete(id) // back to the detected genre: fetch it again
}

/** The track prepared for drawing and planning, kept until its analysis changes. */
export function trackOf(id: string, dur: number): Track {
  const c = cache.get(id)
  if (c?.track && c.track.dur === dur) return c.track
  const t = prepTrack(id, dur, c?.raw ?? c?.part)
  if (c) c.track = t
  return t
}

/** Whether the server is analysing one of these tracks right now. */
export const analysing = (ids: string[]) => ids.some(id => cache.get(id)?.part)

export const DEFAULT_MIX: MixSettings = { mode: 'sync', bars: 8, tempo: true, swap: true, nudge: 0 }

/** The pair's own settings (the server stores them whole), else the default mix. */
export const mixOf = (q: Pick<QueueState, 'default_mix' | 'mix'>, a: string, b: string): MixSettings =>
  q.mix[`${a}>${b}`] ?? { ...DEFAULT_MIX, mode: q.default_mix }

/** The plan from queue item a to item b. */
export function planBetween(q: QueueState, a: QueueItem, b: QueueItem, info: (id: string) => TrackInfo | undefined): Plan {
  return plan(
    trackOf(a.track_id, info(a.track_id)?.duration ?? 0),
    trackOf(b.track_id, info(b.track_id)?.duration ?? 0),
    mixOf(q, a.track_id, b.track_id),
  )
}
