import { useRef } from 'react'
import { genreColor, genreShort } from '../../../../musicMeta'
import type { Arc } from '../harmonyApi'
import { moveChange } from './arc'

const W = 600
const PAD = 22
const ENERGY = { y: 14, h: 96 }
const MOOD = { y: 128, h: 60 }
const GENRE = { y: 204, h: 28 }
const MOOD_WORDS: [number, string][] = [[3, 'Bright'], [0, 'Neutral'], [-3, 'Dark']]

const x = (v: number) => PAD + v * (W - 2 * PAD)
const yEnergy = (v: number) => ENERGY.y + (1 - v) * ENERGY.h
const yMood = (v: number) => MOOD.y + ((3 - v) / 6) * MOOD.h
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type Drag = { lane: 'start' | 'lean' | 'mood' | 'genre'; k: number }
const LEAN_WORD = { lift: 'Lift', hold: 'Hold', ease: 'Ease' } as const
/** How far a lean is drawn to move over the whole set (the guide only; the builder scores steps, not a level). */
const LEAN_RISE = 0.3
const AMBER = 'oklch(82% .11 75)'

/** A built track as the lanes show it: energy 0..100, mood -3..3 (both when known), genre. */
export interface Block { duration: number; energy?: number; mood?: number; genre?: string }

/**
 * The three lanes of an arc as one SVG: an energy line, a dashed mood line and a genre
 * ribbon. Drag a dot to move it, drag a bar between genre blocks to move the change,
 * click a block to pick it. `onChange` fires on every move, so the set can be rebuilt as
 * you drag; `blocks` (the built tracks, over `span` seconds) are drawn under the lines.
 */
export default function ArcEditor({ arc, picked, onPick, pickedLean, onPickLean, onChange, blocks = [], span = 0 }: {
  arc: Arc
  picked?: number
  onPick: (k: number) => void
  pickedLean?: number
  onPickLean: (k: number) => void
  onChange: (a: Arc) => void
  blocks?: Block[]
  span?: number
}) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const a = arc

  const start = (d: Drag) => (e: React.PointerEvent) => {
    e.preventDefault()
    svg.current?.setPointerCapture(e.pointerId)
    drag.current = d
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    const el = svg.current
    if (!d || !el) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(el.getScreenCTM()!.inverse())
    const base = arc
    if (d.lane === 'start') onChange({ ...base, start: clamp(1 - (pt.y - ENERGY.y) / ENERGY.h, 0, 1) })
    else if (d.lane === 'lean') onChange({ ...base, energy: moveChange(base.energy, d.k, (pt.x - PAD) / (W - 2 * PAD)) })
    else if (d.lane === 'mood') onChange({ ...base, mood: base.mood.map((v, i) => (i === d.k ? clamp(3 - ((pt.y - MOOD.y) / MOOD.h) * 6, -3, 3) : v)) })
    else onChange({ ...base, genre: moveChange(base.genre, d.k, (pt.x - PAD) / (W - 2 * PAD)) })
  }
  const end = () => { drag.current = null }
  const total = Math.max(span, blocks.reduce((s, b) => s + b.duration, 0)) || 1
  const placed = blocks.map((b, i) => {
    const before = blocks.slice(0, i).reduce((s, p) => s + p.duration, 0)
    return { ...b, x0: x(before / total), x1: x((before + b.duration) / total) }
  })

  const line = (pts: number[], y: (v: number) => number) => pts.map((v, i) => `${x(i / (pts.length - 1))},${y(v)}`).join(' ')
  // The lean guide: from the start, each stretch nudging up, level or down.
  const guide: [number, number][] = [[0, a.start]]
  a.energy.forEach((s, k) => {
    const x0 = k ? a.energy[k - 1].x1 : 0, v = guide[guide.length - 1][1]
    guide.push([s.x1, clamp(v + (s.lean === 'lift' ? 1 : s.lean === 'ease' ? -1 : 0) * LEAN_RISE * (s.x1 - x0), 0.03, 0.97)])
  })
  const RIB = { y: ENERGY.y + ENERGY.h - 24, h: 20 }
  const dots = (pts: number[], lane: 'mood', y: (v: number) => number, color: string) => pts.map((v, i) => (
    <g key={i} onPointerDown={start({ lane, k: i })} className="cursor-grab touch-none">
      <circle cx={x(i / (pts.length - 1))} cy={y(v)} r={16} fill="transparent" />
      <circle cx={x(i / (pts.length - 1))} cy={y(v)} r={6.5} fill="var(--color-base-100)" stroke={color} strokeWidth={2.2} />
    </g>
  ))

  return (
    <svg ref={svg} viewBox={`0 0 ${W} 242`} className="w-full touch-none select-none" onPointerMove={move} onPointerUp={end} onPointerCancel={end} role="group" aria-label="Energy, mood and genre arcs">
      {([['ENERGY', ENERGY], ['MOOD', MOOD], ['GENRE', GENRE]] as const).map(([label, r]) => (
        <g key={label}>
          <rect x={PAD} y={r.y} width={W - 2 * PAD} height={r.h} rx={8} fill="rgba(255,255,255,.035)" />
          <text x={PAD + 6} y={r.y + 12} fontSize={9} letterSpacing={1} fill="currentColor" opacity={0.5}>{label}</text>
        </g>
      ))}
      {MOOD_WORDS.map(([v, w]) => <text key={w} x={W - PAD - 4} y={yMood(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.5}>{w}</text>)}
      {placed.map((b, i) => (
        <g key={i} opacity={0.85}>
          {b.energy !== undefined && <rect x={b.x0 + 1} y={yEnergy(b.energy / 100)} width={Math.max(2, b.x1 - b.x0 - 2)} height={ENERGY.y + ENERGY.h - yEnergy(b.energy / 100)} rx={3} fill="rgba(227,234,240,.12)" />}
          {b.mood !== undefined && <rect x={b.x0 + 1} y={yMood(b.mood) - 3} width={Math.max(2, b.x1 - b.x0 - 2)} height={6} rx={3} fill="oklch(78% .13 330)" />}
          {b.genre && <rect x={b.x0 + 1} y={GENRE.y + GENRE.h + 2} width={Math.max(2, b.x1 - b.x0 - 2)} height={5} rx={2} fill={genreColor(b.genre)} />}
        </g>
      ))}
      <polyline points={guide.map(([gx, v]) => `${x(gx)},${yEnergy(v)}`).join(' ')} fill="none" stroke={AMBER} strokeWidth={2} strokeDasharray="5 5" opacity={0.8} />
      {a.energy.map((s, k) => {
        const x0 = x(k ? a.energy[k - 1].x1 : 0)
        const x1 = x(s.x1)
        const [ya, yb] = s.lean === 'lift' ? [RIB.h - 5, 5] : s.lean === 'ease' ? [5, RIB.h - 5] : [RIB.h / 2, RIB.h / 2]
        return (
          <g key={`l${k}`}>
            <rect x={x0 + 1} y={RIB.y} width={Math.max(4, x1 - x0 - 2)} height={RIB.h} rx={6} fill={AMBER} opacity={pickedLean === k ? 0.32 : 0.14} className="cursor-pointer" onClick={() => onPickLean(k)} />
            <path d={`M${x0 + 8} ${RIB.y + ya} L${x0 + 22} ${RIB.y + yb}`} stroke={AMBER} strokeWidth={2} strokeLinecap="round" pointerEvents="none" />
            <text x={x0 + 28} y={RIB.y + 14} fontSize={11} fill="currentColor" pointerEvents="none">{x1 - x0 > 70 ? LEAN_WORD[s.lean] : ''}</text>
            {k < a.energy.length - 1 && (
              <g onPointerDown={start({ lane: 'lean', k })} className="cursor-ew-resize touch-none">
                <rect x={x1 - 12} y={RIB.y - 2} width={24} height={RIB.h + 4} fill="transparent" />
                <rect x={x1 - 3} y={RIB.y - 2} width={6} height={RIB.h + 4} rx={3} fill={AMBER} />
              </g>
            )}
          </g>
        )
      })}
      <g onPointerDown={start({ lane: 'start', k: 0 })} className="cursor-ns-resize touch-none" aria-label="Where the energy starts">
        <circle cx={x(0)} cy={yEnergy(a.start)} r={16} fill="transparent" />
        <circle cx={x(0)} cy={yEnergy(a.start)} r={6.5} fill="var(--color-base-100)" stroke={AMBER} strokeWidth={2.2} />
        <text x={x(0) + 11} y={yEnergy(a.start) - 9} fontSize={9} fill="currentColor" opacity={0.6}>start</text>
      </g>
      <polyline points={line(a.mood, yMood)} fill="none" stroke="oklch(78% .13 330)" strokeWidth={2} strokeDasharray="5 4" />
      {dots(a.mood, 'mood', yMood, 'oklch(78% .13 330)')}
      {a.genre.map((s, k) => {
        const x0 = x(k ? a.genre[k - 1].x1 : 0)
        const x1 = x(s.x1)
        return (
          <g key={k}>
            <rect x={x0 + 1} y={GENRE.y + 2} width={Math.max(4, x1 - x0 - 2)} height={GENRE.h - 4} rx={6} fill={genreColor(s.g)} opacity={picked === k ? 0.6 : 0.3} className="cursor-pointer" onClick={() => onPick(k)} />
            <text x={(x0 + x1) / 2} y={GENRE.y + 19} textAnchor="middle" fontSize={11} fill="currentColor" pointerEvents="none">{genreShort(s.g)}</text>
            {k < a.genre.length - 1 && (
              <g onPointerDown={start({ lane: 'genre', k })} className="cursor-ew-resize touch-none">
                <rect x={x1 - 12} y={GENRE.y - 2} width={24} height={GENRE.h + 4} fill="transparent" />
                <rect x={x1 - 3} y={GENRE.y - 2} width={6} height={GENRE.h + 4} rx={3} fill="currentColor" />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
