import { useMemo, useState, type CSSProperties } from 'react'
import { patchParams, type Navigate } from '../../../nav'
import { useModalBack } from '../../../useModalBack'
import ResponsiveModal from '../../ResponsiveModal'
import FlowColumn from './FlowColumn'
import { flowApi, flowColor, newFlow, rowOf, useAllTracks, useFlows, type Flow } from './flows'
import Picker from './Picker'

const MODES: [Flow['mode'], string][] = [['mix', 'Mixes side by side'], ['branch', 'Branches from one set']]
const NOUN = { mix: 'mix', branch: 'branch' } as const

const run = (p: Promise<unknown>) => { p.catch(e => window.alert((e as Error).message)) }

/**
 * The mix builder (master plan E5): a picker beside parallel flows, on a screen of its own.
 * Desktop keeps the nav rail and shows every flow as a column; a phone has no tab bar,
 * shows one flow at a time and opens the picker from the bar at the bottom.
 */
export default function MixBuilder({ params, navigate }: { params: URLSearchParams; navigate: Navigate }) {
  const { flows, loaded } = useFlows()
  const { all, byId, get, v } = useAllTracks()
  const [mode, setMode] = useState<Flow['mode']>(() => {
    const fromFlow = flows.find(f => f.id === params.get('f'))?.mode
    return fromFlow ?? (params.get('mode') === 'branch' ? 'branch' : 'mix')
  })
  const [act, setAct] = useState(params.get('f') ?? '')
  const [sheet, setSheet] = useState(false)
  useModalBack(sheet, () => setSheet(false))

  const shown = flows.filter(f => f.mode === mode)
  const active = shown.find(f => f.id === act) ?? shown[0]
  const rowsOf = useMemo(
    () => (f: Flow) => f.items.map(r => rowOf(r, byId, get)),
    [byId, v], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const pick = (id: string) => { setAct(id); patchParams({ f: id }) }
  const create = () => run(newFlow(mode).then(f => pick(f.id)))
  const switchMode = (m: Flow['mode']) => { setMode(m); setAct(''); patchParams({ mode: m, f: undefined }) }

  return (
    <div className="fixed inset-0 z-50 md:z-30 md:left-27 flex flex-col bg-base-100 md:pb-[var(--music-bar,0rem)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 md:px-5 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:pt-4 border-b border-white/8">
        <button onClick={() => navigate('music')} aria-label="Back to Music" className="btn btn-ghost btn-circle btn-sm">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 className="text-base font-semibold mr-auto">Mix builder</h1>
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
          <Picker all={all} get={get} />
        </aside>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
                  onActive={() => pick(f.id)}
                  onRename={name => run(flowApi.patch(f.id, { name }))}
                  onDelete={() => run(flowApi.remove(f.id))}
                />
              </div>
            ))}
            {shown.length > 0 && (
              <button onClick={create} className="hidden md:flex shrink-0 w-40 h-14 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/20 text-sm text-base-content/70 hover:bg-white/5">
                + New {NOUN[mode]}
              </button>
            )}
          </div>
          <div className="md:hidden px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button onClick={() => setSheet(true)} className="input input-bordered w-full justify-start text-base-content/60">Search tracks to add…</button>
          </div>
        </div>
      </div>

      {sheet && (
        <ResponsiveModal onClose={() => setSheet(false)} boxClassName="h-[80dvh] flex flex-col p-0">
          <Picker all={all} get={get} />
        </ResponsiveModal>
      )}
    </div>
  )
}
