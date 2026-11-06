import { useState } from 'react'
import {
  DIAL_NAME, LENGTHS, dialFlow, energyShape, eventDots, eventsLine, futures, outline, playFlow, saveFlow, useFlows,
  type Flow,
} from '../../../musicFlows'

// The Music tab's entry (SPEC-music-flows §9, board 1): the dial on top, the flows under it.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }

function PlayButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="btn btn-primary btn-circle btn-sm shrink-0">
      <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
    </button>
  )
}

/** The energy curve and the harmony events along the flow's first path. */
function Shape({ flow }: { flow: Flow }) {
  const pts = energyShape(flow)
  const dots = eventDots(flow)
  const y = (v: number) => 30 - v * 26
  const at = (f: number) => {
    if (!pts) return 18
    const i = pts.findIndex(p => p[0] >= f)
    if (i <= 0) return y(pts[Math.max(0, i)][1])
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    return y(y0 + ((y1 - y0) * (f - x0)) / (x1 - x0 || 1))
  }
  return (
    <svg viewBox="0 0 200 34" className="block h-9 w-full" aria-hidden="true" preserveAspectRatio="none">
      <line x1="0" x2="200" y1="32" y2="32" className="stroke-base-300" strokeWidth="1" />
      {pts && <polyline points={pts.map(([f, v]) => `${f * 200},${y(v)}`).join(' ')} fill="none" className="stroke-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {dots.map((d, i) => (
        <circle key={i} cx={d.at * 200} cy={at(d.at)} r="3" className={d.kind === 'break' ? 'fill-error' : 'fill-primary'} />
      ))}
    </svg>
  )
}

function FlowCard({ flow, onOpen }: { flow: Flow; onOpen: () => void }) {
  const n = futures(flow)
  const length = LENGTHS.find(l => l.id === flow.length)?.label ?? 'Endless'
  return (
    <li className="flex flex-col gap-1 rounded-box bg-base-200 p-3">
      <div className="flex items-start gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left leading-tight hover:text-primary" title="Edit this flow">
          <p className="truncate text-sm font-semibold">{flow.name}</p>
          {flow.chunks.length > 1 && <p className="truncate text-xs text-base-content/60">{outline(flow)}</p>}
        </button>
        <PlayButton label={`Play ${flow.name}`} onClick={() => run(playFlow(flow.id))} />
      </div>
      <Shape flow={flow} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {n > 1 && <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">{n} futures</span>}
        <span className="rounded-full bg-base-300 px-2 py-0.5 font-medium text-base-content/80">{length}</span>
        {flow.preset && <span className="rounded-full bg-base-300 px-2 py-0.5 font-medium text-base-content/60">preset</span>}
        <span className="truncate text-base-content/50">{eventsLine(flow)}</span>
      </div>
    </li>
  )
}

const ENERGY_WORDS = ['calm', 'easy', 'lively', 'high', 'all out']
const MOOD_WORDS = ['dark', 'dusky', 'neutral', 'warm', 'bright']
const word = (words: string[], v: number) => words[Math.min(words.length - 1, Math.floor(v * words.length))]

function Slider({ label, value, min, max, step, shown, onChange, disabled, hint }: {
  label: string; value: number; min: number; max: number; step: number; shown: string
  onChange: (v: number) => void; disabled?: boolean; hint?: string
}) {
  return (
    <label className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-sm" title={hint}>
      <span className={disabled ? 'text-base-content/50' : ''}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="range range-primary range-xs"
      />
      <span className="text-right text-xs tabular-nums text-base-content/60">{shown}</span>
    </label>
  )
}

/** One gesture, a flow plays: three values become a one-chunk flow ("Now"), rewritten on every play. */
function Dial({ flows }: { flows: Flow[] }) {
  const [energy, setEnergy] = useState(0.6)
  const [mood, setMood] = useState(0.3)
  const [tempo, setTempo] = useState(172)
  const [length, setLength] = useState<Flow['length']>('endless')
  const [busy, setBusy] = useState(false)
  const play = async () => {
    setBusy(true)
    try {
      const mine = flows.find(f => f.name === DIAL_NAME && !f.preset)
      const flow = await saveFlow(DIAL_NAME, dialFlow(energy, tempo, length), mine?.id)
      await playFlow(flow.id)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Play a feeling" className="flex flex-col gap-2.5 rounded-box bg-base-200 p-4 lg:w-90 lg:shrink-0 lg:self-start">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">How should it feel now</h2>
      <Slider label="Energy" value={energy} min={0} max={1} step={0.05} shown={word(ENERGY_WORDS, energy)} onChange={setEnergy} />
      <Slider
        label="Mood" value={mood} min={0} max={1} step={0.05} shown={word(MOOD_WORDS, mood)} onChange={setMood}
        disabled hint="Mood shapes the flow once tracks have a mood reading"
      />
      <Slider label="Tempo" value={tempo} min={80} max={180} step={1} shown={`${tempo}`} onChange={setTempo} />
      <div className="mt-1 flex items-center gap-2">
        <button onClick={() => run(play())} disabled={busy} className="btn btn-primary btn-sm flex-1 lg:flex-none">
          {busy ? <span className="loading loading-spinner loading-xs" /> : 'Play'}
        </button>
        <select
          aria-label="Length" value={length} onChange={e => setLength(e.target.value as Flow['length'])}
          className="select select-sm w-auto"
        >
          {LENGTHS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>
    </section>
  )
}

export default function FlowsHome({ onOpen }: { onOpen: (id: string) => void }) {
  const create = async () => {
    const f = await saveFlow('New flow', { chunks: [{ id: 'start', share: 1, next: [], layers: { harmony: [] } }], pull: 'strong', length: 'endless' })
    onOpen(f.id)
  }
  const { flows, loaded } = useFlows()
  // Yours first (newest first, as the server sends them), then the presets; the dial's own flow is the dial.
  // Presets in the order of a night: they were seeded together, so oldest first is their own order.
  const shown = [...flows.filter(f => !f.preset && f.name !== DIAL_NAME), ...flows.filter(f => f.preset).reverse()]
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Dial flows={flows} />
      <section aria-label="Your flows" className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Your flows</h2>
        {!loaded ? (
          <span className="loading loading-dots loading-sm text-base-content/40" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map(f => <FlowCard key={f.id} flow={f} onOpen={() => onOpen(f.id)} />)}
            <li>
              <button onClick={() => run(create())} className="flex h-full min-h-24 w-full flex-col items-start justify-center gap-0.5 rounded-box border border-dashed border-base-300 p-3 text-left hover:bg-white/4">
                <span className="text-sm font-semibold text-base-content/80">New flow</span>
                <span className="text-xs text-base-content/50">from scratch; presets drop into it</span>
              </button>
            </li>
          </ul>
        )}
      </section>
    </div>
  )
}
