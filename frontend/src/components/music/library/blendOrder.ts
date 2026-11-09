import { useEffect, useMemo, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { toast } from '../toast'
import { useBlendWeights, type Move } from '../../../musicBlendWeights'
import type { Shape } from './tapeLayout'

// Best blend (SPEC-music-library §2.7): the server orders a list for a shape, pins kept, and
// says how every join blends. With every track pinned it only reads the joins (Your order).

export interface Join {
  mark: 'smooth' | 'close' | 'rough'
  blend: number
  /** "clash", "tempo", "energy". */
  problems: string[]
  kind?: string | null
  /** The server's move: same-key, pivot, next-door, modal-shift, lift, drop, clash. */
  move?: string | null
  kindLabel?: string | null
  /** Notes the two scales share. */
  shared?: number | null
  bpmDelta?: number | null
  genreChange?: boolean
  energy?: { delta: number | null }
}

/** Lift, Hold or Ease: where the energy goes across a join. */
export const leanOf = (j: Join) => { const d = j.energy?.delta ?? 0; return d > 6 ? 'Lift' : d < -6 ? 'Ease' : 'Hold' }

export interface BlendResult {
  tracks: MusicTrack[]
  joins: Join[]
  /** Mean blend of the joins, 0..100. */
  score: number
  rough: number
}

export const BLEND_CAP = 160

/** Every index pinned: the order stays, the server only reads its joins. */
export const keepOrder = (ts: MusicTrack[]): Record<number, string> => Object.fromEntries(ts.map((t, i) => [i, t.id]))

/** The server's order of `tracks` for `shape` with `pins`; undefined while it works or when off. */
export function useBlendOrder(tracks: MusicTrack[] | undefined, shape: Shape, pins: Record<number, string> = {}): BlendResult | undefined {
  const [out, setOut] = useState<{ key: string; result: BlendResult }>()
  const { importance, welcome } = useBlendWeights()
  const key = tracks ? `${shape}|${tracks.map(t => t.id).join(',')}|${JSON.stringify(pins)}|${JSON.stringify(importance)}|${JSON.stringify(welcome)}` : ''
  useEffect(() => {
    if (!tracks) return
    if (tracks.length < 2) {
      setOut({ key, result: { tracks, joins: [], score: 100, rough: 0 } }) // eslint-disable-line react-hooks/set-state-in-effect -- nothing to ask
      return
    }
    const byId = new Map(tracks.map(t => [t.id, t]))
    const ctrl = new AbortController()
    fetch('/api/music/set/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: tracks.map(t => t.id), pins, shape, weights: importance, harmony: welcome }), signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`order: ${r.status}`))))
      .then((res: { order: string[]; joins: Join[] }) => {
        const ordered = res.order.map(id => byId.get(id)).filter((t): t is MusicTrack => !!t)
        const score = res.joins.length ? Math.round((res.joins.reduce((s, j) => s + j.blend, 0) / res.joins.length) * 100) : 100
        setOut({ key, result: { tracks: ordered, joins: res.joins, score, rough: res.joins.filter(j => j.mark === 'rough').length } })
      })
      .catch((e: Error) => { if (e.name !== 'AbortError') toast(e.message) })
    return () => ctrl.abort()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` names the request
  return out?.key === key ? out.result : undefined
}

/** The set as shown (Your order, or Best blend around the pins) and its joins, asked once for the lane and the list. */
export function useSetOrder(s: { tracks: MusicTrack[]; pinned: string[]; mode: 'mine' | 'blend'; shape: Shape }) {
  const blend = s.mode === 'blend'
  const pins = useMemo(
    () => (blend ? Object.fromEntries(s.tracks.flatMap((t, i) => (s.pinned.includes(t.id) ? [[i, t.id]] : []))) : keepOrder(s.tracks)),
    [blend, s.tracks, s.pinned],
  )
  const res = useBlendOrder(s.tracks, s.shape, pins)
  const shown = res?.tracks ?? s.tracks
  return { res, shown, joins: res && res.tracks === shown ? res.joins : undefined }
}


interface Effect { score?: number; clashes: number; transposed: number; genreChanges: number; counts: Partial<Record<Move, number>> }

/** What the set's joins add up to under the current weights. */
export function effectOf(joins: Join[] | undefined, score: number | undefined): Effect {
  const counts: Partial<Record<Move, number>> = {}
  for (const j of joins ?? []) if (j.move) counts[j.move as Move] = (counts[j.move as Move] ?? 0) + 1
  return {
    score,
    clashes: counts.clash ?? 0,
    transposed: (counts.lift ?? 0) + (counts.drop ?? 0),
    genreChanges: (joins ?? []).filter(j => j.genreChange).length,
    counts,
  }
}
