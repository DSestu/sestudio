import type { MixSettings, QueueItem, QueueState, TrackInfo } from '../../../musicQueue'
import { prepTrack, type Plan, type RawAnalysis, type Track } from '../timeline/sampling'
import { plan } from './plan'

// The server's analysis of each queued track, shared by the timeline (its
// curves) and the engine (its transitions).

const URL = '/api/music/tracks/analysis'
/** Tracks the server had no analysis for are asked again after this long. */
export const RETRY_MS = 15_000
const CHUNK = 40

const cache = new Map<string, { raw: RawAnalysis | null; at: number; track?: Track }>()

/** Fetch what is missing; true when something new arrived. */
export async function loadAnalyses(ids: string[]): Promise<boolean> {
  const now = Date.now()
  const want = ids.filter(id => {
    const c = cache.get(id)
    return !c || (!c.raw && now - c.at > RETRY_MS)
  })
  for (const id of want) cache.set(id, { raw: cache.get(id)?.raw ?? null, at: now })
  let changed = false
  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK)
    try {
      const res = await fetch(`${URL}?ids=${encodeURIComponent(chunk.join(','))}`)
      if (!res.ok) continue
      const found: Record<string, RawAnalysis> = await res.json()
      for (const id of chunk) if (found[id]) { cache.set(id, { raw: found[id], at: now }); changed = true }
    } catch {
      // Offline or restarting: the retry picks it up.
    }
  }
  return changed
}

export const rawOf = (id: string) => cache.get(id)?.raw

/** The track prepared for drawing and planning, kept until its analysis changes. */
export function trackOf(id: string, dur: number): Track {
  const c = cache.get(id)
  if (c?.track && c.track.dur === dur) return c.track
  const t = prepTrack(id, dur, c?.raw)
  if (c) c.track = t
  return t
}

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
