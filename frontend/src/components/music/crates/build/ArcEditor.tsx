import { useRef, useState } from 'react'
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

type Drag = { lane: 'energy' | 'mood' | 'genre'; k: number }

/**
 * The three lanes of an arc as one SVG: an energy line, a dashed mood line and a genre
 * ribbon. Drag a dot to move it, drag a bar between genre blocks to move the change,
 * click a block to pick it. `onChange` fires when the pointer is released.
 */
export default function ArcEditor({ arc, picked, onPick, onChange }: { arc: Arc; picked?: number; onPick: (k: number) => void; onChange: (a: Arc) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<Arc | null>(null)
  const a = draft ?? arc

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
    const base = draft ?? arc
    if (d.lane === 'energy') setDraft({ ...base, energy: base.energy.map((v, i) => (i === d.k ? clamp(1 - (pt.y - ENERGY.y) / ENERGY.h, 0, 1) : v)) })
    else if (d.lane === 'mood') setDraft({ ...base, mood: base.mood.map((v, i) => (i === d.k ? clamp(3 - ((pt.y - MOOD.y) / MOOD.h) * 6, -3, 3) : v)) })
    else setDraft({ ...base, genre: moveChange(base.genre, d.k, (pt.x - PAD) / (W - 2 * PAD)) })
  }
  const end = () => {
    drag.current = null
    if (draft) { onChange(draft); setDraft(null) }
  }

  const line = (pts: number[], y: (v: number) => number) => pts.map((v, i) => `${x(i / (pts.length - 1))},${y(v)}`).join(' ')
  const dots = (pts: number[], lane: 'energy' | 'mood', y: (v: number) => number, color: string) => pts.map((v, i) => (
    <g key={i} onPointerDown={start({ lane, k: i })} className="cursor-grab touch-none">
      <circle cx={x(i / (pts.length - 1))} cy={y(v)} r={16} fill="transparent" />
      <circle cx={x(i / (pts.length - 1))} cy={y(v)} r={6.5} fill="var(--color-base-100)" stroke={color} strokeWidth={2.2} />
    </g>
  ))

  return (
    <svg ref={svg} viewBox={`0 0 ${W} 246`} className="w-full touch-none select-none" onPointerMove={move} onPointerUp={end} onPointerCancel={end} role="group" aria-label="Energy, mood and genre arcs">
      {([['ENERGY', ENERGY], ['MOOD', MOOD], ['GENRE', GENRE]] as const).map(([label, r]) => (
        <g key={label}>
          <rect x={PAD} y={r.y} width={W - 2 * PAD} height={r.h} rx={8} fill="rgba(255,255,255,.035)" />
          <text x={PAD + 6} y={r.y + 12} fontSize={9} letterSpacing={1} fill="currentColor" opacity={0.5}>{label}</text>
        </g>
      ))}
      {MOOD_WORDS.map(([v, w]) => <text key={w} x={W - PAD - 4} y={yMood(v) + 3} textAnchor="end" fontSize={9} fill="currentColor" opacity={0.5}>{w}</text>)}
      <polyline points={line(a.energy, yEnergy)} fill="none" stroke="currentColor" strokeWidth={2.2} />
      <polyline points={line(a.mood, yMood)} fill="none" stroke="oklch(78% .13 330)" strokeWidth={2} strokeDasharray="5 4" />
      {dots(a.energy, 'energy', yEnergy, 'currentColor')}
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
