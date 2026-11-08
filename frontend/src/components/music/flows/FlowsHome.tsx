import { useMemo, useState } from 'react'
import { DIAL_NAME, KINDS, dialFlow, playFlow, saveFlow, useFlows, type Flow } from '../../../musicFlows'
import { UNKNOWN_ARTIST, type MusicTrack } from '../../../musicLibrary'
import { useSummaries } from '../../../musicMeta'
import { useMusicQueue } from '../../../musicQueue'
import { EnergyLevel } from '../TrackMeta'
import { forgetShape } from './flowPreview'
import { openPlayer } from '../player'
import { scopeBody, useFlowSources } from '../../../flowSources'
import FlowRow, { Shape } from './FlowRow'
import FromBar from './FromBar'
import { fresh, toFlow } from './lanes'

// The Music tab's Flows (SPEC-flows-tab §2, board A · Shelf): the flow playing, Right now,
// your flows, the starters. One column; a row opens in place on what it would play.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }

/** The flow the queue plays, with where it is in it and what comes next. */
function Playing({ flow, byId }: { flow: Flow; byId: Map<string, MusicTrack> }) {
  const q = useMusicQueue()
  const cur = byId.get(q.items[q.current]?.track_id ?? '')
  const next = byId.get(q.items[q.current + 1]?.track_id ?? '')
  const event = q.items.slice(q.current + 1).find(i => i.flow?.event && !i.flow.event.realised)?.flow?.event
  const now = q.items.length ? (q.current + 0.5) / q.items.length : 0
  // The shape is what the queue really holds: each track's energy in order.
  const { get } = useSummaries(useMemo(() => q.items.map(i => i.track_id), [q.items]))
  const n = Math.max(1, q.items.length - 1)
  const played = q.items.flatMap((it, i) => { const e = get(it.track_id)?.energyScale?.track; return e == null ? [] : [[i / n, e / 100] as [number, number]] })
  const pts = played.length >= 2 ? played : null
  return (
    <section aria-label={`Playing ${flow.name}`} className="flex items-center gap-3.5 rounded-xl bg-primary/7 px-3.5 py-3 outline-1 outline-primary/50">
      <span className="hidden sm:block"><Shape flow={flow} pts={pts} w={220} h={46} now={now} /></span>
      <span className="sm:hidden"><Shape flow={flow} pts={pts} w={96} h={38} now={now} /></span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-xs text-primary">Playing</p>
        <p className="truncate font-semibold">{flow.name}</p>
        <p className="truncate text-[13px] text-base-content/65">
          {cur ? `${cur.title}${cur.artist && cur.artist !== UNKNOWN_ARTIST ? ` · ${cur.artist}` : ''}` : ''}
          <span className="max-sm:hidden">{next ? ` — next: ${next.title}` : ''}{event ? `, then ${(KINDS[event.kind] ?? event.kind).toLowerCase()}` : ''}</span>
        </p>
      </div>
      <button onClick={openPlayer} className="btn btn-sm max-sm:hidden">Open player</button>
    </section>
  )
}

/** One gesture, a flow plays (SPEC-blend R1): how hard the first track hits and a tempo, then every pick holds close. */
function RightNow({ flows }: { flows: Flow[] }) {
  const [level, setLevel] = useState(60)
  const [tempo, setTempo] = useState(172)
  const [busy, setBusy] = useState(false)
  const sources = useFlowSources()
  const play = async () => {
    setBusy(true)
    try {
      const mine = flows.find(f => f.name === DIAL_NAME && !f.preset)
      const flow = await saveFlow(DIAL_NAME, dialFlow(level / 100, tempo, 'endless'), mine?.id)
      forgetShape(flow.id)
      await playFlow(flow.id, scopeBody(sources))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Right now" className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl bg-base-200 p-3 sm:px-4 sm:py-3.5">
      <h2 className="text-sm font-semibold max-sm:w-full">Right now</h2>
      <label className="flex min-w-0 flex-1 items-center gap-3 max-sm:basis-full sm:max-w-md">
        <span className="shrink-0 text-xs text-base-content/50">start at</span>
        <input type="range" min={0} max={100} value={level} onChange={e => setLevel(Number(e.target.value))} aria-label="Energy of the first track"
          aria-valuetext={`energy ${level} of 100`} className="rn-level min-w-0 flex-1" />
        <EnergyLevel value={level} />
        <span className="shrink-0 text-xs text-base-content/50">then holds</span>
      </label>
      <div className="flex items-center rounded-lg bg-base-100 p-0.5 text-xs outline-1 outline-white/8 sm:ml-auto">
        <button aria-label="Slower" onClick={() => setTempo(t => Math.max(60, t - 2))} className="rounded-md px-2.5 py-1 text-base-content/60 hover:text-base-content">−</button>
        <span className="rounded-md bg-base-300 px-2.5 py-1 tabular-nums">{tempo} bpm</span>
        <button aria-label="Faster" onClick={() => setTempo(t => Math.min(200, t + 2))} className="rounded-md px-2.5 py-1 text-base-content/60 hover:text-base-content">+</button>
      </div>
      <button onClick={() => run(play())} disabled={busy} className="btn btn-primary btn-sm max-sm:ml-auto">
        {busy ? <span className="loading loading-spinner loading-xs" /> : 'Play'}
      </button>
    </section>
  )
}

export default function FlowsHome({ onOpen, byId }: { onOpen: (id: string) => void; byId: Map<string, MusicTrack> }) {
  const { flows, loaded } = useFlows()
  const q = useMusicQueue()
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (id: string) => setOpen(o => (o === id ? null : id))
  const create = async () => {
    const f = await saveFlow('New flow', { ...toFlow(fresh()), pull: 'strong' })
    onOpen(f.id)
  }
  // Yours newest first, as the server sends them; the starters in the order of a night (oldest first).
  const mine = flows.filter(f => !f.preset && f.name !== DIAL_NAME)
  const starters = flows.filter(f => f.preset).reverse()
  const playing = q.source?.flow ? flows.find(f => f.id === q.source!.flow && f.name !== DIAL_NAME) : undefined
  const starter = starters.find(f => f.id === open)
  const row = (f: Flow) => <FlowRow key={f.id} flow={f} open={open === f.id} onToggle={() => toggle(f.id)} onOpen={onOpen} byId={byId} />
  return (
    <div className="flex max-w-[860px] flex-col gap-3.5">
      {playing && <Playing flow={playing} byId={byId} />}
      <FromBar />
      <RightNow flows={flows} />
      <section aria-label="Your flows" className="mt-1.5">
        <div className="mb-1 flex items-center gap-2.5 px-1 sm:px-3">
          <h2 className="text-[15px] font-semibold tracking-tight">Your flows</h2>
          {mine.length > 0 && <span className="text-xs text-base-content/45">{mine.length}</span>}
          <button onClick={() => run(create())} className="btn btn-sm ml-auto">
            <span aria-hidden="true">+</span> New flow
          </button>
        </div>
        {!loaded ? (
          <span className="loading loading-dots loading-sm ml-3 text-base-content/40" />
        ) : mine.length ? (
          <ul>{mine.map(row)}</ul>
        ) : (
          <p className="px-1 py-2 text-sm text-base-content/55 sm:px-3">None yet. Start from a starter below, or make a new one.</p>
        )}
      </section>
      {starters.length > 0 && (
        <section aria-label="Starters">
          <div className="flex flex-wrap items-center gap-2 px-1 max-sm:hidden sm:px-3">
            <h2 className="mr-1.5 text-[15px] font-semibold tracking-tight">Starters</h2>
            {starters.map(f => (
              <button key={f.id} aria-pressed={open === f.id} onClick={() => toggle(f.id)}
                className={`flex h-9 items-center gap-2 rounded-lg pl-2 pr-3 text-[13px] ${open === f.id ? 'bg-base-300 outline-1 outline-primary' : 'bg-base-200 hover:bg-base-300'}`}>
                <Shape flow={f} w={44} h={22} dots={false} />{f.name}
              </button>
            ))}
            <span className="text-xs text-base-content/45">click to preview · ⋯ Copy makes one yours</span>
          </div>
          {starter && <ul className="mt-2 max-sm:hidden">{row(starter)}</ul>}
          <div className="sm:hidden">
            <h2 className="mb-1 px-1 text-[15px] font-semibold tracking-tight">Starters</h2>
            <ul>{starters.map(row)}</ul>
          </div>
        </section>
      )}
    </div>
  )
}
