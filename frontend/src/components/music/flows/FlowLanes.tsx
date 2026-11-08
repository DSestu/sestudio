import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { Setting } from '../../../blend'
import { playFlow, refreshFlows, saveFlow, useFlows, type Flow } from '../../../musicFlows'
import type { MusicTrack } from '../../../musicLibrary'
import { useSummaries } from '../../../musicMeta'
import type { SlotBlend } from '../../../musicQueue'
import { BlendRing } from '../BlendRing'
import {
  ANY, CCOL, COLOURS, KINDS, LEANS, addBrick, fresh, fromFlow, genreLabel, pullEdge, remove, setSetting, setValue, split, starts, stretches, swap, toFlow, total,
  type LaneKind, type Lanes, type SettingKind, type Stretch,
} from './lanes'

// The flow editor: three lanes of bricks (energy leans, genre, key colour) over the night, dragged in
// from a palette, resized by their edges, split and removed; each lane Must / Prefer / Ignore. The
// energy lane shows what a real render picks, the Blend row how each join sits, the Library row where
// tracks run short. Design: docs/proto/flows/lanes.html, .impeccable/mocks/blend/board.html §1.

const run = (p: Promise<unknown>) => { p.catch(() => {}) }
const LABEL: Record<LaneKind, string> = { energy: 'Energy', genre: 'Genre', colour: 'Harmony' }
const NOTE: Record<LaneKind, string> = { energy: 'which way it leans', genre: 'what style', colour: 'the colour of the keys' }
const EHINT: Record<string, string> = { Lift: 'steps up', Hold: 'stays close', Ease: 'steps down' }
const SETTINGS: Setting[] = ['must', 'prefer', 'ignore']
/** What Must does on each lane, said under its setting. */
const MUST_NOTE: Record<SettingKind, string> = { energy: 'Must only blocks big jumps', tempo: 'Must blocks more than 8 BPM', genre: 'Must plays only these', colour: 'Must keeps the colour' }
const SET_LABEL: Record<SettingKind, string> = { energy: 'Energy', tempo: 'Tempo', genre: 'Genre', colour: 'Harmony' }
const CHINT: Record<string, string> = { Any: 'any key', bright: 'major', warm: 'Dorian', dark: 'minor', exotic: 'harmonic' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const RECENT_KEY = 'sestudio.flowGenres'
const LW = 150 // --fl-lw: the name column, wide enough for Must / Prefer / Ignore

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

/** A lean's slope: up, level, down. */
function EnergyMark({ v, w = 20, h = 12 }: { v: string; w?: number; h?: number }) {
  const lean = LEANS[v] ?? 'hold'
  const [a, b] = lean === 'lift' ? [h - 1, 1] : lean === 'ease' ? [1, h - 1] : [h / 2, h / 2]
  return (
    <svg className="shrink-0" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`M1 ${a} L${w - 1} ${b}`} fill="none" stroke="var(--fl-energy)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

/** Must / Prefer / Ignore for one lane. */
function SettingSeg({ k, v, onChange }: { k: SettingKind; v: Setting; onChange: (v: Setting) => void }) {
  return (
    <span className="fl-set" role="group" aria-label={`${SET_LABEL[k]}: how strictly`}>
      {SETTINGS.map(x => <button key={x} aria-pressed={v === x} onClick={() => onChange(x)}>{x === 'must' ? 'Must' : x === 'prefer' ? 'Prefer' : 'Ignore'}</button>)}
    </span>
  )
}
const Mark = ({ k, v }: { k: LaneKind; v: string }) =>
  k === 'energy' ? <EnergyMark v={v} /> : <span className="fl-dot" style={{ background: colOf(k, v) }} />

/** One slot of the editor's draft render: when it starts, its track, how it blends with the one before. */
interface RSlot { at: number; track_id: string; blend?: SlotBlend }

/** Where a real render goes: each pick's energy as a dot, joined; the leans are only nudges, so this is the truth. */
function Result({ mix, energyOf, p, H, W }: { mix: RSlot[]; energyOf: (id: string) => number | undefined; p: number; H: number; W: number }) {
  const y = (e: number) => H - 10 - (e / 100) * (H - 34)
  const pts = mix.flatMap(m => { const e = energyOf(m.track_id); return e == null ? [] : [[(m.at / 60) * p + 4, y(e)] as const] })
  if (!pts.length) return null
  const d = pts.map(([x, v], i) => `${i ? 'L' : 'M'}${x} ${v}`).join(' ')
  return (
    <svg className="fl-curve" width={W} height={H} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--fl-energy)" strokeWidth={1.6} strokeLinejoin="round" />
      {pts.map(([x, v], i) => <circle key={i} cx={x} cy={v} r={2.8} fill="var(--fl-energy)" />)}
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
  const [draft, setDraft] = useState<RSlot[] | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; k: LaneKind; v: string } | null>(null)
  const [over, setOver] = useState('')
  const [note, setNote] = useState('')
  const [frozenP, setFrozenP] = useState<number | null>(null)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const width = useWidth(box)
  const phone = width > 0 && width < 480

  const { get: summary } = useSummaries(useMemo(() => (draft ?? []).map(m => m.track_id), [draft]))
  const energyOf = (id: string) => summary(id)?.energyScale?.track

  // The saved flow is the start (set while rendering, once it arrives); edits stay local until Save.
  if (saved && !lanes) {
    const empty = saved.chunks.length === 1 && !Object.values(saved.chunks[0].layers).some(v => Array.isArray(v) && v.length)
    const read = empty ? { lanes: fresh(), lossy: false } : fromFlow(saved)
    setLanes(read.lanes); setLossy(read.lossy); setName(saved.name)
  }

  const T = lanes ? total(lanes) : 60
  // Phones fit the whole flow in a card's width; desktop leaves room for the lane names.
  // A phone card holds the track (T·p), its end + (56) and the card padding (24), with a little air.
  const p = frozenP ?? (phone ? Math.max(2, (width - 92) / T) : Math.max(3, (width - LW - 64) / T))
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

  // What the flow would really play: the energy lane's dots and the Blend row read it.
  useEffect(() => {
    if (!lanes) return
    const t = window.setTimeout(() => {
      fetch('/api/music/flows/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow: { ...toFlow(lanes), pull: saved?.pull ?? 'strong' }, minutes: T, seed: 1 }),
      }).then(r => (r.ok ? r.json() : null)).then(r => r && setDraft((r as { mix: RSlot[] }).mix)).catch(() => {})
    }, 400)
    return () => window.clearTimeout(t)
  }, [lanes, T, saved?.pull])

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
        {k === 'energy' && draft && <Result mix={draft} energyOf={energyOf} p={p} H={96} W={T * p + 56} />}
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
  // Every row of the board: its name, its setting, its track (desktop grid or phone cards).
  const seg = (k: SettingKind) => <SettingSeg k={k} v={lanes.settings[k]} onChange={v => change(setSetting(lanes, k, v))} />
  const hint = (k: SettingKind, fallback: string) => (lanes.settings[k] === 'must' ? MUST_NOTE[k] : lanes.settings[k] === 'ignore' ? 'not counted' : fallback)
  const W = T * p + 56
  const rows: { key: string; name: string; note: string; set?: ReactNode; track: ReactNode }[] = [
    { key: 'energy', name: LABEL.energy, note: hint('energy', NOTE.energy), set: seg('energy'), track: lane('energy') },
    {
      key: 'tempo', name: 'Tempo', note: hint('tempo', 'leans with energy'), set: seg('tempo'),
      track: (
        <div className="fl-track fl-t-genre" style={{ width: W }}>
          <div className={`fl-brick fl-flat${lanes.settings.tempo === 'ignore' ? ' opacity-45' : ''}`} style={{ left: 2, width: T * p - 4, ['--c' as string]: 'oklch(70% .04 240)' }}>
            <span className="fl-v">Close to the track before</span>{T * p > 360 && <small className="font-normal opacity-60">steps of a few BPM</small>}
          </div>
        </div>
      ),
    },
    { key: 'genre', name: LABEL.genre, note: hint('genre', NOTE.genre), set: seg('genre'), track: lane('genre') },
    { key: 'colour', name: LABEL.colour, note: hint('colour', NOTE.colour), set: seg('colour'), track: lane('colour') },
    {
      key: 'blend', name: 'Blend', note: 'how each join sits',
      track: (
        <div className="fl-track fl-t-blend" style={{ width: W }}>
          {(draft ?? []).slice(1).map((m, j) => m.blend && (
            <span key={j} className="fl-ring" style={{ left: (m.at / 60) * p }}><BlendRing score={m.blend.score} size={phone ? 14 : 16} /></span>
          ))}
        </div>
      ),
    },
    {
      key: 'lib', name: 'Library', note: 'tracks that fit',
      track: (
        <div className="fl-track fl-t-lib" style={{ width: W }}>
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
      ),
    },
  ]
  const short = st.filter((x, i) => fits && (fits.stretches[i]?.count ?? 0) < need(x.e - x.s)).length

  // --- the panel under the board: the selected brick, or the flow ---------------------------------
  const panel = () => {
    if (!sel || !lanes[sel.k][sel.i]) {
      return <div className="text-sm text-base-content/55">Each lane changes on its own time. {phone ? 'Tap' : 'Click'} a brick to edit it, pull an edge to move a change, drag the last edge to make the flow longer.{short > 0 && <span className="text-warning"> {short} stretch{short > 1 ? 'es are' : ' is'} short of tracks.</span>}</div>
    }
    const { k, i } = sel, b = lanes[k][i], s0 = starts(lanes[k])[i]
    const covered = st.map((x, j) => ({ x, j })).filter(({ x }) => x.e > s0 && x.s < s0 + b.len)
    const ids = [...new Set(covered.flatMap(({ j }) => fits?.stretches[j]?.ids ?? []))]
    const picks = k === 'energy' ? Object.keys(LEANS) : k === 'colour' ? COLOURS : [...new Set([ANY, b.v, ...libGenres.slice(0, 5).map(([g]) => g)])]
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
            <p className="mb-2 text-sm text-warning">Where it is short, a track a Must would keep out plays anyway. Set Genre or Harmony to Prefer, or pick Any.</p>
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
          {tab === 'energy' && <>
            <div className="fl-chips">{Object.keys(LEANS).map(v => chip('energy', v, EHINT[v]))}</div>
            <p className="fl-palnote">A lean nudges each pick a little up, level or down from the track before. There is no level to hit.</p>
          </>}
          {tab === 'genre' && genreDrawer()}
          {tab === 'colour' && <div className="fl-chips">{COLOURS.map(v => chip('colour', v, CHINT[v]))}</div>}
        </aside>

        <main className="min-w-0">
          <div className={phone ? '' : 'fl-card pb-2.5 pt-1.5'}>
            <p className={`text-xs text-base-content/50 ${phone ? 'pb-2' : 'px-4 pb-1 pt-2.5'}`}>{phone ? 'Drag a brick from above onto its lane. Tap to edit.' : 'Drag a brick onto its lane, or onto a + to add one.'}</p>
            <div ref={setBox} className={phone ? 'grid gap-2' : 'overflow-x-auto px-4 pb-1'}>
              {phone ? rows.map(r => (
                <div key={r.key} className="fl-card fl-pcard">
                  <div className="fl-phead"><span className="fl-pname">{r.name}<small>{r.note}</small></span>{r.set}</div>
                  {r.track}
                </div>
              )) : (
                <div className="fl-grid">
                  {ticks.slice(1).map(m => <div key={m} className="fl-gl" style={{ left: `calc(var(--fl-lw) + ${m * p}px)` }} />)}
                  <div />
                  <div className="fl-track fl-ruler" style={{ width: T * p + 56 }}>
                    {ticks.map(m => <span key={m} style={{ left: m * p }}>{m ? fmt(m) : 'start'}</span>)}
                  </div>
                  {rows.map(r => [
                    <div key={`n${r.key}`} className="fl-name">{r.name}{r.set}<small>{r.note}</small></div>,
                    <div key={`t${r.key}`} className="contents">{r.track}</div>,
                  ])}
                </div>
              )}
            </div>
          </div>
          {phone && sel ? (
            <section className="fl-sheet" aria-live="polite">
              <button className="fl-btn fl-sheet-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
              {panel()}
            </section>
          ) : (
            <section className="fl-card mt-4 px-4 py-4" aria-live="polite">{panel()}</section>
          )}
        </main>
      </div>

      {ghost && <div className="fl-ghost" style={{ left: ghost.x, top: ghost.y }}><Mark k={ghost.k} v={ghost.v} /><span>{labelOf(ghost.k, ghost.v)}</span></div>}
      {note && <div role="status" className="fl-toast">{note}</div>}
    </div>
  )
}
