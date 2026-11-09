import { createPortal } from 'react-dom'
import { itemsOf, usePlaylists } from '../../../musicPlaylists'
import { fmtTime } from '../format'
import { useFullAnalysis } from './analysisFull'
import type { Facts } from './facts'
import { trackColor, type Colour } from './sigil'
import { Sections } from './TrackInfo'
import type { Hover } from './hoverCard'

// The hover card (SPEC-music-library §2.4): what a track shows when the mouse rests on it.

export default function HoverCard({ hover, facts, colour, place }: { hover: Hover; facts: Facts; colour: Colour; place?: string }) {
  const { t, rect } = hover
  const f = facts(t.id)
  const c = trackColor(f, colour)
  const a = useFullAnalysis(t.id)
  const lists = usePlaylists().filter(n => itemsOf(n).some(i => i.track_id === t.id)).map(n => n.name)
  const w = 320
  const x = Math.min(window.innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2))
  const above = rect.top > 300
  const style: React.CSSProperties = { left: x, width: w, ...(above ? { bottom: window.innerHeight - rect.top + 10 } : { top: rect.bottom + 10 }) }
  const chip = (v: React.ReactNode) => <span className="rounded-md bg-white/8 px-1.5 py-0.5">{v}</span>
  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-50 flex flex-col gap-2 rounded-2xl glass p-3 text-sm" style={style}>
      <div>
        <h4 className="font-semibold leading-tight">{t.title}</h4>
        <p className="truncate text-xs text-base-content/60">{[t.artist, t.album || t.albumName, t.libraryLabel].filter(Boolean).join(' · ')}</p>
      </div>
      <Sections curve={f.curve} sections={a?.structure} colour={c} />
      <div className="flex flex-wrap gap-1 text-[11px]">
        {chip(<><i className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: f.mood?.color ?? c }} />{f.mood?.word ?? 'Unread'}{f.mode && <small className="ml-1 text-base-content/55">{f.mode}</small>}</>)}
        {f.key && chip(<>{f.key}{f.camelot && <small className="ml-1 text-base-content/55">{f.camelot}</small>}</>)}
        {chip(<span className="tabular-nums">{f.bpm ? Math.round(f.bpm) : '?'} BPM</span>)}
        {chip(<>{f.level ?? 'Energy'} <small className="tabular-nums text-base-content/55">{f.energy ?? '?'}</small></>)}
        {f.genre && chip(f.genre)}
        {chip(<span className="tabular-nums">{fmtTime(t.duration)}</span>)}
      </div>
      {place && <p className="text-[11px] text-base-content/60">{place}</p>}
      {lists.length > 0 && <p className="text-[11px] text-base-content/60">In {lists.join(', ')}</p>}
      <p className="text-[11px] text-base-content/40">Click to select · double-click to play · drag into your set</p>
    </div>,
    document.body,
  )
}
