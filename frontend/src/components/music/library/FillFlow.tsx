import { useEffect, useRef, useState } from 'react'
import { useFlows, type Flow } from '../../../musicFlows'
import { playlistApi, type PlaylistNode } from '../../../musicPlaylists'
import ResponsiveModal from '../../ResponsiveModal'
import { fillFrom } from './playlistEdit'

// "Fill from a flow" (SPEC-blend-playlists §3.1 D2): pick a flow and a length, see the tracks it
// would add as dashed rows (the server's dry run), and Add them. A popover on a wide screen,
// a bottom sheet on a phone. `onPreview` hands the board what to draw before anything is saved.

export interface FillPreview { flow: Flow; ids: string[]; useShape: boolean }

const LENGTHS = [[15, '15 min'], [30, '30 min'], [60, '1 h']] as const

export default function FillFlow({ node, wide, avgSecs, onPreview, onClose }: {
  node: PlaylistNode
  wide: boolean
  /** Average track length of the playlist, for "≈ n tracks". */
  avgSecs: number
  onPreview: (p: FillPreview | null) => void
  onClose: () => void
}) {
  const { flows } = useFlows()
  const [flowId, setFlowId] = useState<string>()
  const [minutes, setMinutes] = useState<number>(30)
  const [useShape, setUseShape] = useState(true)
  const [ids, setIds] = useState<string[] | null>(null)
  const pop = useRef<HTMLDivElement>(null)
  // Opened under the chip in a scrolling column: bring the whole popover (and its Add button) into view.
  useEffect(() => { if (wide) pop.current?.scrollIntoView({ block: 'nearest' }) }, [wide, ids?.length, flowId])
  const flow = flows.find(f => f.id === (flowId ?? flows[0]?.id))
  // How many tracks each flow could add: asked once when the popover opens, kept while it is open.
  const [fits, setFits] = useState<Record<string, number>>()
  useEffect(() => {
    let live = true
    playlistApi.fillFits(node.id).then(r => { if (live) setFits(r) }, () => {})
    return () => { live = false }
  }, [node.id])

  // The dry run, again when the flow or the length changes.
  useEffect(() => {
    if (!flow) return
    let live = true
    setIds(null) // eslint-disable-line react-hooks/set-state-in-effect -- a new question: the old answer is stale
    playlistApi.fillPreview(node.id, { flow: flow.id, minutes, use_shape: useShape }).then(r => { if (live) setIds(r.candidates) }, () => { if (live) setIds([]) })
    return () => { live = false }
  }, [node.id, flow, minutes, useShape])
  useEffect(() => { onPreview(flow && ids ? { flow, ids, useShape } : null) }, [flow, ids, useShape]) // eslint-disable-line react-hooks/exhaustive-deps -- onPreview is the board's setter
  useEffect(() => () => onPreview(null), []) // eslint-disable-line react-hooks/exhaustive-deps -- the preview goes with the popover

  const approx = (m: number) => Math.max(1, Math.round((m * 60) / (avgSecs || 240)))
  const add = () => { if (flow && ids?.length) { void fillFrom(node, flow, minutes, useShape); onClose() } }
  const body = (
    <div className="flex flex-col gap-3 text-xs">
      <h4 className="text-sm font-semibold">Fill from a flow</h4>
      {!flows.length ? <p className="text-base-content/60">No flows yet. Make one in the Flows tab.</p> : (
        <fieldset className="flex max-h-44 flex-col overflow-y-auto">
          <legend className="sr-only">Flow</legend>
          {flows.map(f => (
            <label key={f.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 ${wide ? 'min-h-9' : 'min-h-11'} hover:bg-white/5 ${f.id === flow?.id ? 'bg-primary/12' : ''}`}>
              <input type="radio" name="fill-flow" className="radio radio-xs radio-primary" checked={f.id === flow?.id} onChange={() => setFlowId(f.id)} />
              <span className="min-w-0 flex-1 py-1 leading-tight">
                <span className="block truncate text-[13px]">{f.name}</span>
                {fits && <span className="block text-[11px] text-base-content/55">{fits[f.id] ?? 0} {fits[f.id] === 1 ? 'track fits' : 'tracks fit'}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex gap-1.5" role="group" aria-label="Length">
        {LENGTHS.map(([m, label]) => (
          <button key={m} onClick={() => setMinutes(m)} aria-pressed={m === minutes} className={`flex-1 rounded-xl px-2 py-1.5 text-center ${m === minutes ? 'bg-primary text-primary-content' : 'bg-black/25 hover:bg-black/35'}`}>
            <b className="block font-semibold">{label}</b><span className="text-[11px] opacity-70">≈ {approx(m)} tracks</span>
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        Use its shape for the whole order
        <input type="checkbox" role="switch" className="toggle toggle-sm toggle-primary" checked={useShape} onChange={e => setUseShape(e.target.checked)} />
      </label>
      <div className="flex items-center justify-end gap-2">
        {ids && !ids.length && <span className="mr-auto text-base-content/60">No track fits.</span>}
        <button onClick={onClose} className={`btn btn-ghost btn-sm rounded-xl ${wide ? '' : 'h-11 min-h-0'}`}>Cancel</button>
        <button onClick={add} disabled={!ids?.length} className={`btn btn-primary btn-sm rounded-xl ${wide ? '' : 'h-11 min-h-0 flex-1'}`}>{ids ? `Add ${ids.length} ${ids.length === 1 ? 'track' : 'tracks'}` : 'Reading…'}</button>
      </div>
    </div>
  )
  return wide
    ? <div ref={pop} className="absolute right-0 top-full z-30 mt-1 w-80 rounded-xl bg-base-300 p-3 shadow-xl ring-1 ring-white/10" role="dialog" aria-label="Fill from a flow">{body}</div>
    : <ResponsiveModal onClose={onClose}>{body}</ResponsiveModal>
}
