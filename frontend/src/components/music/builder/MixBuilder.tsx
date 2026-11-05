import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { itemsOf, playlistApi, usePlaylists } from '../../../musicPlaylists'
import { patchParams, type Navigate } from '../../../nav'
import { useModalBack } from '../../../useModalBack'
import ResponsiveModal from '../../ResponsiveModal'
import FlowColumn from './FlowColumn'
import { dropped, flowApi, flowColor, inserted, newFlow, refOf, refsOf, rowOf, useAllTracks, useFlows, type Flow, type FlowRef } from './flows'
import Picker from './Picker'
import { ForkLine, SetChooser, TrunkBar } from './Trunk'

const MODES: [Flow['mode'], string][] = [['mix', 'Mixes side by side'], ['branch', 'Branches from one set']]
const NOUN = { mix: 'mix', branch: 'branch' } as const

const run = (p: Promise<unknown>) => { p.catch(e => window.alert((e as Error).message)) }

/**
 * The mix builder (master plan E5): a picker beside parallel flows, on a screen of its own.
 * Desktop keeps the nav rail and shows every flow as a column; a phone has no tab bar,
 * shows one flow at a time and opens the picker from the bar at the bottom.
 * In branch mode the flows are alternative continuations of one set (the trunk).
 */
export default function MixBuilder({ params, navigate }: { params: URLSearchParams; navigate: Navigate }) {
  const { flows, loaded } = useFlows()
  const { all, byId, get, v } = useAllTracks()
  const playlists = usePlaylists()
  const [mode, setMode] = useState<Flow['mode']>(() => {
    const fromFlow = flows.find(f => f.id === params.get('f'))?.mode
    return fromFlow ?? (params.get('mode') === 'branch' ? 'branch' : 'mix')
  })
  const [act, setAct] = useState(params.get('f') ?? '')
  const [sheet, setSheet] = useState(false)
  useModalBack(sheet, () => setSheet(false))

  // Branch mode works on one set at a time: the one picked, else the active branch's, else the first branch's.
  const branches = flows.filter(f => f.mode === 'branch')
  const [chosen, setChosen] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const base = chosen ?? branches.find(f => f.id === act)?.base ?? branches[0]?.base ?? null
  const trunkNode = base ? playlists.find(n => n.id === base) : undefined
  const trunk = useMemo(() => refsOf(trunkNode ? itemsOf(trunkNode) : []), [trunkNode])
  const picking = mode === 'branch' && (choosing || branches.length === 0)

  const shown = mode === 'mix' ? flows.filter(f => f.mode === 'mix') : branches.filter(f => (f.base ?? null) === base)
  const active = shown.find(f => f.id === act) ?? shown[0]
  const rowsOf = useMemo(
    () => (f: Flow) => f.items.map(r => rowOf(r, byId, get)),
    [byId, v], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const trunkRows = useMemo(
    () => trunk.map(r => rowOf(r, byId, get)),
    [trunk, byId, v], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const forkRow = mode === 'branch' ? trunkRows.at(-1) : undefined

  const activeRows = active ? rowsOf(active) : []
  const pickerProps = {
    tail: activeRows.at(-1) ?? forkRow,
    flowName: active?.name,
    flowColor: active ? flowColor(shown.indexOf(active)) : undefined,
    used: useMemo(() => new Set([...flows.flatMap(f => f.items), ...trunk].map(r => r.track_id)), [flows, trunk]),
  }

  // A drag runs outside React: what is dragged is kept here, where it would land is state.
  const drag = useRef<{ ref: FlowRef; from?: string } | null>(null)
  const [over, setOver] = useState<{ flow: string; at: number } | null>(null)
  const endDrag = () => { drag.current = null; setOver(null) }
  const place = (flow: string, at?: number) => {
    const d = drag.current
    if (!d) return
    const lists = Object.fromEntries(flows.map(f => [f.id, f.items]))
    for (const [id, items] of Object.entries(dropped(lists, d.ref, flow, at, d.from))) run(flowApi.patch(id, { items }))
    pick(flow)
    endDrag()
  }
  const add = (t: MusicTrack) => {
    if (!active) return
    run(flowApi.patch(active.id, { items: inserted(active.items, refOf(t)) }))
  }

  const pick = (id: string) => { setAct(id); patchParams({ f: id }) }
  const create = () => run(newFlow(mode, mode === 'branch' ? { base, fork: trunk.at(-1) ?? null } : {}).then(f => pick(f.id)))
  const switchMode = (m: Flow['mode']) => { setMode(m); setAct(''); setChoosing(false); patchParams({ mode: m, f: undefined }) }
  const branchFrom = (id: string) => {
    setChosen(id)
    setChoosing(false)
    const node = playlists.find(n => n.id === id)
    const fork = (node ? refsOf(itemsOf(node)) : []).at(-1) ?? null
    if (!branches.some(f => f.base === id)) run(newFlow('branch', { base: id, fork }).then(f => pick(f.id)))
    else setAct('')
  }
  // Keep a branch: its tracks join the set, the fork moves to the last, and every branch starts over from there.
  const keep = (f: Flow) => {
    if (!base || !f.items.length) return
    const fork = f.items.at(-1)!
    run(playlistApi.add(base, f.items).then(() => Promise.all(shown.map(b => flowApi.patch(b.id, { items: [], fork })))).then(() => pick(f.id)))
  }

  // A flow becomes a set (a branch with the trunk before it) and the set opens.
  const save = () => {
    if (!active?.items.length) return
    const name = mode === 'branch' && trunkNode ? `${trunkNode.name} · ${active.name}` : active.name
    run(playlistApi.create('playlist', name)
      .then(n => playlistApi.add(n.id, mode === 'branch' ? [...trunk, ...active.items] : active.items))
      .then(n => navigate('music', { pl: n.id })))
  }

  return (
    <div onDragEnd={endDrag} className="fixed inset-0 z-50 md:z-30 md:left-27 flex flex-col bg-base-100 md:pb-[var(--music-bar,0rem)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 md:px-5 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:pt-4 border-b border-white/8">
        <button onClick={() => navigate('music')} aria-label="Back to Music" className="btn btn-ghost btn-circle btn-sm">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 className="text-base font-semibold mr-auto">Mix builder</h1>
        {active && !picking && (
          <button onClick={save} disabled={!active.items.length} className="hidden md:inline-flex btn btn-primary btn-sm rounded-xl max-w-64">
            <span className="truncate">Save {active.name} as a set</span>
          </button>
        )}
        <div role="group" aria-label="Mode" className="flex rounded-full bg-white/6 p-0.5 text-xs">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-full px-3 h-7 font-medium ${mode === m ? 'bg-primary/20 text-primary' : 'text-base-content/70'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside aria-label="Picker" className="hidden md:flex flex-col min-h-0 w-88 shrink-0 border-r border-white/8">
          <Picker all={all} get={get} {...pickerProps} onAdd={add} onDragStart={t => { drag.current = { ref: refOf(t) } }} />
        </aside>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {picking ? (
            <SetChooser sets={playlists.filter(n => n.kind === 'playlist')} onPick={s => branchFrom(s.id)} />
          ) : (
            <>
              {mode === 'branch' && <TrunkBar name={trunkNode?.name ?? 'Set'} rows={trunkRows} onChange={() => setChoosing(true)} />}
              {mode === 'branch' && <ForkLine fork={forkRow} before={Math.max(trunkRows.length - 1, 0)} onChange={() => setChoosing(true)} />}
              <div role="group" aria-label="Flows" className="md:hidden flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
                {shown.map((f, i) => (
                  <button
                    key={f.id}
                    aria-pressed={f.id === active?.id}
                    onClick={() => pick(f.id)}
                    style={{ '--lc': flowColor(i) } as CSSProperties}
                    className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium ${f.id === active?.id ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70'}`}
                  >
                    <i aria-hidden="true" className="size-2 rounded-full bg-(--lc)" />{f.name} · {f.items.length}
                  </button>
                ))}
                <button onClick={create} aria-label={`New ${NOUN[mode]}`} className="shrink-0 rounded-full px-3 h-8 text-xs bg-white/6">+</button>
              </div>
              <div className="flex-1 min-h-0 flex gap-3 md:overflow-x-auto p-3 md:p-4">
                {loaded && shown.length === 0 && (
                  <p className="m-auto text-sm text-base-content/60 text-center">
                    No {NOUN[mode]} yet.<br />
                    <button onClick={create} className="btn btn-primary btn-sm mt-3 rounded-xl">New {NOUN[mode]}</button>
                  </p>
                )}
                {shown.map((f, i) => (
                  <div key={f.id} className={`min-h-0 w-full md:w-auto ${f.id === active?.id ? 'flex' : 'hidden md:flex'}`}>
                    <FlowColumn
                      flow={f}
                      color={flowColor(i)}
                      rows={rowsOf(f)}
                      active={f.id === active?.id}
                      over={over?.flow === f.id ? over.at : null}
                      fork={forkRow}
                      onKeep={mode === 'branch' ? () => keep(f) : undefined}
                      onActive={() => pick(f.id)}
                      onRename={name => run(flowApi.patch(f.id, { name }))}
                      onDelete={() => run(flowApi.remove(f.id))}
                      onRemove={i => run(flowApi.patch(f.id, { items: f.items.filter((_, j) => j !== i) }))}
                      onDragStart={ref => { drag.current = { ref, from: f.id } }}
                      onOver={at => {
                        if (at === null || !drag.current) { setOver(null); return false }
                        setOver(o => (o?.flow === f.id && o.at === at ? o : { flow: f.id, at }))
                        return true
                      }}
                      onDrop={at => place(f.id, at)}
                    />
                  </div>
                ))}
                {shown.length > 0 && (
                  <button onClick={create} className="hidden md:flex shrink-0 w-40 h-14 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/20 text-sm text-base-content/70 hover:bg-white/5">
                    + New {NOUN[mode]}
                  </button>
                )}
              </div>
            </>
          )}
          <div className="md:hidden flex gap-2 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button onClick={() => setSheet(true)} className="input input-bordered flex-1 min-w-0 justify-start text-base-content/60">Search tracks to add…</button>
            {active && !picking && (
              <button onClick={save} disabled={!active.items.length} aria-label={`Save ${active.name} as a set`} className="btn btn-primary btn-square">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {sheet && (
        <ResponsiveModal onClose={() => setSheet(false)} boxClassName="h-[80dvh] flex flex-col p-0">
          <Picker all={all} get={get} {...pickerProps} onAdd={add} onDragStart={() => {}} />
        </ResponsiveModal>
      )}
    </div>
  )
}
