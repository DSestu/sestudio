import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { dragProps } from '../edit/focus'
import type { Facts } from './facts'
import { silhouette, trackColor, type Colour } from './sigil'
import { fitTape, HEAD_H, LABEL_H, MARK_COLOR, TAPE_H, TRACK_H, type TapeGroup } from './tapeLayout'

// The tape (SPEC-music-library §2.4): every track in view as a sigil, width by length, grouped
// like the explorer, with a header per group; a minimap above; wheel scrolls sideways.

export interface Join {
  mark: 'smooth' | 'close' | 'rough'
  blend: number
}


export default function Tape({ groups, facts, colour, joins, selectedId, playingId, onSelect, onPlay, hoverProps }: {
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
}) {
  const scroller = useRef<HTMLDivElement>(null)
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
      <div ref={scroller} onScroll={onScroll} className="relative overflow-x-auto overflow-y-hidden no-scrollbar" style={{ height: TAPE_H }}>
        <div className="relative" style={{ width: innerW, height: TAPE_H }}>
          {!layout.items.length && <p className="absolute inset-x-0 top-20 text-center text-sm text-base-content/50">Nothing here.</p>}
          {layout.heads.map((h, i) => {
            const showHead = h.head !== layout.heads[i - 1]?.head
            return (
              <div key={h.key} className="absolute" style={{ left: h.x, top: 12, maxWidth: h.maxW }}>
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
            const j = joins?.[i]
            return (
              <div key={l.t.id} className="contents">
                <div
                  {...dragProps(l.t)}
                  {...hoverProps?.(l.t)}
                  onClick={() => onSelect(l.t)}
                  onDoubleClick={() => onPlay(l.t)}
                  title={l.t.title}
                  className={`absolute cursor-pointer rounded-lg hover:bg-white/8 ${sel ? 'outline-1.5 outline-offset-2 outline-base-content' : ''}`}
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
