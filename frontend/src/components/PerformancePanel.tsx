import { useEffect, useRef, useState } from 'react'
import { mediaMetrics, type MediaMetrics } from '../api'
import AiBadge from './AiBadge'

const EVERY_MS = 1000
/** A minute of history per graph. */
const KEEP = 60

interface Sample {
  metrics: MediaMetrics
  /** Seconds the player holds past its position; null where it cannot be read. */
  client: number | null
}

interface Graph {
  label: string
  values: (number | null)[]
  max: number
  text: (value: number) => string
}

const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`
const percent = (value: number) => `${Math.round(value)}%`
const seconds = (value: number) => `${Math.round(value)} s`

function Sparkline({ values, max }: { values: (number | null)[]; max: number }) {
  const step = 100 / (KEEP - 1)
  const offset = KEEP - values.length
  const points = values.flatMap((v, i) =>
    v === null ? [] : [`${((offset + i) * step).toFixed(1)},${(30 - (Math.min(v, max) / max) * 30).toFixed(1)}`],
  )
  if (!points.length) return <div className="h-8" />
  const first = points[0].split(',')[0]
  const last = points[points.length - 1].split(',')[0]
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full text-primary" aria-hidden="true">
      <polygon points={`${first},30 ${points.join(' ')} ${last},30`} fill="currentColor" opacity="0.15" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * Live graphs of what drawing frames by AI costs: the server's GPU, CPU and
 * memory, how far ahead of the playhead it has the video ready, and — where it
 * can be read — how much the player itself has buffered. Folded by default,
 * and only asked for while open.
 */
export default function PerformancePanel({ url, position, clientAhead }: {
  /** The media playing; omitted for the DLNA TV. */
  url?: string
  /** Where it plays now, in seconds. */
  position: () => number
  /** Seconds the player has buffered past *position*; omitted where unreadable. */
  clientAhead?: () => number
}) {
  const [open, setOpen] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  // Read at each tick, so a new function each render does not restart polling.
  const read = useRef({ position, clientAhead })
  useEffect(() => { read.current = { position, clientAhead } })

  useEffect(() => {
    if (!open) return
    let live = true
    const tick = async () => {
      const metrics = await mediaMetrics(url, read.current.position())
      if (!live || !metrics) return
      const client = read.current.clientAhead?.() ?? null
      setSamples(s => [...s.slice(-(KEEP - 1)), { metrics, client }])
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, EVERY_MS)
    return () => { live = false; window.clearInterval(timer) }
  }, [open, url])

  const last = samples.at(-1)?.metrics
  const ahead = samples.map(s => s.metrics.ahead)
  const client = samples.map(s => s.client)
  const buffered = Math.max(30, ...ahead.map(v => v ?? 0), ...client.map(v => v ?? 0))
  const graphs: Graph[] = []
  if (last?.gpu) {
    graphs.push(
      { label: 'GPU', values: samples.map(s => s.metrics.gpu?.load ?? null), max: 100, text: percent },
      {
        label: 'GPU memory',
        values: samples.map(s => s.metrics.gpu?.used ?? null),
        max: last.gpu.total,
        text: v => `${gb(v)} / ${gb(last.gpu!.total)}`,
      },
    )
  }
  if (last) {
    graphs.push(
      { label: 'CPU', values: samples.map(s => s.metrics.cpu), max: 100, text: percent },
      {
        label: 'Memory',
        values: samples.map(s => s.metrics.memory.used),
        max: last.memory.total,
        text: v => `${gb(v)} / ${gb(last.memory.total)}`,
      },
    )
    if (last.ahead !== null) {
      graphs.push({ label: 'Ready on the server', values: ahead, max: buffered, text: seconds })
    }
  }
  if (clientAhead && last) {
    graphs.push({ label: 'Buffered in the player', values: client, max: buffered, text: seconds })
  }

  return (
    <div className="rounded-box bg-base-200/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-base-content/70 hover:text-base-content"
      >
        <AiBadge />
        <span>Performance</span>
        <svg
          className={`ml-auto h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="flex flex-wrap gap-2 px-3 pb-3">
            {!graphs.length && <span className="text-base-content/50">Measuring…</span>}
            {graphs.map(g => {
              const now = g.values.at(-1)
              return (
                <div key={g.label} className="min-w-[8.5rem] flex-1 rounded-box bg-base-100 p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base-content/60">{g.label}</span>
                    <span className="font-mono tabular-nums">{now == null ? '–' : g.text(now)}</span>
                  </div>
                  <Sparkline values={g.values} max={g.max || 1} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
