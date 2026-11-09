import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import type { Facts } from './facts'
import { silhouette, trackColor, type Colour } from './sigil'
import { fitTape, HEAD_H, LABEL_H, MARK_COLOR, TAPE_H, TRACK_H, type TapeGroup } from './tapeLayout'

// The tape (SPEC-music-library §2.4): every track in view as a sigil, width by length, grouped
// like the explorer, with a header per group; a minimap above; wheel scrolls sideways.

import type { Join } from './blendOrder'
import { carryProps } from './carry'
import { clearSelection, clickSelect, getSelection, selectIds } from './selection'
import type { Laid } from './tapeLayout'


export default function Tape({ groups, facts, colour, joins, selectedId, playingId, onSelect, onPlay, hoverProps, picked }: {
  groups: TapeGroup[]
  facts: Facts
  colour: Colour
  /** Best blend: the join after each track of the one group, in order. */
  joins?: Join[]
  selectedId?: string
  playingId?: string
  onSelect: (t: MusicTrack) => void
  onPlay: (t: MusicTrack) => void
  hoverProps?: (t: MusicTrack) => object
  /** The tracks selected on the tape. */
  picked: ReadonlySet<string>
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [scroll, setScroll] = useState({ left: 0, inner: 1 })
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const layout = useMemo(() => fitTape(groups, width || 1200, !!joins), [groups, width, joins])
  const innerW = Math.max(width, layout.end + 40)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.scrollBy({ left: e.deltaY * 1.4 }) }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const onScroll = () => { const el = scroller.current; if (el) setScroll({ left: el.scrollLeft, inner: el.scrollWidth || 1 }) }
  useEffect(onScroll, [innerW])
  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scroller.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    el.scrollLeft = ((e.clientX - r.left) / r.width) * el.scrollWidth - el.clientWidth / 2
  }
  const ids = useMemo(() => layout.items.map(l => l.t.id), [layout])
  const pickedTracks = useMemo(() => layout.items.filter(l => picked.has(l.t.id)).map(l => l.t), [layout, picked])
  const box = useBoxSelect(scroller, inner, layout.items, ids)
  // One tab stop on the tape: the selected track, else the first; arrows move along it (§6 keyboard).
  const stop = Math.max(0, layout.items.findIndex(l => l.t.id === selectedId))
  const trackKey = (e: React.KeyboardEvent, i: number) => {
    const t = layout.items[i].t
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const els = inner.current?.querySelectorAll<HTMLElement>('[data-tape-track]')
      const next = els?.[Math.min((els?.length ?? 1) - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))]
      next?.focus()
      next?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      clickSelect('tape', t.id, ids, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey })
      onSelect(t)
    }
  }
  const MW = 1000
  const winX = (scroll.left / scroll.inner) * 100
  const winW = Math.min(100, (width / scroll.inner) * 100)
  return (
    <div className="flex flex-col gap-1.5">
      {/* Minimap: every track in view, height = energy; the window is the visible part. */}
      <div onClick={jump} className="relative mx-1 h-6.5 cursor-pointer overflow-hidden rounded-md bg-white/4" aria-hidden="true">
        <svg viewBox={`0 0 ${MW} 26`} preserveAspectRatio="none" className="block size-full">
          {layout.items.map(l => {
            const f = facts(l.t.id)
            const e = f.energy ?? 5
            return <rect key={l.t.id} x={(l.x / innerW) * MW} y={26 - (e / 100) * 22} width={Math.max(0.8, (l.w / innerW) * MW - 0.3)} height={(e / 100) * 22} fill={trackColor(f, colour)} fillOpacity=".8" />
          })}
        </svg>
        <span className="absolute inset-y-0 rounded-md bg-white/15 outline-1 outline-white/40" style={{ left: `${winX}%`, width: `${winW}%` }} />
      </div>
      <div ref={scroller} onScroll={onScroll} onPointerEnter={box.enter} onPointerLeave={box.leave} className="relative overflow-x-auto overflow-y-hidden no-scrollbar" style={{ height: TAPE_H }}>
        <div ref={inner} onPointerDown={e => box.down(e, picked)} className="relative select-none" style={{ width: innerW, height: TAPE_H }}>
          {box.rect && <span className="pointer-events-none absolute z-10 rounded border border-primary/60 bg-primary/10" style={box.rect} />}
          {!layout.items.length && <p className="absolute inset-x-0 top-20 text-center text-sm text-base-content/50">Nothing here.</p>}
          {layout.heads.map((h, i) => {
            const showHead = h.head !== layout.heads[i - 1]?.head
            return (
              <div key={h.key} {...carryProps(h.tracks, h.name || h.head)} className="absolute cursor-grab" style={{ left: h.x, top: 12, maxWidth: h.maxW }} title="Drag the group into your set">
                <span className="absolute -left-3 top-9 h-32 w-px bg-white/15" />
                <span className="block h-7 truncate text-[22px] font-light leading-7 text-base-content/40">{showHead ? h.head : ''}</span>
                <b className="block truncate text-[13px] font-semibold">{h.name}</b>
                <small className="block truncate text-[11px] text-base-content/50">{headLine(h.tracks, facts)}</small>
              </div>
            )
          })}
          {layout.items.map((l, i) => {
            const f = facts(l.t.id)
            const c = trackColor(f, colour)
            const sel = l.t.id === selectedId
            const on = picked.has(l.t.id)
            const j = joins?.[i]
            return (
              <div key={l.t.id} className="contents">
                <div
                  data-tape-track={l.t.id}
                  {...(on ? carryProps(pickedTracks, pickedTracks.length > 1 ? `${pickedTracks.length} tracks` : l.t.title) : {})}
                  {...hoverProps?.(l.t)}
                  onClick={e => { if (box.consumeClick()) return; clickSelect('tape', l.t.id, ids, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey }); onSelect(l.t) }}
                  onDoubleClick={() => onPlay(l.t)}
                  role="button"
                  aria-label={l.t.title}
                  aria-pressed={on}
                  tabIndex={i === stop ? 0 : -1}
                  onKeyDown={e => trackKey(e, i)}
                  title={l.t.title}
                  className={`absolute cursor-pointer rounded-lg hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-primary ${on ? 'bg-primary/12 ring-1 ring-primary/60' : ''} ${sel ? 'outline-1.5 outline-offset-2 outline-base-content' : ''}`}
                  style={{ left: l.x, top: HEAD_H + 12, width: l.w, height: TRACK_H + LABEL_H + 6 }}
                >
                  {l.t.id === playingId && <span className="absolute -top-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary" />}
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-0.5 top-0 w-[calc(100%-4px)]" style={{ height: TRACK_H }} aria-hidden="true">
                    <path d={silhouette(f.curve, 0, 100, 96, 50)} fill={c} fillOpacity=".85" />
                  </svg>
                  <span className={`absolute inset-x-0.5 truncate text-[11px] ${sel ? 'text-base-content' : 'text-base-content/55'}`} style={{ top: TRACK_H + 4 }}>{l.t.title}</span>
                </div>
                {j && i < layout.items.length - 1 && (
                  <i className="absolute size-2.5 rotate-45 rounded-[1px] border border-base-100" style={{ left: l.x + l.w + 3, top: HEAD_H + 12 + TRACK_H / 2, transform: 'translate(-50%,-50%) rotate(45deg)', background: MARK_COLOR[j.mark] }} title={`${Math.round(j.blend * 100)} blend`} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** `n · length · bpm range` under a group's name. */
function headLine(ts: MusicTrack[], facts: Facts): string {
  const secs = ts.reduce((s, t) => s + t.duration, 0)
  const m = Math.round(secs / 60)
  const dur = m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
  const b = ts.map(t => facts(t.id).bpm).filter((x): x is number => !!x)
  const bpm = b.length ? (Math.min(...b) === Math.max(...b) ? `${Math.round(b[0])} bpm` : `${Math.round(Math.min(...b))}–${Math.round(Math.max(...b))} bpm`) : ''
  return [String(ts.length), dur, bpm].filter(Boolean).join(' · ')
}

const EDGE = 40
const DRAG_PX = 4

/**
 * Box select (§2.4): press and drag from empty space or an unselected track draws a box and
 * selects what it covers (Ctrl/⌘ adds); the tape scrolls when the box reaches an edge.
 * Ctrl/⌘-A selects what is in view while the pointer is over the tape; Esc clears.
 */
function useBoxSelect(scroller: React.RefObject<HTMLDivElement | null>, inner: React.RefObject<HTMLDivElement | null>, items: Laid[], ids: string[]) {
  const [rect, setRect] = useState<React.CSSProperties | null>(null)
  const over = useRef(false)
  const boxed = useRef(false)
  const latest = useRef({ items, ids })
  useEffect(() => { latest.current = { items, ids } }, [items, ids])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]')
      if (typing) return
      if (e.key === 'Escape') clearSelection()
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && over.current) {
        e.preventDefault()
        selectIds('tape', latest.current.ids)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const down = (e: React.PointerEvent, picked: ReadonlySet<string>) => {
    if (e.button !== 0 || e.pointerType === 'touch') return
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-tape-track]')
    if (hit && picked.has(hit.dataset.tapeTrack!)) return // a selected track drags the selection
    if ((e.target as HTMLElement).closest('[draggable="true"]') && !hit) return // a group header drags its group
    const el = scroller.current, box = inner.current
    if (!el || !box) return
    const add = e.ctrlKey || e.metaKey
    const base = add ? [...(getSelection().scope === 'tape' ? getSelection().ids : [])] : []
    const at = (cx: number, cy: number) => { const r = box.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top } }
    const start = at(e.clientX, e.clientY)
    let last = { cx: e.clientX, cy: e.clientY }
    let active = false
    let raf = 0
    const update = () => {
      const p = at(last.cx, last.cy)
      const x0 = Math.min(start.x, p.x), x1 = Math.max(start.x, p.x), y0 = Math.min(start.y, p.y), y1 = Math.max(start.y, p.y)
      setRect({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      const top = HEAD_H + 12, bottom = top + TRACK_H + LABEL_H
      const inside = y1 >= top && y0 <= bottom ? latest.current.items.filter(l => l.x + l.w >= x0 && l.x <= x1).map(l => l.t.id) : []
      selectIds('tape', [...base, ...inside])
    }
    const edgeScroll = () => {
      const r = el.getBoundingClientRect()
      const step = last.cx < r.left + EDGE ? -14 : last.cx > r.right - EDGE ? 14 : 0
      if (step) { el.scrollLeft += step; update() }
      raf = requestAnimationFrame(edgeScroll)
    }
    const move = (ev: PointerEvent) => {
      last = { cx: ev.clientX, cy: ev.clientY }
      if (!active && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_PX) return
      if (!active) { active = true; raf = requestAnimationFrame(edgeScroll) }
      update()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cancelAnimationFrame(raf)
      setRect(null)
      boxed.current = active
      if (!active && !hit) clearSelection()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return {
    rect,
    down,
    enter: () => { over.current = true },
    leave: () => { over.current = false },
    /** A box ends with a click on what it started on: swallow that one. */
    consumeClick: () => { const b = boxed.current; boxed.current = false; return b },
  }
}
