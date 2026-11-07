import { useSyncExternalStore } from 'react'
import { bridges, cost, join, tempoOk, type Join, type ProxTrack } from './crates/proximity'

// The queue's transitions as places to insert (SPEC-fits-between): which ones are rough,
// what goes between two tracks, and where a track helps most.

/** A transition worth fixing: a key clash, or a tempo jump inside one genre. */
export const isRough = (j: Join) => j.kind === 'clash' || !tempoOk(j)

/** A rough transition's name on its pill. */
export const roughLabel = (j: Join) => (j.kind === 'clash' ? 'Clash' : 'Tempo jump')

/** A side of a bridge: its cost, a rough one far dearer than any smooth one, an unknown key between the two. */
const sideCost = (j: Join) => cost(j) + (isRough(j) ? 20 : j.kind === null ? 12 : 0)

export interface Bridge {
  id: string
  before: Join
  after: Join
}

/** Tracks to put between a and b: the strict bridges (smooth both sides) first, then the rest of the pool by cost. */
export function gapBridges(a: ProxTrack, b: ProxTrack, pool: ProxTrack[], limit = 10, exclude: Iterable<string> = []): Bridge[] {
  const strict = bridges(a, b, pool, limit, exclude)
  if (strict.length >= limit) return strict
  const skip = new Set([a.id, b.id, ...exclude, ...strict.map(s => s.id)])
  const rest = pool
    .filter(t => !skip.has(t.id))
    .map(t => {
      const before = join(a, t)
      const after = join(t, b)
      return { id: t.id, before, after, c: sideCost(before) + sideCost(after) }
    })
    .sort((x, y) => x.c - y.c || (x.id < y.id ? -1 : 1))
    .slice(0, limit - strict.length)
    .map(({ id, before, after }) => ({ id, before, after }))
  return [...strict, ...rest]
}

export interface BestGap {
  /** The queue index an insert there goes to. */
  at: number
  before: Join
  /** Null at the end of the queue. */
  after: Join | null
  /** How much the transition gets better (cost saved): above 0 it fixes something. */
  gain: number
}

/** Where `t` helps most among the gaps after `list[from]` (at most `span` of them, the end included). */
export function bestGap(t: ProxTrack, list: ProxTrack[], from: number, span = 15): BestGap | null {
  let best: BestGap | null = null
  for (let g = Math.max(0, from); g < list.length && g < from + span; g++) {
    const a = list[g]
    const b = list[g + 1]
    const before = join(a, t)
    const after = b ? join(t, b) : null
    const gain = (b ? sideCost(join(a, b)) : 0) - sideCost(before) - (after ? sideCost(after) : 0)
    if (!best || gain > best.gain) best = { at: g + 1, before, after, gain }
  }
  return best
}

// "More in Fits next": the library opens on its Fits next tab. The time of the ask, so a list mounted by it (or open) switches, and a later one does not.
let askedAt = 0
const askListeners = new Set<() => void>()
export const askFits = () => { askedAt = performance.now(); askListeners.forEach(l => l()) }
export const useFitsAsk = () => useSyncExternalStore(l => { askListeners.add(l); return () => askListeners.delete(l) }, () => askedAt)
