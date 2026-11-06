import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  KINDS, LENGTHS, playFlow, refreshFlows, saveFlow, useFlows,
  type Chunk, type Condition, type Flow, type GenreBlock, type Layers,
} from '../../../musicFlows'
import type { MusicTrack } from '../../../musicLibrary'
import { useSummaries } from '../../../musicMeta'
import { branchAt, deleteChunk, insertChunk, pathOf, resize, spansOf, type FlowDoc } from './flowEdit'

// The flow editor (SPEC-music-flows §8, board 3): lanes of layers over the path, presets, forks.
// Desktop shows the whole path; a phone shows one chunk at a time, and a point or an event is
// grabbed after a long press so that scrolling the page and dragging do not fight.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }
const MODULATIONS = ['up', 'down', 'mode+', 'mode-', 'relative', 'break']
const PULLS: Flow['pull'][] = ['light', 'strong', 'only']
const HOLD_MS = 320

const CHUNK_PRESETS: Record<string, Layers> = {
  'Warm-up': { tempo: [[0, 170], [1, 172]], energy: [[0, 0.2], [1, 0.5]], harmony: [] },
  Peak: { tempo: [[0, 172], [1, 175]], energy: [[0, 0.65], [1, 0.95]], harmony: [{ at: 0.5, kind: 'up' }] },
  Plateau: { tempo: [[0, 172], [1, 172]], energy: [[0, 0.55], [1, 0.55]], harmony: [] },
  Deep: { energy: [[0, 0.35], [1, 0.45]], harmony: [{ at: 0.5, kind: 'mode-' }] },
  'Come-down': { tempo: [[0, 172], [1, 145]], energy: [[0, 0.6], [1, 0.15]], harmony: [{ at: 0, kind: 'break' }, { at: 0.5, kind: 'relative' }] },
}
const LAYER_PRESETS: Record<string, [keyof Layers, Layers[keyof Layers]]> = {
  Climb: ['energy', [[0, 0.2], [1, 0.9]]],
  Wave: ['energy', [[0, 0.3], [0.33, 0.8], [0.66, 0.3], [1, 0.8]]],
  Glide: ['tempo', [[0, 165], [1, 175]]],
  'Match only': ['harmony', []],
  'One lift': ['harmony', [{ at: 0.6, kind: 'up' }]],
  'Lift, then home': ['harmony', [{ at: 0.4, kind: 'up' }, { at: 0.8, kind: 'down' }]],
  Reset: ['harmony', [{ at: 0, kind: 'break' }]],
}

type LaneId = 'tempo' | 'energy' | 'harmony' | 'genre' | 'mix'
interface Lane { id: LaneId; label: string; h: number; lo?: number; hi?: number }
const LANES: Lane[] = [
  { id: 'tempo', label: 'Tempo', h: 120, lo: 120, hi: 180 },
  { id: 'energy', label: 'Energy', h: 100, lo: 0, hi: 1 },
  { id: 'harmony', label: 'Harmony', h: 40 },
  { id: 'genre', label: 'Genre', h: 34 },
  { id: 'mix', label: 'Mix', h: 50 },
]
const GAP = 8
const TOP = 6
let y = TOP
const LANE_Y = Object.fromEntries(LANES.map(l => { const at = y; y += l.h + GAP; return [l.id, at] })) as Record<LaneId, number>
const HEIGHT = y

type Selection =
  | { kind: 'point'; chunk: string; lane: 'tempo' | 'energy'; i: number }
  | { kind: 'event'; chunk: string; i: number }
  | { kind: 'genre'; chunk: string; i: number }
  | null

interface Rendered {
  path: string[]
  auto: Record<string, string>
  minutes: number
  mix: { at: number; chunk: string; track_id: string; join: string | null; relaxed: string[] }[]
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
/** The element's content width, followed as it changes; 0 until it is in the page. */
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

export default function FlowEditor({ flowId, byId }: { flowId: string; byId: Map<string, MusicTrack> }) {
  const { flows, loaded } = useFlows()
  const saved = flows.find(f => f.id === flowId)
  const [doc, setDoc] = useState<FlowDoc | null>(null)
  const [name, setName] = useState('')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState<Selection>(null)
  const [chunkSel, setChunkSel] = useState<string>('')
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const W = useWidth(box) || 800
  const narrow = W < 640

  // The saved flow is the starting point (set while rendering, once it arrives); edits stay local until Save.
  if (saved && !doc) { setDoc(clone(saved)); setName(saved.name) }

  // Re-render the mix a moment after each change (the server's generator, the same as playing it).
  useEffect(() => {
    if (!doc) return
    const t = window.setTimeout(() => {
      fetch('/api/music/flows/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow: doc, choices }),
      }).then(r => (r.ok ? r.json() : null)).then(r => r && setRendered(r)).catch(() => {})
    }, 250)
    return () => window.clearTimeout(t)
  }, [doc, choices])

  const ids = useMemo(() => rendered?.mix.map(m => m.track_id) ?? [], [rendered])
  const { get } = useSummaries(ids)

  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ act: (x: number, y: number) => void; armed: boolean; timer?: number; x0: number; y0: number } | null>(null)
  // A held touch keeps the page still: the first touchmove after the long press is cancelled.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const stop = (e: TouchEvent) => { if (drag.current?.armed) e.preventDefault() }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  })

  if (!loaded || !doc) return <span className="loading loading-dots loading-sm text-base-content/40" />
  if (!saved) return <p className="text-sm text-base-content/60">This flow no longer exists.</p>

  const path = pathOf(doc, choices, rendered?.auto)
  const spans = spansOf(path)
  const selected = path.find(c => c.id === chunkSel) ?? path[0]
  const view = narrow ? spans.find(s => s.c.id === selected.id)! : { a: 0, b: 1 }
  const PADL = narrow ? 52 : 70, PADR = 10
  const xOf = (f: number) => PADL + ((f - view.a) / (view.b - view.a || 1)) * (W - PADL - PADR)
  const fOf = (x: number) => view.a + ((x - PADL) / (W - PADL - PADR)) * (view.b - view.a)
  const yOf = (l: Lane, v: number) => LANE_Y[l.id] + l.h - 6 - ((v - l.lo!) / (l.hi! - l.lo!)) * (l.h - 12)
  const vOf = (l: Lane, py: number) => l.lo! + ((LANE_Y[l.id] + l.h - 6 - py) / (l.h - 12)) * (l.hi! - l.lo!)
  const local = (c: Chunk, f: number) => { const s = spans.find(x => x.c.id === c.id)!; return Math.min(1, Math.max(0, (f - s.a) / (s.b - s.a))) }
  const lane = (id: LaneId) => LANES.find(l => l.id === id)!
  const shown = narrow ? spans.filter(s => s.c.id === selected.id) : spans
  const totalSec = (rendered?.minutes ?? 60) * 60

  const change = (f: FlowDoc) => { setDoc(f); setDirty(true) }
  const editChunk = (id: string, fn: (c: Chunk) => void) => {
    const f = clone(doc)
    fn(f.chunks.find(c => c.id === id)!)
    change(f)
  }

  // --- pointer: drag points, events and boundaries; a long press first on touch -------------------
  const pt = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return [e.clientX - r.left, (e.clientY - r.top) * (HEIGHT / r.height)] as const
  }
  const start = (e: RPointerEvent, act: (x: number, y: number) => void, onArm?: () => void) => {
    e.stopPropagation()
    const touch = e.pointerType === 'touch'
    const d = { act, armed: !touch, x0: e.clientX, y0: e.clientY, timer: undefined as number | undefined }
    drag.current = d
    const id = e.pointerId
    if (touch) {
      d.timer = window.setTimeout(() => { d.armed = true; svg.current?.setPointerCapture(id); navigator.vibrate?.(10); onArm?.() }, HOLD_MS)
    } else {
      svg.current?.setPointerCapture(id)
      onArm?.()
    }
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.armed) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) { window.clearTimeout(d.timer); drag.current = null }
      return
    }
    const [x, py] = pt(e)
    d.act(x, py)
  }
  const end = () => { if (drag.current) window.clearTimeout(drag.current.timer); drag.current = null }

  const dragPoint = (c: Chunk, ln: 'tempo' | 'energy', i: number) => (x: number, py: number) => {
    const l = lane(ln)
    editChunk(c.id, cc => {
      const pts = cc.layers[ln]!
      let f = pts[i][0]
      if (i > 0 && i < pts.length - 1) f = Math.min(pts[i + 1][0] - 0.02, Math.max(pts[i - 1][0] + 0.02, local(c, fOf(x))))
      const v = Math.min(l.hi!, Math.max(l.lo!, vOf(l, py)))
      pts[i] = [f, ln === 'tempo' ? Math.round(v) : Math.round(v * 100) / 100]
    })
  }
  const dragEvent = (c: Chunk, i: number) => (x: number) => {
    editChunk(c.id, cc => { cc.layers.harmony![i].at = Math.round(local(c, fOf(x)) * 100) / 100 })
  }
  const dragBoundary = (i: number) => (x: number) => change(resize(doc, path, i, fOf(x)))

  const addPoint = (c: Chunk, ln: 'tempo' | 'energy', x: number, py: number) => {
    const l = lane(ln)
    const v = ln === 'tempo' ? Math.round(vOf(l, py)) : Math.round(vOf(l, py) * 100) / 100
    editChunk(c.id, cc => {
      const pts = cc.layers[ln]
      if (!pts) { cc.layers[ln] = [[0, v], [1, v]]; return }
      const f = local(c, fOf(x))
      const at = pts.findIndex(p => p[0] > f)
      pts.splice(at < 0 ? pts.length : at, 0, [f, v])
    })
  }
  const addEvent = (c: Chunk, x: number) => {
    editChunk(c.id, cc => {
      cc.layers.harmony = [...(cc.layers.harmony ?? []), { at: Math.round(local(c, fOf(x)) * 100) / 100, kind: 'up' }]
    })
    setSel({ kind: 'event', chunk: c.id, i: (c.layers.harmony ?? []).length })
  }

  // --- presets: a click applies to the selected chunk; a drag drops where it lands (desktop) ---------
  const applyChunkPreset = (n: string, index = path.indexOf(selected) + 1) => change(insertChunk(doc, path, index, n, CHUNK_PRESETS[n]))
  const applyLayerPreset = (n: string, chunkId = selected.id) => {
    const [ln, val] = LAYER_PRESETS[n]
    editChunk(chunkId, cc => { (cc.layers as Record<string, unknown>)[ln] = clone(val) })
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const [type, n] = e.dataTransfer.getData('text/plain').split('|')
    const [x, py] = pt(e)
    const f = fOf(x)
    const s = spans.find(z => z.a <= f && f < z.b) ?? spans.at(-1)!
    if (type === 'chunk') applyChunkPreset(n, path.indexOf(s.c) + (f - s.a > (s.b - s.a) / 2 ? 1 : 0))
    else {
      const ln = LAYER_PRESETS[n][0]
      const top = LANE_Y[ln as LaneId], h = lane(ln as LaneId).h
      if (py >= top - GAP && py <= top + h + GAP) applyLayerPreset(n, s.c.id)
    }
  }

  const save = async (asPreset = false) => {
    const body = { chunks: doc.chunks, pull: doc.pull, length: doc.length, preset: asPreset }
    await saveFlow(asPreset ? `${name} (preset)` : name, body, asPreset ? undefined : flowId)
    if (!asPreset) setDirty(false)
    await refreshFlows()
  }

  // --- what the toolbar offers for the current selection -------------------------------------------
  const selChunk = sel ? doc.chunks.find(c => c.id === sel.chunk) : undefined
  const genres = [...new Set(ids.map(id => get(id)?.genre).filter(Boolean) as string[])].sort()
  const toolbar = (() => {
    if (sel?.kind === 'event' && selChunk?.layers.harmony?.[sel.i]) {
      const ev = selChunk.layers.harmony[sel.i]
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-base-content/60">Event</span>
          {MODULATIONS.map(k => (
            <button key={k} aria-pressed={ev.kind === k} onClick={() => editChunk(sel.chunk, cc => { cc.layers.harmony![sel.i].kind = k })}
              className={`btn btn-xs ${ev.kind === k ? (k === 'break' ? 'btn-error' : 'btn-primary') : 'btn-ghost bg-white/6'}`}>{KINDS[k]}</button>
          ))}
          <button onClick={() => { editChunk(sel.chunk, cc => { cc.layers.harmony!.splice(sel.i, 1) }); setSel(null) }} className="btn btn-xs btn-ghost text-error">Remove</button>
        </div>
      )
    }
    if (sel?.kind === 'point' && selChunk?.layers[sel.lane]?.[sel.i]) {
      const pts = selChunk.layers[sel.lane]!
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-base-content/60">{sel.lane === 'tempo' ? `${pts[sel.i][1]} BPM` : `energy ${pts[sel.i][1]}`}</span>
          <button onClick={() => { editChunk(sel.chunk, cc => { if (pts.length <= 2) delete cc.layers[sel.lane]; else cc.layers[sel.lane]!.splice(sel.i, 1) }); setSel(null) }}
            className="btn btn-xs btn-ghost text-error">{pts.length <= 2 ? `Remove the ${sel.lane} layer` : 'Remove point'}</button>
        </div>
      )
    }
    if (sel?.kind === 'genre' && selChunk?.layers.genre?.[sel.i]) {
      const bl = selChunk.layers.genre[sel.i]
      const toggle = (g: string) => editChunk(sel.chunk, cc => {
        const b = cc.layers.genre![sel.i]
        b.genres = b.genres.includes(g) ? b.genres.filter(x => x !== g) : [...b.genres, g]
      })
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-base-content/60">Genre</span>
          {genres.map(g => (
            <button key={g} aria-pressed={bl.genres.includes(g)} onClick={() => toggle(g)}
              className={`btn btn-xs ${bl.genres.includes(g) ? 'btn-primary' : 'btn-ghost bg-white/6'}`}>{g}</button>
          ))}
          <button onClick={() => editChunk(sel.chunk, cc => { const b = cc.layers.genre![sel.i]; b.strict = b.strict === 'prefer' ? 'must' : 'prefer' })}
            className="btn btn-xs btn-ghost bg-white/6">{bl.strict === 'prefer' ? 'Prefer' : 'Must'}</button>
          <button onClick={() => { editChunk(sel.chunk, cc => { cc.layers.genre!.splice(sel.i, 1) }); setSel(null) }} className="btn btn-xs btn-ghost text-error">Remove</button>
        </div>
      )
    }
    return null
  })()

  // --- the score -------------------------------------------------------------------------------------
  const curve = (s: (typeof spans)[number], ln: 'tempo' | 'energy') => {
    const c = s.c, l = lane(ln), pts = c.layers[ln]
    const xa = xOf(s.a), xb = xOf(s.b)
    if (!pts) {
      return (
        <g key={`${c.id}${ln}`} onPointerDown={e => { const [x, py] = pt(e); addPoint(c, ln, x, py) }} className="cursor-copy">
          <rect x={xa + 2} y={LANE_Y[ln] + 2} width={Math.max(0, xb - xa - 4)} height={l.h - 4} rx="4" className="fill-transparent stroke-base-300" strokeDasharray="4 4" />
          <text x={(xa + xb) / 2} y={LANE_Y[ln] + l.h / 2 + 4} textAnchor="middle" className="fill-base-content/40 text-[11px]">no constraint · tap to add</text>
        </g>
      )
    }
    const band = ln === 'tempo' ? 3 : 0.2
    const N = 20
    const at = (f: number) => {
      const i = pts.findIndex(p => p[0] >= f)
      if (i <= 0) return pts[Math.max(0, i)][1]
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
      return y0 + ((y1 - y0) * (f - x0)) / (x1 - x0 || 1)
    }
    const xs = Array.from({ length: N + 1 }, (_, k) => k / N)
    const up = xs.map(f => `${xOf(s.a + (s.b - s.a) * f)},${yOf(l, Math.min(l.hi!, at(f) + band))}`)
    const dn = xs.map(f => `${xOf(s.a + (s.b - s.a) * f)},${yOf(l, Math.max(l.lo!, at(f) - band))}`).reverse()
    return (
      <g key={`${c.id}${ln}`}>
        <rect
          x={xa} y={LANE_Y[ln]} width={xb - xa} height={l.h} className="fill-transparent"
          onDoubleClick={e => { const [x, py] = pt(e); addPoint(c, ln, x, py) }}
          onPointerDown={e => { if (e.pointerType === 'touch') start(e, () => {}, () => { const [x, py] = pt(e); addPoint(c, ln, x, py) }) }}
        />
        <polygon points={[...up, ...dn].join(' ')} className="pointer-events-none fill-primary/14" />
        <polyline points={xs.map(f => `${xOf(s.a + (s.b - s.a) * f)},${yOf(l, at(f))}`).join(' ')} className="pointer-events-none fill-none stroke-primary" strokeWidth="1.5" />
        {pts.map(([f, v], i) => {
          const on = sel?.kind === 'point' && sel.chunk === c.id && sel.lane === ln && sel.i === i
          return (
            <circle
              key={i} cx={xOf(s.a + (s.b - s.a) * f)} cy={yOf(l, v)} r={narrow ? 9 : 6}
              className={`cursor-grab stroke-primary ${on ? 'fill-primary' : 'fill-base-100'}`} strokeWidth="2"
              onPointerDown={e => start(e, dragPoint(c, ln, i), () => setSel({ kind: 'point', chunk: c.id, lane: ln, i }))}
              onContextMenu={e => { e.preventDefault(); setSel({ kind: 'point', chunk: c.id, lane: ln, i }) }}
            >
              <title>{ln === 'tempo' ? `${v} BPM` : `energy ${v}`}</title>
            </circle>
          )
        })}
      </g>
    )
  }

  const mixIn = (rendered?.mix ?? []).filter(m => shown.some(s => s.c.id === m.chunk))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Flow name" value={name} onChange={e => { setName(e.target.value); setDirty(true) }}
          className="input input-sm w-44 font-semibold"
        />
        <select aria-label="Length" value={doc.length} onChange={e => change({ ...doc, length: e.target.value as Flow['length'] })} className="select select-sm w-auto">
          {LENGTHS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <select aria-label="Harmony pull" value={doc.pull} onChange={e => change({ ...doc, pull: e.target.value as Flow['pull'] })} className="select select-sm w-auto" title="How much the key pulls the choice; it never excludes a track">
          {PULLS.map(p => <option key={p} value={p}>pull {p}</option>)}
        </select>
        <span className="flex-1" />
        <button onClick={() => run(save(true))} className="btn btn-ghost btn-sm max-sm:hidden">Save as preset</button>
        <button onClick={() => run(save())} disabled={!dirty} className="btn btn-sm">{dirty ? 'Save' : 'Saved'}</button>
        <button onClick={() => run(save().then(() => playFlow(flowId, { choices })))} className="btn btn-primary btn-sm">Play</button>
      </div>

      {/* The path through the flow: chunks in order, a fork's futures as pills (auto = the generator's pick). */}
      <div className="flex flex-wrap items-center gap-1" aria-label="Path">
        {path.map((c, i) => {
          const parent = path[i - 1]
          const fork = parent && parent.next.length > 1
          return (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-base-content/30">›</span>}
              {fork ? (
                <span role="group" aria-label={`Fork after ${parent.id}`} className="flex rounded-md bg-white/5 p-0.5">
                  {parent.next.map(n => (
                    <button key={n} aria-pressed={n === c.id}
                      onClick={() => { setChoices({ ...choices, [parent.id]: n }); setChunkSel(n) }}
                      className={`h-7 rounded px-2 text-xs ${n === c.id ? (n === selected.id ? 'bg-primary text-primary-content' : 'bg-primary/25 text-primary') : 'text-base-content/55 hover:bg-white/8'}`}>
                      {n}{!choices[parent.id] && rendered?.auto[parent.id] === n ? ' · auto' : ''}
                    </button>
                  ))}
                </span>
              ) : (
                <button onClick={() => setChunkSel(c.id)} aria-pressed={c.id === selected.id}
                  className={`h-7 rounded-md px-2.5 text-xs ${c.id === selected.id ? 'bg-primary text-primary-content' : 'bg-primary/15 text-primary hover:bg-primary/25'}`}>
                  {c.id}
                </button>
              )}
            </span>
          )
        })}
        <span className="mx-1 h-5 w-px bg-base-300" />
        <button onClick={() => { const r = branchAt(doc, path, selected.id); if (r) { change(r[0]); setChoices({ ...choices, [path[path.indexOf(selected) - 1].id]: r[1] }); setChunkSel(r[1]) } }}
          disabled={path.indexOf(selected) === 0} className="btn btn-ghost btn-xs">Branch here</button>
        <button onClick={() => { change(deleteChunk(doc, selected.id)); setChunkSel('') }} disabled={doc.chunks.length <= 1} className="btn btn-ghost btn-xs text-error">Delete {selected.id}</button>
      </div>

      {(() => {
        // A future of a fork can be taken on its own: after skips, after a while, after a time.
        const i = path.indexOf(selected), parent = path[i - 1]
        if (!parent || parent.next.length < 2) return null
        const cond = parent.when?.[selected.id]
        const set = (c: Condition | null) => editChunk(parent.id, cc => {
          const w = { ...(cc.when ?? {}) }
          if (c) w[selected.id] = c
          else delete w[selected.id]
          cc.when = Object.keys(w).length ? w : undefined
        })
        const pick = (k: string) => set(k === 'skips' ? { kind: 'skips', count: 2, of: 4 } : k === 'session' ? { kind: 'session', minutes: 60 } : k === 'time' ? { kind: 'time', after: '23:00' } : null)
        return (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-base-content/60">Take <b className="font-semibold text-base-content">{selected.id}</b> on its own</span>
            <select aria-label="Condition" value={cond?.kind ?? ''} onChange={e => pick(e.target.value)} className="select select-xs w-auto">
              <option value="">never: the choice or the generator</option>
              <option value="skips">when tracks get skipped</option>
              <option value="session">after a while</option>
              <option value="time">after a time of night</option>
            </select>
            {cond?.kind === 'skips' && (
              <span className="flex items-center gap-1">
                <input aria-label="Skips" type="number" min={1} max={cond.of} value={cond.count} onChange={e => set({ ...cond, count: Number(e.target.value) || 1 })} className="input input-xs w-12" />
                of the last
                <input aria-label="Tracks" type="number" min={1} max={10} value={cond.of} onChange={e => set({ ...cond, of: Number(e.target.value) || 4 })} className="input input-xs w-12" />
                skipped
              </span>
            )}
            {cond?.kind === 'session' && (
              <span className="flex items-center gap-1">after <input aria-label="Minutes" type="number" min={5} step={5} value={cond.minutes} onChange={e => set({ ...cond, minutes: Number(e.target.value) || 60 })} className="input input-xs w-16" /> min of the mix</span>
            )}
            {cond?.kind === 'time' && (
              <span className="flex items-center gap-1">after <input aria-label="Time" type="time" value={cond.after} onChange={e => set({ ...cond, after: e.target.value || '23:00' })} className="input input-xs w-24" /></span>
            )}
          </div>
        )
      })()}

      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Presets">
        {Object.keys(CHUNK_PRESETS).map(n => (
          <button key={n} draggable onDragStart={e => e.dataTransfer.setData('text/plain', `chunk|${n}`)} onClick={() => applyChunkPreset(n)}
            title={`Insert after ${selected.id}`} className="shrink-0 rounded-full border border-base-300 bg-base-200 px-3 py-1 text-xs font-medium">{n}</button>
        ))}
        {Object.entries(LAYER_PRESETS).map(([n, [ln]]) => (
          <button key={n} draggable onDragStart={e => e.dataTransfer.setData('text/plain', `layer|${n}`)} onClick={() => applyLayerPreset(n)}
            title={`Replace the ${ln} of ${selected.id}`} className="shrink-0 rounded-full border border-dashed border-base-300 bg-base-200 px-3 py-1 text-xs font-medium">
            {n} <span className="text-base-content/50">{ln}</span>
          </button>
        ))}
      </div>

      {toolbar && <div className="rounded-box bg-base-200 px-3 py-2">{toolbar}</div>}

      <div ref={setBox} className="rounded-box bg-base-200 p-2">
        <svg
          ref={svg} width={W} height={HEIGHT} viewBox={`0 0 ${W} ${HEIGHT}`} className="block select-none"
          onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onDragOver={e => e.preventDefault()} onDrop={onDrop}
        >
          {LANES.map(l => (
            <g key={l.id}>
              {l.id !== 'mix' && <rect x={PADL} y={LANE_Y[l.id]} width={W - PADL - PADR} height={l.h} rx="4" className="fill-base-100" />}
              <text x="6" y={LANE_Y[l.id] + 15} className="fill-base-content/60 text-[11px]">{l.label}</text>
            </g>
          ))}
          {[140, 160, 180].map(v => (
            <text key={v} x={PADL - 6} y={yOf(lane('tempo'), v) + 4} textAnchor="end" className="fill-base-content/40 text-[10px] tabular-nums">{v}</text>
          ))}
          {shown.map(s => [curve(s, 'tempo'), curve(s, 'energy')])}
          {shown.map(s => {
            const c = s.c, xa = xOf(s.a), xb = xOf(s.b), ly = LANE_Y.harmony, lh = lane('harmony').h
            const evs = c.layers.harmony
            return (
              <g key={`${c.id}h`}>
                {!evs ? (
                  <g onPointerDown={() => editChunk(c.id, cc => { cc.layers.harmony = [] })} className="cursor-copy">
                    <rect x={xa + 2} y={ly + 2} width={Math.max(0, xb - xa - 4)} height={lh - 4} rx="4" className="fill-transparent stroke-base-300" strokeDasharray="4 4" />
                    <text x={(xa + xb) / 2} y={ly + 24} textAnchor="middle" className="fill-base-content/40 text-[11px]">free · tap to follow the key</text>
                  </g>
                ) : (
                  <>
                    <rect x={xa + 2} y={ly + 2} width={Math.max(0, xb - xa - 4)} height={lh - 4} rx="4" className="cursor-copy fill-primary/8"
                      onClick={e => { const [x] = pt(e); addEvent(c, x) }}
                      onContextMenu={e => { e.preventDefault(); editChunk(c.id, cc => { delete cc.layers.harmony }) }}>
                      <title>Match: every join stays in key. Tap to place a modulation; right-click to free the chunk.</title>
                    </rect>
                    {!evs.length && <text x={xa + 8} y={ly + 24} className="pointer-events-none fill-base-content/50 text-[11px]">match</text>}
                    {evs.map((ev, i) => {
                      const x = xOf(s.a + (s.b - s.a) * ev.at)
                      const brk = ev.kind === 'break'
                      const on = sel?.kind === 'event' && sel.chunk === c.id && sel.i === i
                      return (
                        <g key={i} className="cursor-grab" onPointerDown={e => start(e, dragEvent(c, i), () => setSel({ kind: 'event', chunk: c.id, i }))}>
                          <rect x={x - 10} y={ly} width="20" height={lh} className="fill-transparent" />
                          <line x1={x} x2={x} y1={ly + 3} y2={ly + lh - 3} className={brk ? 'stroke-error' : 'stroke-primary'} strokeWidth="2" strokeDasharray={brk ? '3 3' : undefined} />
                          <path d={`M${x - 6},${ly + 3} l6,7 l6,-7z`} className={`${brk ? 'stroke-error' : 'stroke-primary'} ${on ? (brk ? 'fill-error' : 'fill-primary') : 'fill-base-100'}`} strokeWidth="1.5" />
                          <text x={x + 8} y={ly + 25} className="fill-base-content text-[11px]">{KINDS[ev.kind] ?? ev.kind}</text>
                        </g>
                      )
                    })}
                  </>
                )}
              </g>
            )
          })}
          {shown.map(s => {
            const c = s.c, xa = xOf(s.a), xb = xOf(s.b), ly = LANE_Y.genre, lh = lane('genre').h
            const blocks: GenreBlock[] = c.layers.genre ?? []
            if (!blocks.length) {
              return (
                <g key={`${c.id}g`} className="cursor-copy" onPointerDown={() => { editChunk(c.id, cc => { cc.layers.genre = [{ from: 0, to: 1, genres: genres.slice(0, 1) }] }); setSel({ kind: 'genre', chunk: c.id, i: 0 }) }}>
                  <rect x={xa + 2} y={ly + 2} width={Math.max(0, xb - xa - 4)} height={lh - 4} rx="4" className="fill-transparent stroke-base-300" strokeDasharray="4 4" />
                  <text x={(xa + xb) / 2} y={ly + 21} textAnchor="middle" className="fill-base-content/40 text-[11px]">any genre</text>
                </g>
              )
            }
            return blocks.map((bl, i) => {
              const x1 = xOf(s.a + (s.b - s.a) * bl.from), x2 = xOf(s.a + (s.b - s.a) * bl.to)
              const prefer = bl.strict === 'prefer'
              return (
                <g key={`${c.id}g${i}`} className="cursor-pointer" onClick={() => setSel({ kind: 'genre', chunk: c.id, i })}>
                  <rect x={x1 + 2} y={ly + 3} width={Math.max(0, x2 - x1 - 4)} height={lh - 6} rx="4"
                    className={prefer ? 'fill-transparent stroke-primary/70' : 'fill-primary/18 stroke-primary/35'} strokeDasharray={prefer ? '4 3' : undefined} />
                  <text x={x1 + 8} y={ly + 21} className="fill-base-content text-[11px]">{bl.genres.join(', ') || 'any'}{prefer ? ' · prefer' : ''}</text>
                </g>
              )
            })
          })}
          {/* Chunk boundaries: drag to give one chunk more of the length (desktop). */}
          {!narrow && spans.slice(1).map((s, k) => (
            <g key={`b${s.c.id}`}>
              <line x1={xOf(s.a)} x2={xOf(s.a)} y1={TOP} y2={HEIGHT} className="stroke-base-300" />
              <rect x={xOf(s.a) - 5} y={TOP} width="10" height={LANE_Y.mix - TOP} className="cursor-ew-resize fill-transparent" onPointerDown={e => start(e, dragBoundary(k + 1))} />
            </g>
          ))}
          {/* The rendered mix: each track at its start, on the curves and as a chip. */}
          {mixIn.map((m, i) => {
            const f = m.at / totalSec
            if (f < view.a || f > view.b) return null
            const x = xOf(f), s = get(m.track_id), relaxed = m.relaxed.some(r => r !== 'pin')
            const bpm = s?.bpm, e = s?.energyScale?.track
            const lt = lane('tempo'), le = lane('energy')
            const title = byId.get(m.track_id)?.title ?? m.track_id
            return (
              <g key={`${m.track_id}${i}`}>
                {bpm && bpm >= lt.lo! && bpm <= lt.hi! && <circle cx={x} cy={yOf(lt, bpm)} r="3" className={`pointer-events-none ${relaxed ? 'fill-error' : 'fill-base-content'}`} />}
                {e !== undefined && <circle cx={x} cy={yOf(le, e / 100)} r="3" className={`pointer-events-none ${relaxed ? 'fill-error' : 'fill-base-content'}`} />}
                <g transform={`translate(${x + 1},${LANE_Y.mix + 4 + (i % 2) * 22})`}>
                  <rect width={narrow ? 120 : 84} height="19" rx="4" className={relaxed ? 'fill-error/15 stroke-error/60' : 'fill-base-300'} />
                  <text x="6" y="13" className="fill-base-content text-[11px]">{title.length > (narrow ? 17 : 12) ? `${title.slice(0, narrow ? 16 : 11)}…` : title}</text>
                  <title>{title}{m.join ? ` · ${KINDS[m.join] ?? m.join}` : ''}{relaxed ? ` · relaxed: ${m.relaxed.join(', ')}` : ''}</title>
                </g>
              </g>
            )
          })}
        </svg>
      </div>

      {narrow && (
        <ul aria-label={`Mix in ${selected.id}`} className="rounded-box bg-base-200 p-1.5">
          {mixIn.map((m, i) => (
            <li key={`${m.track_id}${i}`} className="flex h-12 items-center gap-2 px-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{byId.get(m.track_id)?.title ?? m.track_id}</span>
              {m.join && <span className={`rounded bg-white/7 px-1.5 text-[11px] ${m.join === 'break' ? 'text-error' : 'text-base-content/70'}`}>{KINDS[m.join] ?? m.join}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-base-content/50">
        {narrow
          ? 'Hold a point or an event, then drag it. Tap a lane to add to it; tap a point to remove it.'
          : 'Drag points and events; double-click a curve to add a point; tap the harmony lane to place a modulation (every other join is a match). Drag a preset onto the score to place it; click it to apply it to the selected chunk.'}
      </p>
    </div>
  )
}
