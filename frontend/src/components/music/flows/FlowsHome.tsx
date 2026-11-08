import { useState } from 'react'
import { DIAL_NAME, KINDS, dialFlow, playFlow, saveFlow, useFlows, type Flow } from '../../../musicFlows'
import { UNKNOWN_ARTIST, type MusicTrack } from '../../../musicLibrary'
import { useMusicQueue } from '../../../musicQueue'
import { openPlayer } from '../player'
import FlowRow, { Shape } from './FlowRow'
import { ENERGY_WORDS } from './flowWords'
import { fresh, toFlow } from './lanes'

// The Music tab's Flows (SPEC-flows-tab §2, board A · Shelf): the flow playing, Right now,
// your flows, the starters. One column; a row opens in place on what it would play.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
/** The energy each word plays at, mid-band of the generator's fifths. */
const LEVEL = [0.1, 0.3, 0.5, 0.7, 0.9]

/** The flow the queue plays, with where it is in it and what comes next. */
function Playing({ flow, byId }: { flow: Flow; byId: Map<string, MusicTrack> }) {
  const q = useMusicQueue()
  const cur = byId.get(q.items[q.current]?.track_id ?? '')
  const next = byId.get(q.items[q.current + 1]?.track_id ?? '')
  const event = q.items.slice(q.current + 1).find(i => i.flow?.event && !i.flow.event.realised)?.flow?.event
  const now = q.items.length ? (q.current + 0.5) / q.items.length : 0
  return (
    <section aria-label={`Playing ${flow.name}`} className="flex items-center gap-3.5 rounded-xl bg-primary/7 px-3.5 py-3 outline-1 outline-primary/50">
      <span className="hidden sm:block"><Shape flow={flow} w={220} h={46} now={now} /></span>
      <span className="sm:hidden"><Shape flow={flow} w={96} h={38} now={now} /></span>
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

/** One gesture, a flow plays: an energy word and a tempo become the one-chunk "Now" flow. */
function RightNow({ flows }: { flows: Flow[] }) {
  const [level, setLevel] = useState(2)
  const [tempo, setTempo] = useState(172)
  const [busy, setBusy] = useState(false)
  const play = async () => {
    setBusy(true)
    try {
      const mine = flows.find(f => f.name === DIAL_NAME && !f.preset)
      const flow = await saveFlow(DIAL_NAME, dialFlow(LEVEL[level], tempo, 'endless'), mine?.id)
      await playFlow(flow.id)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Right now" className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl bg-base-200 p-3 sm:px-4 sm:py-3.5">
      <h2 className="w-full text-sm font-semibold sm:w-auto">Right now</h2>
      <div role="radiogroup" aria-label="Energy" className="flex rounded-lg bg-base-100 p-0.5 outline-1 outline-white/8">
        {ENERGY_WORDS.map((w, i) => (
          <button key={w} role="radio" aria-checked={level === i} onClick={() => setLevel(i)}
            className={`rounded-md px-2.5 py-1 text-xs ${level === i ? 'bg-base-300 text-base-content' : 'text-base-content/60 hover:text-base-content'}`}>
            {cap(w)}
          </button>
        ))}
      </div>
      <div className="flex items-center rounded-lg bg-base-100 p-0.5 text-xs outline-1 outline-white/8">
        <button aria-label="Slower" onClick={() => setTempo(t => Math.max(60, t - 2))} className="rounded-md px-2.5 py-1 text-base-content/60 hover:text-base-content">−</button>
        <span className="rounded-md bg-base-300 px-2.5 py-1 tabular-nums">{tempo} bpm</span>
        <button aria-label="Faster" onClick={() => setTempo(t => Math.min(200, t + 2))} className="rounded-md px-2.5 py-1 text-base-content/60 hover:text-base-content">+</button>
      </div>
      <span className="text-xs text-base-content/45 max-sm:hidden">until you stop</span>
      <button onClick={() => run(play())} disabled={busy} className="btn btn-primary btn-sm ml-auto">
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
