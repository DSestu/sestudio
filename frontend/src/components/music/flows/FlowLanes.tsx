import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { playFlow, refreshFlows, saveFlow, useFlows, type Flow } from '../../../musicFlows'
import type { MusicTrack } from '../../../musicLibrary'
import {
  ANY, COLOURS, ENERGY, KINDS, addBrick, fresh, fromFlow, genreLabel, pullEdge, remove, setValue, split, starts, stretches, swap, toFlow, total,
  type LaneKind, type Lanes, type Stretch,
} from './lanes'

// The flow editor: three lanes of bricks (energy, genre, key colour) over the night, dragged in from
// a palette, resized by their edges, split and removed; the Library row says where tracks run short.
// Design: docs/proto/flows/lanes.html (Lanes, tinted bricks, Search genre drawer).

const run = (p: Promise<unknown>) => { p.catch(() => {}) }
const LABEL: Record<LaneKind, string> = { energy: 'Energy', genre: 'Genre', colour: 'Harmony' }
const NOTE: Record<LaneKind, string> = { energy: 'how hard it hits', genre: 'what style', colour: 'the colour of the keys' }
const EHINT: Record<string, string> = { Calm: 'quietest', Low: 'soft', Mid: 'middle', High: 'strong', Peak: 'loudest', Build: 'rises', Ease: 'falls' }
const CHINT: Record<string, string> = { Any: 'any key', bright: 'major', warm: 'Dorian', dark: 'minor', exotic: 'harmonic' }
const CCOL: Record<string, string> = { Any: 'oklch(62% .02 240)', bright: 'oklch(87% .11 95)', warm: 'oklch(77% .11 55)', dark: 'oklch(64% .11 275)', exotic: 'oklch(71% .12 320)' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const RECENT_KEY = 'sestudio.flowGenres'
const LW = 88

/** A genre's colour, stable per name (the genre list is open-ended). */
const genreCol = (v: string) => {
  if (v === ANY) return 'oklch(62% .02 240)'
  let h = 0
  for (const ch of v.split('|')[0]) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `oklch(74% .12 ${h})`
}
const colOf = (k: LaneKind, v: string) => (k === 'genre' ? genreCol(v) : CCOL[v] ?? CCOL.Any)
const labelOf = (k: LaneKind, v: string) => (k === 'genre' ? genreLabel(v) : k === 'colour' ? cap(v) : v)
const fmt = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`)

function EnergyMark({ v, w = 18, h = 12 }: { v: string; w?: number; h?: number }) {
  const [a, b] = ENERGY[v] ?? ENERGY.Mid
  const y = (e: number) => h - 1 - e * (h - 3)
  const d = `M0 ${y(a)} C${w / 2} ${y(a)} ${w / 2} ${y(b)} ${w} ${y(b)}`
  return (
    <svg className="shrink-0" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill="oklch(82% .11 75 / .35)" />
      <path d={d} fill="none" stroke="var(--fl-energy)" strokeWidth={1.5} />
    </svg>
  )
}
const Mark = ({ k, v }: { k: LaneKind; v: string }) =>
  k === 'energy' ? <EnergyMark v={v} /> : <span className="fl-dot" style={{ background: colOf(k, v) }} />

/** One continuous energy line over the lane, eased at each change. */
function Curve({ lanes, p, H }: { lanes: Lanes; p: number; H: number }) {
  const st = starts(lanes.energy), y = (e: number) => H - 10 - e * (H - 50)
  const pts: [number, number][] = []
  lanes.energy.forEach((b, i) => {
    const x0 = st[i] * p, x1 = (st[i] + b.len) * p, t = Math.min(14, (x1 - x0) / 4), [a, c] = ENERGY[b.v] ?? ENERGY.Mid
    pts.push([i ? x0 + t : x0, y(a)], [i < lanes.energy.length - 1 ? x1 - t : x1, y(c)])
  })
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [qx, qy] = pts[i], m = (qx - px) / 2
    d += ` C${px + m} ${py} ${qx - m} ${qy} ${qx} ${qy}`
  }
  const W = total(lanes) * p
  return (
    <svg className="fl-curve" width={W} height={H} aria-hidden="true">
      <defs><linearGradient id="fl-eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="oklch(82% .11 75)" stopOpacity=".28" /><stop offset="1" stopColor="oklch(82% .11 75)" stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${W} ${H} L0 ${H}Z`} fill="url(#fl-eg)" />
      <path d={d} fill="none" stroke="var(--fl-energy)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

interface Fits { stretches: { count: number; ids: string[] }[]; genres: Record<string, number> }
type Drag =
  | { kind: 'chip'; k: LaneKind; v: string; x0: number; y0: number; on: boolean }
  | { kind: 'move'; k: LaneKind; i: number; v: string; x0: number; y0: number; on: boolean }
  | { kind: 'edge'; k: LaneKind; i: number; x0: number; from: Lanes; p: number }

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

export default function FlowLanes({ flowId, byId, onOpen }: { flowId: string; byId: Map<string, MusicTrack>; onOpen: (id: string) => void }) {
  const { flows } = useFlows()
  const saved = flows.find(f => f.id === flowId)
  const [lanes, setLanes] = useState<Lanes | null>(null)
  const [lossy, setLossy] = useState(false)
  const [name, setName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState<{ k: LaneKind; i: number } | null>(null)
  const [tab, setTab] = useState<LaneKind>('energy')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] } })
  const [fits, setFits] = useState<Fits | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; k: LaneKind; v: string } | null>(null)
  const [over, setOver] = useState('')
  const [note, setNote] = useState('')
  const [frozenP, setFrozenP] = useState<number | null>(null)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const width = useWidth(box)
  const phone = width > 0 && width < 480

  // The saved flow is the start (set while rendering, once it arrives); edits stay local until Save.
  if (saved && !lanes) {
    const empty = saved.chunks.length === 1 && !Object.values(saved.chunks[0].layers).some(v => Array.isArray(v) && v.length)
    const read = empty ? { lanes: fresh(), lossy: false } : fromFlow(saved)
    setLanes(read.lanes); setLossy(read.lossy); setName(saved.name)
  }

  const T = lanes ? total(lanes) : 60
  const p = frozenP ?? (phone ? 5.5 : Math.max(3, (width - LW - 64) / T))
  const st: Stretch[] = useMemo(() => (lanes ? stretches(lanes) : []), [lanes])
  const avg = useMemo(() => {
    const d = [...byId.values()].map(t => t.duration).filter(Boolean)
    return d.length ? d.reduce((s, x) => s + x, 0) / d.length / 60 : 5
  }, [byId])
  const need = (m: number) => Math.max(1, Math.round(m / avg))

  // The library check: per stretch, the tracks that meet every lane (the server's generator rules).
  useEffect(() => {
    if (!lanes) return
    const t = window.setTimeout(() => {
      fetch('/api/music/flows/fits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: toFlow(lanes).chunks[0].layers, stretches: st.map(s => [s.s / T, s.e / T]) }),
      }).then(r => (r.ok ? r.json() : null)).then(r => r && setFits(r as Fits)).catch(() => {})
    }, 200)
    return () => window.clearTimeout(t)
  }, [lanes, st, T])

  const change = (n: Lanes) => { setLanes(n); setDirty(true) }
  const pushRecent = (k: LaneKind, v: string) => {
    if (k !== 'genre' || v === ANY) return
    const next = [v, ...recent.filter(x => x !== v)].slice(0, 4)
    setRecent(next)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  }
  const toast = (msg: string) => { setNote(msg); window.setTimeout(() => setNote(''), 1800) }

  // --- pointer: drag a brick from the palette, pull an edge, swap two bricks ---------------------
  const drag = useRef<Drag | null>(null)
  const quiet = useRef(false)
  const target = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]') ?? null
  const accepts = (d: Drag, el: HTMLElement | null) => {
    if (!el) return false
    const [kind, k] = el.dataset.drop!.split(':')
    return k === d.k && (d.kind === 'chip' || kind === 'l')
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (d.kind === 'edge') { setLanes(pullEdge(d.from, d.k, d.i, (e.clientX - d.x0) / d.p)); setDirty(true); return }
      if (!d.on && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 5) d.on = true
      if (!d.on) return
      setGhost({ x: e.clientX, y: e.clientY, k: d.k, v: d.v })
      const t = target(e.clientX, e.clientY)
      setOver(accepts(d, t) ? t!.dataset.drop! : '')
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      if (d.kind === 'edge') { setFrozenP(null); quiet.current = true; window.setTimeout(() => { quiet.current = false }); return }
      setGhost(null); setOver('')
      if (!d.on) return
      quiet.current = true; window.setTimeout(() => { quiet.current = false })
      const t = target(e.clientX, e.clientY), cur = lanes // the listeners are re-bound every render, so this is current
      if (!t || !cur) return
      const [kind, k, si] = t.dataset.drop!.split(':'), i = Number(si)
      if (k !== d.k) { toast(`${LABEL[d.k]} goes on the ${LABEL[d.k]} lane`); return }
      if (d.kind === 'chip') {
        pushRecent(d.k, d.v)
        change(kind === 'l' ? setValue(cur, d.k, i, d.v) : addBrick(cur, d.k, i, d.v))
        setSel({ k: d.k, i })
      } else if (kind === 'l' && i !== d.i) {
        change(swap(cur, d.k, d.i, i)); setSel({ k: d.k, i })
      }
    }
    const cancel = () => { drag.current = null; setGhost(null); setOver(''); setFrozenP(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
  })

  const onDown = (e: RPointerEvent) => {
    const el = e.target as HTMLElement
    const chip = el.closest<HTMLElement>('[data-chip]'), edge = el.closest<HTMLElement>('[data-edge]'), brick = el.closest<HTMLElement>('[data-brick]')
    if (chip) {
      const [k, ...v] = chip.dataset.chip!.split(':')
      drag.current = { kind: 'chip', k: k as LaneKind, v: v.join(':'), x0: e.clientX, y0: e.clientY, on: false }
    } else if (edge && lanes) {
      const [k, i] = edge.dataset.edge!.split(':')
      setFrozenP(p)
      drag.current = { kind: 'edge', k: k as LaneKind, i: Number(i), x0: e.clientX, from: lanes, p }
      e.preventDefault()
    } else if (brick && lanes && e.pointerType === 'mouse') {
      const [k, i] = brick.dataset.brick!.split(':')
      drag.current = { kind: 'move', k: k as LaneKind, i: Number(i), v: lanes[k as LaneKind][Number(i)].v, x0: e.clientX, y0: e.clientY, on: false }
    }
  }

  if (!lanes) return <p className="text-sm text-base-content/50">Loading the flow…</p>

  // --- actions ---------------------------------------------------------------------------------
  const apply = (k: LaneKind, v: string) => {
    if (quiet.current) return
    if (sel?.k !== k) { toast(`Select a ${LABEL[k].toLowerCase()} brick first, or drag this onto its lane`); return }
    pushRecent(k, v)
    change(setValue(lanes, k, sel.i, v))
  }
  const asNew = lossy || !!saved?.preset
  const save = async (): Promise<string> => {
    const body: Partial<Flow> = { ...toFlow(lanes), pull: saved?.pull ?? 'strong', allowOnline: saved?.allowOnline ?? false }
    const out = await saveFlow(name || 'Flow', body, asNew ? undefined : flowId)
    setDirty(false)
    await refreshFlows()
    if (asNew) onOpen(out.id)
    return out.id
  }
  const onKey = (e: RKeyboardEvent, k: LaneKind, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') change(pullEdge(lanes, k, i, e.key === 'ArrowRight' ? 5 : -5))
    else if (e.key === 's') change(split(lanes, k, i))
    else if (e.key === 'Delete' || e.key === 'Backspace') { change(remove(lanes, k, i)); setSel(null) }
    else if (e.key === 'Enter' || e.key === ' ') setSel({ k, i })
    else return
    e.preventDefault()
  }

  // --- the palette -----------------------------------------------------------------------------
  const libGenres = Object.entries(fits?.genres ?? {}).sort((a, b) => b[1] - a[1])
  const chip = (k: LaneKind, v: string, hint?: string | number) => (
    <button key={`${k}:${v}`} data-chip={`${k}:${v}`} onClick={() => apply(k, v)} className="fl-chip" title={labelOf(k, v)}>
      <Mark k={k} v={v} /><span className="truncate">{labelOf(k, v)}</span>{hint !== undefined && hint !== '' && <small>{hint}</small>}
    </button>
  )
  const genreDrawer = () => {
    const q = query.trim().toLowerCase()
    const all = [...libGenres].sort((a, b) => a[0].localeCompare(b[0]))
    const hits = q ? all.filter(([g]) => g.toLowerCase().includes(q)) : null
    return (
      <>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${all.length} genres`} aria-label="Search genres" className="fl-search" />
        <div className="fl-gscroll">
          {hits ? (hits.length ? hits.map(([g, n]) => chip('genre', g, n)) : <p className="fl-none">No genre matches</p>) : (
            <>
              {chip('genre', ANY, '')}
              {recent.length > 0 && <><h4>Recent</h4>{recent.map(g => chip('genre', g, fits?.genres[g] ?? ''))}</>}
              <h4>Most in your library</h4>
              {libGenres.slice(0, 8).map(([g, n]) => chip('genre', g, n))}
              {all.length > 8 && <button className="fl-more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide' : 'All'} {all.length} genres, A–Z</button>}
              {showAll && all.map(([g, n]) => chip('genre', g, n))}
            </>
          )}
        </div>
      </>
    )
  }

  // --- the board -------------------------------------------------------------------------------
  const step = T > 150 ? 30 : 15
  const ticks = Array.from({ length: Math.floor(T / step) + 1 }, (_, i) => i * step)
  const lane = (k: LaneKind) => {
    const s = starts(lanes[k])
    return (
      <div className={`fl-track fl-t-${k}`} style={{ width: T * p + 56 }}>
        {k === 'energy' && <Curve lanes={lanes} p={p} H={96} />}
        {lanes[k].map((b, i) => {
          const w = b.len * p, on = sel?.k === k && sel.i === i, drop = `l:${k}:${i}`
          return (
            <div key={i} data-brick={`${k}:${i}`} data-drop={drop} role="button" tabIndex={0}
              aria-label={`${LABEL[k]} ${labelOf(k, b.v)}, ${fmt(s[i])} to ${fmt(s[i] + b.len)}`} aria-pressed={on}
              onClick={() => { if (!quiet.current) setSel({ k, i }) }} onKeyDown={e => onKey(e, k, i)}
              className={`fl-brick${k === 'energy' ? ' fl-e' : ''}${on ? ' fl-sel' : ''}${over === drop ? ' fl-over' : ''}`}
              style={k === 'energy' ? { left: s[i] * p, width: w } : { left: s[i] * p + 2, width: w - 4, ['--c' as string]: colOf(k, b.v) }}>
              {k === 'energy'
                ? <><span className="fl-v">{w > 44 ? b.v : ''}</span>{w > 70 && <small>{EHINT[b.v]}</small>}</>
                : <>{w > 30 && <span className="fl-dot" style={{ background: colOf(k, b.v) }} />}<span className="fl-v">{w > 56 ? labelOf(k, b.v) : ''}</span></>}
              <div className="fl-edge" data-edge={`${k}:${i}`} aria-hidden="true" />
            </div>
          )
        })}
        {s.slice(1).map((x, j) => (
          <button key={`p${j}`} data-drop={`a:${k}:${j + 1}`} onClick={() => change(addBrick(lanes, k, j + 1))}
            className={`fl-plus${over === `a:${k}:${j + 1}` ? ' fl-over' : ''}`} style={{ left: x * p }} aria-label={`Add ${LABEL[k].toLowerCase()} at ${fmt(x)}`}>+</button>
        ))}
        <button data-drop={`a:${k}:${s.length}`} onClick={() => change(addBrick(lanes, k, s.length))}
          className={`fl-plus fl-end${over === `a:${k}:${s.length}` ? ' fl-over' : ''}`} style={{ left: T * p }} aria-label={`Add ${LABEL[k].toLowerCase()} at the end`}>+</button>
      </div>
    )
  }
  const short = st.filter((x, i) => fits && (fits.stretches[i]?.count ?? 0) < need(x.e - x.s)).length

  // --- the panel under the board: the selected brick, or the flow ---------------------------------
  const panel = () => {
    if (!sel || !lanes[sel.k][sel.i]) {
      return <div className="text-sm text-base-content/55">Each lane changes on its own time. {phone ? 'Tap' : 'Click'} a brick to edit it, pull an edge to move a change, drag the last edge to make the flow longer.{short > 0 && <span className="text-warning"> {short} stretch{short > 1 ? 'es are' : ' is'} short of tracks.</span>}</div>
    }
    const { k, i } = sel, b = lanes[k][i], s0 = starts(lanes[k])[i]
    const covered = st.map((x, j) => ({ x, j })).filter(({ x }) => x.e > s0 && x.s < s0 + b.len)
    const ids = [...new Set(covered.flatMap(({ j }) => fits?.stretches[j]?.ids ?? []))]
    const picks = k === 'energy' ? Object.keys(ENERGY) : k === 'colour' ? COLOURS : [...new Set([ANY, b.v, ...libGenres.slice(0, 5).map(([g]) => g)])]
    return (
      <>
        <h2 className="text-lg font-semibold tracking-tight">{LABEL[k]}: {labelOf(k, b.v)}</h2>
        <div className="mb-3 text-sm text-base-content/50">{s0 ? fmt(s0) : 'Start'} to {fmt(s0 + b.len)}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-[76px] text-xs text-base-content/50">{LABEL[k]}</span>
          {picks.map(v => (
            <button key={v} aria-pressed={b.v === v} onClick={() => { pushRecent(k, v); change(setValue(lanes, k, i, v)) }} className="fl-pick"><Mark k={k} v={v} />{labelOf(k, v)}</button>
          ))}
          {k === 'genre' && <span className="text-xs text-base-content/45">or any genre from the drawer</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="w-[76px] text-xs text-base-content/50">Length</span>
          <button className="fl-btn" aria-label="5 minutes shorter" onClick={() => change(pullEdge(lanes, k, i, -5))}>−</button>
          <span className="min-w-14 text-center tabular-nums">{fmt(b.len)}</span>
          <button className="fl-btn" aria-label="5 minutes longer" onClick={() => change(pullEdge(lanes, k, i, 5))}>+</button>
          <span className="flex-1" />
          <button className="fl-btn" disabled={b.len < 10} onClick={() => change(split(lanes, k, i))}>Split in two</button>
          <button className="fl-btn" disabled={lanes[k].length < 2} onClick={() => { change(remove(lanes, k, i)); setSel(null) }}>Remove</button>
        </div>
        <div className="mt-3.5 border-t border-white/7 pt-3.5">
          <ul className="mb-2.5 grid gap-1 text-sm text-base-content/70">
            {covered.map(({ x, j }) => {
              const n = fits?.stretches[j]?.count, want = need(x.e - x.s)
              return (
                <li key={j}><b className="mr-2 font-medium tabular-nums text-base-content">{x.s ? fmt(x.s) : 'Start'}–{fmt(x.e)}</b>
                  {x.energy} · {genreLabel(x.genre)} · {cap(x.colour)}
                  <em className={`ml-2.5 not-italic tabular-nums ${n !== undefined && n < want ? 'text-warning' : 'text-base-content/45'}`}>{n ?? '…'} fit, needs {want}</em></li>
              )
            })}
          </ul>
          {covered.some(({ x, j }) => (fits?.stretches[j]?.count ?? Infinity) < need(x.e - x.s)) && (
            <p className="mb-2 text-sm text-warning">Where it is short, tracks would repeat or a lane gives way. Widen the energy, or pick Any genre or Any harmony.</p>
          )}
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 text-sm">
            {ids.map(id => byId.get(id)).filter(Boolean).map(t => (
              <li key={t!.id} className="truncate py-0.5">{t!.title}{t!.bpm ? <span className="ml-1.5 text-xs tabular-nums text-base-content/45">{Math.round(t!.bpm)} bpm</span> : null}</li>
            ))}
          </ol>
        </div>
      </>
    )
  }

  return (
    <div className={`flow-lanes${ghost ? ' fl-dragging' : ''}`} onPointerDown={onDown}>
      <div className="fl-card mb-4 flex flex-wrap items-center gap-2 px-4 py-3">
        <input aria-label="Flow name" value={name} onChange={e => { setName(e.target.value); setDirty(true) }} className="input input-sm w-48 font-semibold" />
        <span className="text-sm tabular-nums text-base-content/50">{fmt(T)} · about {need(T)} tracks{short > 0 && <span className="text-warning"> · {short} short of tracks</span>}</span>
        <span className="flex-1" />
        {asNew && <span className="text-xs text-base-content/45" title="Tempo, harmony events and forks have no lane">{saved?.preset ? 'A preset: saving makes your own copy' : 'Saving keeps a straight copy of the first path'}</span>}
        <button onClick={() => run(save())} disabled={!dirty && !asNew} className="btn btn-sm">{asNew ? 'Save as new' : dirty ? 'Save' : 'Saved'}</button>
        <button onClick={() => run(save().then(id => playFlow(id)))} className="btn btn-primary btn-sm">Play</button>
      </div>

      <div className="fl-body">
        <aside className="fl-card fl-pal" aria-label="Bricks">
          <div className="fl-tabs" role="tablist">
            {KINDS.map(k => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{LABEL[k]}</button>)}
          </div>
          {tab === 'energy' && <div className="fl-chips">{Object.keys(ENERGY).map(v => chip('energy', v, EHINT[v]))}</div>}
          {tab === 'genre' && genreDrawer()}
          {tab === 'colour' && <div className="fl-chips">{COLOURS.map(v => chip('colour', v, CHINT[v]))}</div>}
        </aside>

        <main className="min-w-0">
          <div className="fl-card pb-2.5 pt-1.5">
            <p className="px-4 pb-1 pt-2.5 text-xs text-base-content/50">{phone ? 'Drag a brick from above onto its lane. Tap to edit.' : 'Drag a brick onto its lane, or onto a + to add one.'}</p>
            <div ref={setBox} className="overflow-x-auto px-4 pb-1">
              <div className="fl-grid">
                {ticks.slice(1).map(m => <div key={m} className="fl-gl" style={{ left: `calc(var(--fl-lw) + ${m * p}px)` }} />)}
                <div />
                <div className="fl-track fl-ruler" style={{ width: T * p + 56 }}>
                  {ticks.map(m => <span key={m} style={{ left: m * p }}>{m ? fmt(m) : 'start'}</span>)}
                </div>
                {KINDS.map(k => [
                  <div key={`n${k}`} className="fl-name">{LABEL[k]}<small>{NOTE[k]}</small></div>,
                  <div key={`t${k}`} className="contents">{lane(k)}</div>,
                ])}
                <div className="fl-name">Library<small>tracks that fit</small></div>
                <div className="fl-track fl-t-lib" style={{ width: T * p + 56 }}>
                  {st.map((x, j) => {
                    const n = fits?.stretches[j]?.count, want = need(x.e - x.s), w = (x.e - x.s) * p
                    return (
                      <div key={j} className={`fl-st${n !== undefined && n < want ? ' fl-thin' : ''}`} style={{ left: x.s * p, width: w }}
                        title={`${x.energy}, ${genreLabel(x.genre)}, ${cap(x.colour)}: ${n ?? '…'} of your tracks fit, ${fmt(x.e - x.s)} needs about ${want}`}>
                        {n === undefined ? '' : w > 40 ? `${n} fit` : n}
                        <div className="fl-bar"><i style={{ width: `${n === undefined ? 0 : Math.min(100, n / want * 100)}%` }} /></div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
          <section className="fl-card mt-4 px-4 py-4" aria-live="polite">{panel()}</section>
        </main>
      </div>

      {ghost && <div className="fl-ghost" style={{ left: ghost.x, top: ghost.y }}><Mark k={ghost.k} v={ghost.v} /><span>{labelOf(ghost.k, ghost.v)}</span></div>}
      {note && <div role="status" className="fl-toast">{note}</div>}
    </div>
  )
}
