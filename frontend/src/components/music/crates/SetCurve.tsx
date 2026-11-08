import { useEffect, useState } from 'react'
import { genreColor, genreShort } from '../../../musicMeta'
import { CCOL } from '../flows/lanes'
import { join } from './proximity'
import { isClash, keptKey, type SetTrack } from './setBuilder'
import { colourOf, runsOf } from './setRuns'

// The playlist's timeline in the flow editor's language (FlowLanes): an Energy lane (amber curve),
// a Genre lane and a Harmony lane (runs of bricks), under one ruler.
// Design: .impeccable/mocks/playlist-timeline/round3.html (round 4, "Runs, cleaned up").

const fmt = (s: number) => {
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const EH = 84
const LH = 40

const useWidth = (el: HTMLElement | null) => {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return w
}

type Lane = 'genre' | 'colour'
interface Run { lane: Lane; i: number }

/** Energy, genre and key colour across the whole set, over its parts, with an amber cut where a join
 *  clashes and a marker where the set is playing. Pointing at (or tapping) a run names it and lights
 *  its tracks through `onRun` (flat indexes, end excluded). */
export default function SetCurve({ groups, now, kept, onRun }: {
  groups: { name?: string; tracks: SetTrack[] }[]
  now?: number
  /** Joins the mixer chose to keep (keptKey): not cut as clashes, as in the header's count. */
  kept?: ReadonlySet<string>
  onRun?: (range: [number, number] | null) => void
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const w = useWidth(box)
  const [hover, setHover] = useState<Run | null>(null)
  const [pinned, setPinned] = useState<Run | null>(null)
  const all = groups.flatMap(g => g.tracks)
  const total = all.reduce((s, t) => s + t.duration, 0)

  const clash = (i: number) => i > 0 && isClash(join(all[i - 1], all[i])) && !kept?.has(keptKey(all[i - 1], all[i]))
  const runs: Record<Lane, ReturnType<typeof runsOf>> = {
    genre: runsOf(all, t => t.genre),
    colour: runsOf(all, colourOf, clash),
  }
  const shown = hover ?? pinned
  const run = shown && runs[shown.lane][shown.i]
  const range: [number, number] | null = run ? [run.from, run.to] : null
  const rangeKey = range?.join()
  useEffect(() => { onRun?.(range) }, [rangeKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onRun?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!total || all.length < 2) return null
  const X = (s: number) => (w ? (s / total) * w : 0)

  // Energy: a point per track at its middle, lightly eased so it reads as one line, like the editor's.
  const pts: [number, number][] = []
  let at = 0
  for (const t of all) {
    const e = t.energyScale?.track
    if (e != null) pts.push([X(at + t.duration / 2), 8 + (1 - e / 100) * (EH - 16)])
    at += t.duration
  }
  const sm = pts.map((p, i) => (i && i < pts.length - 1 ? [p[0], (pts[i - 1][1] + 2 * p[1] + pts[i + 1][1]) / 4] : p))
  let d = ''
  if (sm.length > 1) {
    sm.unshift([0, sm[0][1]]); sm.push([w, sm.at(-1)![1]])
    d = `M${sm[0][0]} ${sm[0][1]}`
    for (let i = 1; i < sm.length; i++) {
      const [px, py] = sm[i - 1], [qx, qy] = sm[i], m = (qx - px) / 2
      d += ` C${px + m} ${py} ${qx - m} ${qy} ${qx} ${qy}`
    }
  }

  // Ruler: the coarsest step that keeps labels about 56px apart; parts mark their starts.
  const step = [600, 900, 1800, 3600, 7200].find(s => X(s) >= 56) ?? 7200
  const ticks: number[] = []
  for (let s = 0; s < total - step / 3; s += step) ticks.push(s)
  let ps = 0
  const parts = groups.length > 1 ? groups.map(g => { const s = ps; ps += g.tracks.reduce((a, t) => a + t.duration, 0); return { name: g.name, s } }) : []
  const lines = [...ticks.slice(1), ...parts.slice(1).map(p => p.s)]
  const grid = lines.map((s, i) => <div key={i} className="fl-gl" style={{ left: X(s) }} />)

  const label = (lane: Lane, v?: string) => (lane === 'genre' ? (v ? genreShort(v) : 'No genre') : v ? cap(v) : 'Key not read')
  const colour = (lane: Lane, v?: string) => (lane === 'genre' ? (v ? genreColor(v) : CCOL.Any) : CCOL[v ?? 'Any'])
  const pick = (r: Run) => setPinned(p => (p && p.lane === r.lane && p.i === r.i ? null : r))
  const bricks = (lane: Lane) => runs[lane].map((r, i) => {
    // A brick never leaves its own time: 1px each side, at least 2px wide; past a clash, 2px more for the bar.
    const x0 = X(r.s) + 1 + (r.cut ? 2 : 0), bw = Math.max(X(r.s + r.d) - x0 - 1, 2)
    const thin = bw < 20, name = label(lane, r.v), col = colour(lane, r.v)
    const sel = shown?.lane === lane && shown.i === i
    const tracks = r.to - r.from === 1 ? `track ${r.from + 1}` : `tracks ${r.from + 1}–${r.to}`
    return (
      <button
        key={i} type="button" aria-label={`${name}, ${tracks}, ${fmt(r.d)}`} aria-pressed={sel}
        className={`fl-brick sc-brick${thin ? ' sc-thin' : ''}${sel ? ' fl-sel' : ''}`}
        style={{ left: x0, width: bw, ['--c' as string]: col }}
        onPointerEnter={e => { if (e.pointerType === 'mouse') setHover({ lane, i }) }}
        onPointerLeave={() => setHover(null)}
        onClick={() => pick({ lane, i })}
      >
        {!thin && <span className="fl-dot" style={{ background: col }} />}
        {bw >= name.length * 7 + 34 && <span className="fl-v">{name}</span>}
      </button>
    )
  })
  const cuts = runs.colour.filter(r => r.cut).map(r => <div key={r.from} className="sc-clash" style={{ left: X(r.s) + 1 }} />)

  return (
    <div className="flow-lanes fl-card sc mb-3 px-3.5 pb-3 pt-2" role="group" aria-label="Energy, genre and key colour across the set">
      <div className="fl-grid">
        <div className="fl-name" />
        <div ref={setBox} className="sc-readout" aria-live="polite">
          {run && shown ? (
            <>
              <span className="fl-dot" style={{ background: colour(shown.lane, run.v) }} />
              <b>{label(shown.lane, run.v)}</b>
              <span>{run.to - run.from === 1 ? `track ${run.from + 1}` : `tracks ${run.from + 1}–${run.to}`} · {fmt(run.d)}</span>
            </>
          ) : null}
          {!run && <span className="sc-hint">point at or tap a run</span>}
        </div>
        <div className="fl-name" />
        <div className="fl-track fl-ruler">
          {ticks.map(s => <span key={s} style={{ left: X(s) }}>{s ? fmt(s) : '0'}</span>)}
          {parts.slice(1).map((p, i) => p.name && <span key={`p${i}`} className="sc-part" style={{ left: X(p.s) + 4 }}>{p.name}</span>)}
        </div>
        <div className="fl-name">Energy<small>how hard it hits</small></div>
        <div className="fl-track" style={{ height: EH }}>
          {grid}
          {run && <div className="sc-shade" style={{ left: X(run.s), width: X(run.d) }} />}
          {d && (
            <svg className="fl-curve" width={w} height={EH} aria-hidden="true">
              <defs><linearGradient id="sc-eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="oklch(82% .11 75)" stopOpacity=".28" /><stop offset="1" stopColor="oklch(82% .11 75)" stopOpacity="0" /></linearGradient></defs>
              <path d={`${d} L${w} ${EH} L0 ${EH}Z`} fill="url(#sc-eg)" />
              <path d={d} fill="none" stroke="var(--fl-energy)" strokeWidth={2} strokeLinecap="round" />
            </svg>
          )}
          {now !== undefined && <div className="sc-now" style={{ left: X(Math.min(now, total)) }} />}
        </div>
        <div className="fl-name">Genre<small>what style</small></div>
        <div className="fl-track" style={{ height: LH }}>{grid}{bricks('genre')}</div>
        <div className="fl-name">Harmony<small>key colour</small></div>
        <div className="fl-track" style={{ height: LH }}>{grid}{bricks('colour')}{cuts}</div>
      </div>
    </div>
  )
}
