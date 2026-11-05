import { useEffect, useState } from 'react'
import type { MusicTrack } from '../../../../musicLibrary'
import { fetchBridgePath, fetchJoin } from '../harmonyApi'
import Apply from './Apply'
import type { Slot } from './join'
import Result from './Result'
import Seg from './Seg'
import { updateBuild } from './store'
import TrackPicker from './TrackPicker'

type Found = { key: string; path: string[] | null; slots: Slot[]; error?: string }

/** "Bridge two tracks": the smoothest path from one track to another, 1 to 3 tracks between. */
export default function BridgeWay({ from, byId }: { from?: string; byId: ReadonlyMap<string, MusicTrack> }) {
  const [to, setTo] = useState<string>()
  const [steps, setSteps] = useState(1)
  const [pick, setPick] = useState<'from' | 'to' | undefined>(from ? undefined : 'from')
  const [found, setFound] = useState<Found>()
  const key = from && to ? `${from}|${to}|${steps}` : ''

  useEffect(() => {
    if (!from || !to) return
    let live = true
    fetchBridgePath(from, to, { steps }).then(async ({ path }) => {
      const ids = path ? [from, ...path, to] : []
      const joins = await Promise.all(ids.slice(1).map((id, i) => fetchJoin(ids[i], id)))
      if (live) setFound({ key, path, slots: ids.map((id, i) => ({ id, join: i ? joins[i - 1] : null })) })
    }, (e: Error) => live && setFound({ key, path: null, slots: [], error: e.message }))
    return () => { live = false }
  }, [from, to, steps, key])

  const cur = found?.key === key ? found : undefined
  const name = (id?: string) => (id && byId.get(id)?.title) || 'pick'
  const chip = (which: 'from' | 'to', id?: string) => (
    <button onClick={() => setPick(p => (p === which ? undefined : which))} aria-pressed={pick === which} className={`btn btn-xs rounded-full max-w-48 ${pick === which ? 'btn-primary' : 'btn-ghost border-white/15'}`}>
      <span className="truncate">{which === 'from' ? 'From' : 'To'}: {name(id)}</span>
    </button>
  )
  const slots = cur?.slots ?? []
  const stats = {
    duration: slots.reduce((s, x) => s + (byId.get(x.id)?.duration ?? 0), 0),
    clashes: slots.filter(s => s.join?.kind === 'clash').length,
    tempoJumps: slots.filter(s => s.join?.tempoJump).length,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {chip('from', from)}<span aria-hidden="true">→</span>{chip('to', to)}
        <span className="ml-auto flex items-center gap-2 text-xs text-base-content/60">Tracks between
          <Seg label="Tracks between" options={[[1, '1'], [2, '2'], [3, '3']]} value={steps} onPick={setSteps} />
        </span>
      </div>
      {pick ? (
        <TrackPicker byId={byId} value={pick === 'from' ? from : to} onPick={id => { if (pick === 'from') updateBuild({ seed: id }); else setTo(id); setPick(pick === 'from' && !to ? 'to' : undefined) }} />
      ) : from && to ? (
        cur?.error ? <p className="text-sm text-error">{cur.error}</p>
        : !cur ? <p className="py-6 text-center text-sm text-base-content/60">Looking for a path…</p>
        : !cur.path ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium">No safe path with {steps} {steps > 1 ? 'tracks' : 'track'} between.</p>
            <p className="text-xs text-base-content/60">Try more tracks between.</p>
          </div>
        ) : (
          <Result slots={cur.slots} byId={byId} stats={stats}>
            {cur.path.length === 0 && <span className="mr-auto text-xs text-base-content/60">These two already join safely.</span>}
            <Apply ids={cur.slots.map(s => s.id)} byId={byId} />
          </Result>
        )
      ) : null}
    </div>
  )
}
