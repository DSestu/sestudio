import { useMemo, useSyncExternalStore } from 'react'
import type { QueueItem, QueueState } from '../../musicQueue'
import { useSummaries, type Summary } from '../../musicMeta'
import { join, joinColor, type Join, type ProxTrack } from './crates/proximity'
import { isRough, roughLabel } from './gaps'

// The queue's transitions (SPEC-fits-between): each one read from the two tracks' summaries, which are rough, and the ones kept.

/** The transition before `items[at]`. */
export interface Gap {
  at: number
  join: Join
  rough: boolean
}

export const proxOfId = (id: string, s?: Summary): ProxTrack => ({ id, bpm: s?.bpm, camelot: s?.camelot, genre: s?.genre, harmony: s?.harmony, energyScale: s?.energyScale })

/** A transition's colour: the key's join colour, amber for a tempo jump. */
export const gapTone = (j: Join) => (j.kind !== 'clash' && isRough(j) ? 'var(--color-warning)' : joinColor(j))

/** A transition in words: the rough kind, else the key move. */
export const gapName = (j: Join) => (isRough(j) ? roughLabel(j) : j.kindLabel ?? 'Key not known')

// Transitions the mixer kept ("Keep it as is"), as item-id pairs; one store so every view agrees.
const KEPT = 'sestudio.keptJoins.queue'
let kept: ReadonlySet<string> = (() => { try { return new Set<string>(JSON.parse(localStorage.getItem(KEPT) ?? '[]')) } catch { return new Set<string>() } })()
const keptListeners = new Set<() => void>()
const keepPair = (key: string) => {
  kept = new Set(kept).add(key)
  try { localStorage.setItem(KEPT, JSON.stringify([...kept])) } catch { /* private mode: kept for this session */ }
  keptListeners.forEach(l => l())
}
const pairKey = (a: QueueItem, b: QueueItem) => `${a.item_id}>${b.item_id}`

/** The queue's transitions (null while a side is unread), the rough ones still to play, and Keep. */
export function useQueueGaps(q: QueueState) {
  const key = q.items.map(i => i.track_id).join()
  const ids = useMemo(() => q.items.map(i => i.track_id), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const { get, v } = useSummaries(ids)
  const keptNow = useSyncExternalStore(l => { keptListeners.add(l); return () => keptListeners.delete(l) }, () => kept)
  const gaps = useMemo(() => q.items.slice(1).map((b, i): Gap | null => {
    const a = q.items[i]
    const sa = get(a.track_id)
    const sb = get(b.track_id)
    if (!sa || !sb) return null
    const j = join(proxOfId(a.track_id, sa), proxOfId(b.track_id, sb))
    if (j.kind === null && j.bpmDelta === null) return null
    return { at: i + 1, join: j, rough: isRough(j) && !keptNow.has(pairKey(a, b)) }
  }), [q.items, v, keptNow]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = q.current
  const rough = useMemo(() => gaps.filter((g): g is Gap => !!g && g.rough && g.at > cur), [gaps, cur])
  return {
    gap: (at: number) => gaps[at - 1] ?? null,
    rough,
    keep: (at: number) => { if (q.items[at]) keepPair(pairKey(q.items[at - 1], q.items[at])) },
  }
}
