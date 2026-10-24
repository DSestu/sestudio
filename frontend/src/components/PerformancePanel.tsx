import { useEffect, useRef, useState } from 'react'
import { mediaMetrics, type MediaMetrics } from '../api'
import AiBadge from './AiBadge'

const EVERY_MS = 1000
/** A minute of history per graph. */
const KEEP = 60

/** A bandwidth worth comparing the connection with. */
export interface Mark {
  label: string
  /** Bits a second. */
  bps: number
}

interface Sample {
  metrics: MediaMetrics
  /** Seconds the player holds past its position; null where it cannot be read. */
  client: number | null
  /** The connection's speed over the last segment, bits a second. */
  link: number | null
}

interface Graph {
  label: string
  values: (number | null)[]
  max: number
  text: (value: number) => string
  marks?: Mark[]
  ai?: boolean
}

const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`
const percent = (value: number) => `${Math.round(value)}%`
const seconds = (value: number) => `${Math.round(value)} s`
const mbps = (bps: number) => `${(bps / 1e6).toFixed(1)} Mb/s`

function Sparkline({ values, max, marks = [], tall }: {
  values: (number | null)[]
  max: number
  marks?: Mark[]
  tall?: boolean
}) {
  const step = 100 / (KEEP - 1)
  const offset = KEEP - values.length
  const y = (v: number) => 30 - (Math.min(v, max) / max) * 30
  const points = values.flatMap((v, i) =>
    v === null ? [] : [`${((offset + i) * step).toFixed(1)},${y(v).toFixed(1)}`],
  )
  const first = points[0]?.split(',')[0]
  const last = points.at(-1)?.split(',')[0]
  return (
    // Labels in HTML over the drawing, which is stretched to fit and would
    // stretch text with it.
    <div className={`relative w-full ${tall ? 'h-24' : 'h-8'}`}>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-primary" aria-hidden="true">
        {marks.map(m => (
          <line
            key={m.label}
            x1="0" x2="100" y1={y(m.bps)} y2={y(m.bps)}
            stroke="currentColor" strokeWidth="1" strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke" className="text-base-content/40"
          />
        ))}
        {points.length > 0 && (
          <>
            <polygon points={`${first},30 ${points.join(' ')} ${last},30`} fill="currentColor" opacity="0.15" />
            <polyline
              points={points.join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {marks.map(m => (
        <span
          key={m.label}
          className="absolute right-0 -translate-y-full text-[10px] leading-none text-base-content/60"
          style={{ top: `${(y(m.bps) / 30) * 100}%` }}
        >
          {m.label} · {mbps(m.bps)}
        </span>
      ))}
    </div>
  )
}

/**
 * Live graphs of what playback costs and how far ahead it is: the server's
 * GPU, CPU and memory; how much it has ready past the playhead, at the
 * source's rate and drawn by AI; what the player itself has buffered, and how
 * much of that is AI; and the connection's speed against what each quality
 * needs. Folded by default, and only asked for while open.
 */
export default function PerformancePanel({ url, position, clientAhead, linkSpeed, marks, ai }: {
  /** The media playing; omitted for the DLNA TV. */
  url?: string
  /** Where it plays now, in seconds. */
  position: () => number
  /** Seconds the player has buffered past *position*; omitted where unreadable. */
  clientAhead?: () => number
  /** The connection's speed, bits a second; omitted where unreadable. */
  linkSpeed?: () => number | null
  /** Bandwidths to draw across the connection's graph. */
  marks?: () => Mark[]
  /** Whether a rate drawn by AI is asked for: shows its own buffers. */
  ai?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  const [lines, setLines] = useState<Mark[]>([])
  // Read at each tick, so a new function each render does not restart polling.
  const read = useRef({ position, clientAhead, linkSpeed, marks })
  useEffect(() => { read.current = { position, clientAhead, linkSpeed, marks } })

  useEffect(() => {
    if (!open) return
    let live = true
    const tick = async () => {
      const { position, clientAhead, linkSpeed, marks } = read.current
      const client = clientAhead?.() ?? null
      const metrics = await mediaMetrics(url, position(), client ?? 0)
      if (!live || !metrics) return
      setSamples(s => [...s.slice(-(KEEP - 1)), { metrics, client, link: linkSpeed?.() ?? null }])
      setLines(marks?.() ?? [])
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, EVERY_MS)
    return () => { live = false; window.clearInterval(timer) }
  }, [open, url])

  const last = samples.at(-1)?.metrics
  const series = (pick: (s: Sample) => number | null) => samples.map(pick)
  const buffers = [
    series(s => s.metrics.ahead), series(s => s.metrics.ai_ahead), series(s => s.client),
  ]
  const buffered = Math.max(30, ...buffers.flat().map(v => v ?? 0))
  const graphs: Graph[] = []
  if (last?.gpu) {
    graphs.push(
      { label: 'GPU', values: series(s => s.metrics.gpu?.load ?? null), max: 100, text: percent },
      {
        label: 'GPU memory',
        values: series(s => s.metrics.gpu?.used ?? null),
        max: last.gpu.total,
        text: v => `${gb(v)} / ${gb(last.gpu!.total)}`,
      },
    )
  }
  if (last) {
    graphs.push(
      { label: 'CPU', values: series(s => s.metrics.cpu), max: 100, text: percent },
      {
        label: 'Memory',
        values: series(s => s.metrics.memory.used),
        max: last.memory.total,
        text: v => `${gb(v)} / ${gb(last.memory.total)}`,
      },
    )
    if (last.ahead !== null) {
      graphs.push({ label: 'Ready on the server', values: buffers[0], max: buffered, text: seconds })
    }
    if (ai && last.ai_ahead !== null) {
      graphs.push({ label: 'AI ready on the server', values: buffers[1], max: buffered, text: seconds, ai: true })
    }
    if (clientAhead) {
      graphs.push({ label: 'Playable ahead', values: buffers[2], max: buffered, text: seconds })
      if (ai && last.client_ai !== null) {
        graphs.push({
          label: 'AI in the player', values: series(s => s.metrics.client_ai), max: buffered, text: seconds, ai: true,
        })
      }
    }
  }
  if (linkSpeed && last) {
    // Scaled to what the qualities need, so their lines stay apart: a fast
    // link runs off the top, its figure still read beside the name.
    const top = Math.max(1e6, ...lines.map(m => m.bps)) * 1.4
    graphs.push({ label: 'Connection', values: series(s => s.link), max: top, text: mbps, marks: lines })
  }

  return (
    <div className="rounded-box bg-base-200/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-base-content/70 hover:text-base-content"
      >
        {ai && <AiBadge />}
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
                <div
                  key={g.label}
                  className={`rounded-box bg-base-100 p-2 ${g.marks ? 'basis-full' : 'min-w-[8.5rem] flex-1'}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1 text-base-content/60">
                      {g.label}
                      {g.ai && <AiBadge />}
                    </span>
                    <span className="font-mono tabular-nums">{now == null ? '–' : g.text(now)}</span>
                  </div>
                  <Sparkline values={g.values} max={g.max || 1} marks={g.marks} tall={Boolean(g.marks)} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
