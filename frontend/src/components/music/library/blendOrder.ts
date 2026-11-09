import { useEffect, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { toast } from '../toast'
import type { Shape } from './tapeLayout'

// Best blend (SPEC-music-library §2.7): the server orders a list for a shape, pins kept, and
// says how every join blends. With every track pinned it only reads the joins (Your order).

export interface Join {
  mark: 'smooth' | 'close' | 'rough'
  blend: number
  /** "clash", "tempo", "energy". */
  problems: string[]
}

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
  const key = tracks ? `${shape}|${tracks.map(t => t.id).join(',')}|${JSON.stringify(pins)}` : ''
  useEffect(() => {
    if (!tracks) return
    if (tracks.length < 2) {
      setOut({ key, result: { tracks, joins: [], score: 100, rough: 0 } }) // eslint-disable-line react-hooks/set-state-in-effect -- nothing to ask
      return
    }
    const byId = new Map(tracks.map(t => [t.id, t]))
    const ctrl = new AbortController()
    fetch('/api/music/set/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: tracks.map(t => t.id), pins, shape }), signal: ctrl.signal })
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
