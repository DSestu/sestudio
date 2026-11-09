import { useEffect, useRef, useState } from 'react'
import {
  AXES, AXIS_COLOR, AXIS_LABEL, importanceName, IMPORTANCE_PRESETS, leadOf, setImportance, shares, useBlendWeights, welcomeName,
  type Axis, type Importance,
} from '../../../musicBlendWeights'
import { effectOf, type Join } from './blendOrder'
import HarmonyMoves from './HarmonyMoves'
import { Ic } from './icons'

// Blend by (SPEC-music-library §2.7): a sticky bar at the top of the centre column whenever Best
// blend is on, reading back the weights and their effect; it opens a panel downward over the
// column with the radar, the presets and Harmony moves. Done, Esc or the bar closes it.

/** Where each axis points on the radar. */
const RAX: Record<Axis, [number, number]> = { harmony: [0, -1], energy: [1, 0], genre: [0, 1], mood: [-1, 0] }
const R = 78

function Bars({ i }: { i: Importance }) {
  const s = shares(i)
  return <span className="flex h-4 items-end gap-px" aria-hidden="true">{AXES.map(k => <i key={k} className="w-1 rounded-sm" style={{ height: Math.max(3, s[k] * 40), background: AXIS_COLOR[k] }} />)}</span>
}

function Radar({ value, onDrag, onRelease }: { value: Importance; onDrag: (v: Importance) => void; onRelease: () => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Axis | null>(null)
  const pt = (k: Axis) => [100 + RAX[k][0] * R * value[k], 100 + RAX[k][1] * R * value[k]] as const
  const move = (e: React.PointerEvent) => {
    const k = drag.current
    const el = svg.current
    if (!k || !el) return
    const p = el.createSVGPoint()
    p.x = e.clientX
    p.y = e.clientY
    const q = p.matrixTransform(el.getScreenCTM()!.inverse())
    // How far along its own axis the pointer is, 0 at the centre and 1 at the rim.
    const along = ((q.x - 100) * RAX[k][0] + (q.y - 100) * RAX[k][1]) / R
    onDrag({ ...value, [k]: Math.min(1, Math.max(0.02, along)) })
  }
  const up = () => { if (drag.current) { drag.current = null; onRelease() } }
  return (
    <svg ref={svg} viewBox="-40 -12 280 224" className="w-full max-w-72 touch-none select-none" onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="group" aria-label="Blend by: drag a dot out to make that axis count more">
      {[0.25, 0.5, 0.75, 1].map(r => <path key={r} d={`M100,${100 - R * r} ${100 + R * r},100 100,${100 + R * r} ${100 - R * r},100Z`} fill="none" stroke={`oklch(45% .03 240 / ${r === 1 ? 0.6 : 0.25})`} />)}
      {AXES.map(k => <line key={k} x1={100} y1={100} x2={100 + RAX[k][0] * R} y2={100 + RAX[k][1] * R} stroke="oklch(45% .03 240 / .4)" />)}
      <path d={`M${AXES.map(k => pt(k).join(',')).join(' ')}Z`} fill="oklch(72% .16 230 / .18)" stroke="oklch(72% .16 230 / .8)" strokeWidth={1.5} />
      {AXES.map(k => {
        const [x, y] = pt(k)
        return <circle key={k} cx={x} cy={y} r={8.5} fill={AXIS_COLOR[k]} stroke="oklch(18% .03 240)" strokeWidth={2.5} className="cursor-grab"
          onPointerDown={e => { drag.current = k; (e.target as Element).setPointerCapture(e.pointerId) }}>
          <title>{AXIS_LABEL[k]}</title>
        </circle>
      })}
      {AXES.map(k => (
        <text key={k} x={100 + RAX[k][0] * 92} y={100 + RAX[k][1] * 94 + 4} textAnchor={RAX[k][0] < 0 ? 'end' : RAX[k][0] > 0 ? 'start' : 'middle'} fontSize={11.5} fontWeight={600} fill={AXIS_COLOR[k]}>{AXIS_LABEL[k]}</text>
      ))}
    </svg>
  )
}

export default function BlendBy({ joins, score, hasSet, sheet = false }: { joins?: Join[]; score?: number; hasSet: boolean; /** A phone: the panel is a bottom sheet over the page. */ sheet?: boolean }) {
  const { importance, welcome } = useBlendWeights()
  const [open, setOpen] = useState(false)
  // The radar moves freely; the set re-orders once the dot is let go.
  const [draft, setDraft] = useState<Importance | null>(null)
  const shown = draft ?? importance
  const eff = effectOf(joins, score)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const name = importanceName(shown)
  const s = shares(shown)
  const short = hasSet && joins ? `set ${eff.score ?? '…'} blend · ${eff.clashes} ${eff.clashes === 1 ? 'clash' : 'clashes'}` : 'your set is empty'
  return (
    <div className="sticky top-[calc(var(--top-card-h,4.25rem)+env(safe-area-inset-top)+0.5rem)] z-20 md:top-0">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-xs backdrop-blur ${open ? 'bg-base-300' : 'bg-base-300/90 hover:bg-base-300'}`}>
        <Bars i={shown} />
        <span className="text-base-content/60">Blend by</span>
        <b className="font-semibold">{leadOf(shown)}</b>
        <span className="hidden text-base-content/55 sm:inline">· Harmony: {welcomeName(welcome)}</span>
        <span className="flex-1" />
        <span className="truncate text-base-content/55">{short}</span>
        <Ic name="up" size={13} className={`transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      {open && sheet && <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />}
      {open && (
        <div role={sheet ? 'dialog' : undefined} aria-label="Blend by" className={`flex flex-col gap-3 overflow-y-auto bg-base-300 p-3 shadow-xl ${sheet ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'absolute inset-x-0 top-full mt-1 max-h-[calc(100vh-260px)] rounded-2xl'}`}>
          <div className="flex flex-wrap items-center gap-4">
            <Radar value={shown} onDrag={setDraft} onRelease={() => { if (draft) setImportance(draft); setDraft(null) }} />
            <div className="flex min-w-56 flex-1 flex-col gap-2">
              <p className="text-sm"><b>Blend by</b> <span className="text-base-content/60">what Best blend cares about between two tracks</span></p>
              <div className="flex flex-wrap gap-3 text-xs">
                {AXES.map(k => <span key={k} className="flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: AXIS_COLOR[k] }} />{AXIS_LABEL[k]} <b className="tabular-nums">{Math.round(s[k] * 100)}%</b></span>)}
              </div>
              <p className="text-[11px] text-base-content/45">Drag a dot out to make that axis count more, in to make it count less.</p>
              <div className="flex flex-wrap gap-1">
                {IMPORTANCE_PRESETS.map(([n, v]) => (
                  <button key={n} onClick={() => setImportance(v)} aria-pressed={name === n} className={`rounded-lg px-2 py-1 text-xs ${name === n ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70 hover:bg-white/10'}`}>{n}</button>
                ))}
                {name === 'Custom' && <span className="rounded-lg bg-white/10 px-2 py-1 text-xs">Custom</span>}
              </div>
            </div>
          </div>
          <HarmonyMoves counts={eff.counts} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <p className="text-base-content/70">
              {hasSet && joins
                ? <>Your set: <b className="tabular-nums">{eff.score ?? '…'}</b> blend · <b className="tabular-nums">{eff.clashes}</b> {eff.clashes === 1 ? 'clash' : 'clashes'} · <b className="tabular-nums">{eff.transposed}</b> lift/drop · <b className="tabular-nums">{eff.genreChanges}</b> genre {eff.genreChanges === 1 ? 'change' : 'changes'}</>
                : 'Add tracks to your set to see what this changes.'}
            </p>
            <span className="flex-1" />
            <span className="text-[11px] text-base-content/45">Tempo is kept close on its own.</span>
            <button onClick={() => setOpen(false)} className="btn btn-sm rounded-xl">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
