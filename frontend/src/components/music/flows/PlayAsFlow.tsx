import { useEffect, useRef, useState } from 'react'
import { type Source, type Then, setSources, thenFor } from '../../../flowSources'
import { DIAL_NAME, playFlow, useFlows, type Flow, type Slot } from '../../../musicFlows'
import type { MusicTrack } from '../../../musicLibrary'
import AddSource from './AddSource'
import { Shape } from './FlowRow'
import { preview } from './flowPreview'
import { SourceChip } from './FromBar'

// Play as a flow (SPEC-flows-tab §2): an album, an artist or a library played along a shape,
// beside Play and Shuffle. A popover under its button on desktop, a sheet on a phone.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }
const same = (a: Source, b: Source) => a.kind === b.kind && a.value.toLowerCase() === b.value.toLowerCase()

function Panel({ name, start, byId, onClose, onFlows }: {
  name: string; start: Source; byId?: Map<string, MusicTrack>; onClose: () => void; onFlows: () => void
}) {
  const { flows } = useFlows()
  const starters = flows.filter(f => f.preset).reverse()
  const mine = flows.filter(f => !f.preset && f.name !== DIAL_NAME)
  const [pick, setPick] = useState<string | null>(null)
  const flow: Flow | undefined = flows.find(f => f.id === pick) ?? starters.find(f => f.name === 'Peak') ?? starters[0] ?? mine[0]
  const [sources, setLocal] = useState<Source[]>([start])
  const [then, setThen] = useState<Then>(thenFor([start]))
  const [adding, setAdding] = useState(false)
  const [got, setGot] = useState<{ key: string; slots: Slot[] } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const scope = { sources: sources.map(({ kind, value, rule }) => ({ kind, value, rule })), then }
  const key = `${flow?.id}:${JSON.stringify(scope)}`

  useEffect(() => {
    if (!flow) return
    let live = true
    preview(flow.id, 1, scope).then(slots => { if (live) setGot({ key, slots }) }, () => {})
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- flow and scope are in key
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !adding) onClose() }
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      if (box.current && !box.current.contains(t) && !t.closest?.('[data-flow-toggle]')) onClose()
    }
    window.addEventListener('keydown', esc)
    window.addEventListener('pointerdown', down)
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('pointerdown', down) }
  }, [onClose, adding])

  const slots = got?.key === key ? got.slots : null
  const flip = (s: Source) => setLocal(list => list.map(x => (same(x, s) ? { ...x, rule: x.rule === 'only' ? 'lean' : 'only' } : x)))
  const remove = (s: Source) => setLocal(list => list.filter(x => !same(x, s)))
  const add = (s: Source) => setLocal(list => [...list.filter(x => !same(x, s)), s])
  const narrowed = sources.some(s => s.rule === 'only')
  const play = () => { if (flow) { run(playFlow(flow.id, { seed: 1, ...scope })); onClose() } }
  const shape = (f: Flow) => (
    <button key={f.id} aria-pressed={flow?.id === f.id} onClick={() => setPick(f.id)}
      className={`flex w-[92px] shrink-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left text-[12.5px] sm:w-auto sm:flex-1 ${flow?.id === f.id ? 'bg-base-300 font-semibold outline-[1.5px] outline-primary' : 'bg-base-100 hover:bg-base-300'}`}>
      <span className="truncate">{f.name}</span>
      <Shape flow={f} w={72} h={28} />
    </button>
  )
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 sm:hidden" aria-hidden="true" />
      <div
        ref={box} role="dialog" aria-label={`Play ${name} as a flow`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-2xl bg-base-200 p-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] text-left shadow-2xl outline-1 outline-white/10 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[34rem] sm:overflow-visible sm:rounded-2xl"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-base-300 sm:hidden" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold">Play <span className="max-sm:hidden">{name} </span>as a flow</h2>
        <div className="-mr-3.5 flex gap-2 overflow-x-auto pr-3.5 sm:mr-0 sm:overflow-visible sm:pr-0">{starters.map(shape)}</div>
        {mine.length > 0 && (
          <p className="-mt-1 text-xs text-base-content/50">
            or one of yours:{' '}
            {mine.slice(0, 4).map((f, i) => (
              <span key={f.id}>{i > 0 && ' · '}<button onClick={() => setPick(f.id)} className={`hover:text-base-content ${flow?.id === f.id ? 'font-semibold text-base-content' : ''}`}>{f.name}</button></span>
            ))}
          </p>
        )}
        <div className="relative flex flex-wrap items-center gap-2">
          <span className="w-12 text-xs text-base-content/55">From</span>
          {sources.map(s => <SourceChip key={`${s.kind}:${s.value}`} source={s} onFlip={() => flip(s)} onRemove={sources.length > 1 ? () => remove(s) : undefined} />)}
          <button data-source-toggle onClick={() => setAdding(a => !a)} aria-expanded={adding}
            className="h-8 rounded-lg px-3 text-[13px] text-base-content/70 outline-1 outline-dashed outline-base-content/20 hover:bg-white/5">+ Add</button>
          {adding && <AddSource onAdd={add} onClose={() => setAdding(false)} />}
        </div>
        {narrowed && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-12 text-base-content/55">Then</span>
            <div role="radiogroup" aria-label="When it runs out" className="flex rounded-lg bg-base-100 p-0.5 outline-1 outline-white/8">
              {([['stop', 'Stop when it runs out'], ['similar', 'Carry on with similar']] as [Then, string][]).map(([v, l]) => (
                <button key={v} role="radio" aria-checked={then === v} onClick={() => setThen(v)}
                  className={`rounded-md px-2.5 py-1 ${then === v ? 'bg-base-300 text-base-content' : 'text-base-content/60 hover:text-base-content'}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <div className="border-t border-white/7 pt-2.5">
          <p className="mb-1 text-xs text-base-content/45">Opens with</p>
          {!slots ? <span className="loading loading-dots loading-sm text-base-content/40" />
            : !slots.length ? <p className="text-sm text-base-content/55">Nothing here fits this shape.</p>
            : (
              <ol className="grid gap-x-5 sm:grid-cols-2">
                {slots.slice(0, 6).map((s, i) => {
                  const t = byId?.get(s.track_id)
                  return <li key={s.track_id} className={`truncate py-0.5 text-[13px] ${i >= 3 ? 'max-sm:hidden' : ''}`}>{t?.title ?? 'A track'}</li>
                })}
              </ol>
            )}
        </div>
        <div className="flex gap-2 sm:justify-end">
          <button className="btn btn-sm max-sm:h-11" onClick={() => { setSources(sources); onFlows() }}>Open in Flows</button>
          <button className="btn btn-primary btn-sm max-sm:h-11 max-sm:flex-1" disabled={!flow} onClick={play}>Play as {flow?.name ?? 'a flow'}</button>
        </div>
      </div>
    </>
  )
}

/** The button beside Play and Shuffle, and its panel. */
export default function PlayAsFlow({ name, source, byId, onFlows, className = '' }: {
  name: string; source: Source; byId?: Map<string, MusicTrack>; onFlows: () => void; className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <button data-flow-toggle aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`btn gap-2 ${open ? 'outline-[1.5px] outline-primary' : ''} ${className}`}>
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" className="shrink-0">
          <path d="M1 11 C7 11 9 4 21 3" fill="none" stroke="var(--fl-energy, oklch(82% 0.11 75))" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        <span className="max-sm:hidden">Play as a flow</span><span className="sm:hidden">Flow</span>
      </button>
      {open && <Panel name={name} start={source} byId={byId} onClose={() => setOpen(false)} onFlows={() => { setOpen(false); onFlows() }} />}
    </span>
  )
}
