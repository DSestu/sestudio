import { useEffect, useState } from 'react'
import type { MusicTrack } from '../../../../musicLibrary'
import { itemsOf, locate, playlistApi, type PlaylistNode } from '../../../../musicPlaylists'
import { toast } from '../../toast'
import { fetchBridgePath, fetchJoin } from '../harmonyApi'
import type { Slot } from './join'
import Result from './Result'
import Seg from './Seg'
import { closeBuildSet } from './store'

type Found = { key: string; slots: Slot[] | null; error?: string }

/** "Fill a gap": pick a clashing join of the open set and fill it with 1 to 3 tracks that fit both sides. */
export default function GapWay({ node, byId }: { node?: PlaylistNode; byId: ReadonlyMap<string, MusicTrack> }) {
  const items = node ? itemsOf(node) : []
  const key = items.map(i => i.item_id).join(',')
  const [clashes, setClashes] = useState<{ at: number; key: string }[]>()
  const [at, setAt] = useState<number>()
  const [steps, setSteps] = useState(1)
  const [found, setFound] = useState<Found>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all(items.slice(1).map((it, i) => fetchJoin(items[i].track_id, it.track_id))).then(joins => {
      if (live) setClashes(joins.flatMap((j, i) => (j.kind === 'clash' ? [{ at: i, key }] : [])))
    }, () => live && setClashes([]))
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const a = at === undefined ? undefined : items[at]
  const b = at === undefined ? undefined : items[at + 1]
  const fillKey = a && b ? `${a.item_id}|${b.item_id}|${steps}|${key}` : ''
  useEffect(() => {
    if (!a || !b) return
    let live = true
    fetchBridgePath(a.track_id, b.track_id, { steps, exclude: items.map(i => i.track_id) }).then(async ({ path }) => {
      if (!path) return live && setFound({ key: fillKey, slots: null })
      const ids = [a.track_id, ...path, b.track_id]
      const joins = await Promise.all(ids.slice(1).map((id, i) => fetchJoin(ids[i], id)))
      if (live) setFound({ key: fillKey, slots: ids.map((id, i) => ({ id, join: i ? joins[i - 1] : null })) })
    }, (e: Error) => live && setFound({ key: fillKey, slots: null, error: e.message }))
    return () => { live = false }
  }, [fillKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!node) return <p className="py-6 text-center text-sm text-base-content/60">Open a playlist or set, then pick Build a set there to fill one of its gaps.</p>
  if (!clashes) return <p className="py-6 text-center text-sm text-base-content/60">Checking the joins…</p>

  const title = (i: number) => byId.get(items[i].track_id)?.title ?? 'Unknown'
  const cur = found?.key === fillKey ? found : undefined
  const insert = () => {
    const between = cur!.slots!.slice(1, -1).flatMap(s => byId.get(s.id) ?? []).map(t => ({ library: t.library, track_id: t.id }))
    const loc = locate(node, a!.item_id)!
    setBusy(true)
    playlistApi.add(node.id, between, loc.part ?? undefined, loc.index + 1).then(
      () => { closeBuildSet(); toast(`Filled the gap with ${between.length} ${between.length === 1 ? 'track' : 'tracks'}`) },
      (e: Error) => { setBusy(false); window.alert(e.message) },
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="text-xs text-base-content/60">Clashing joins in {node.name}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Clashing joins">
        {clashes.map(c => (
          <button key={c.at} onClick={() => setAt(c.at)} aria-pressed={at === c.at} className={`btn btn-xs rounded-full max-w-full ${at === c.at ? 'btn-primary' : 'btn-ghost border-white/15'}`}>
            <span className="truncate">{title(c.at)} → {title(c.at + 1)}</span>
          </button>
        ))}
        {!clashes.length && <span className="text-sm text-base-content/60">No clash left. Nice.</span>}
      </div>
      {a && b && (
        <>
          <div className="flex items-center gap-2 text-xs text-base-content/60">Fill with
            <Seg label="Tracks to add" options={[[1, '1 track'], [2, '2 tracks'], [3, '3 tracks']]} value={steps} onPick={setSteps} />
          </div>
          {cur?.error && <p className="text-sm text-error">{cur.error}</p>}
          {!cur && <p className="py-6 text-center text-sm text-base-content/60">Looking for tracks…</p>}
          {cur && !cur.slots && !cur.error && <p className="py-4 text-center text-sm">No safe fill with {steps} {steps > 1 ? 'tracks' : 'track'}. Try more.</p>}
          {cur?.slots && (
            <Result
              slots={cur.slots}
              byId={byId}
              stats={{ duration: cur.slots.reduce((s, x) => s + (byId.get(x.id)?.duration ?? 0), 0), clashes: cur.slots.filter(s => s.join?.kind === 'clash').length, tempoJumps: cur.slots.filter(s => s.join?.tempoJump).length }}
            >
              <button onClick={insert} disabled={busy || cur.slots.length < 3} className="btn btn-primary btn-sm">Insert into {node.name}</button>
            </Result>
          )}
        </>
      )}
    </div>
  )
}
