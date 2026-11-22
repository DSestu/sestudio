import { useEffect, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { blendBody } from '../../../musicBlendWeights'
import { fmtTime } from '../format'
import { toast } from '../toast'
import { leanOf, type Join } from './blendOrder'
import type { Facts } from './facts'
import { Ic } from './icons'
import { joinKey, keepJoin, unkeepJoin } from './playlistEdit'
import { silhouette, trackColor, type Colour } from './sigil'
import { MARK_COLOR } from './tapeLayout'

// The pieces of the open playlist's lists (SPEC-blend-playlists §3.1): the energy line, a row,
// the join line between rows, and the Fix panel under a problem join (bridges, a better spot,
// or keep it). `PlaylistBoard` and `PlaylistPhone` put them together.

const PROBLEM_TITLE: Record<string, string> = { clash: 'Clash', tempo: 'Tempo jump', energy: 'Energy jump' }

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(`/api/music/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `${path}: ${r.status}`)
  return r.json()
}
const fail = (e: Error) => toast(e.message)

function Diamond({ j }: { j?: Join }) {
  return <i className="inline-block size-2 shrink-0 rotate-45 rounded-[1px]" style={{ background: j ? MARK_COLOR[j.mark] : 'oklch(55% .02 240)' }} />
}

/** Score, kind, tempo, Lift / Hold / Ease, genre change. */
export function JoinChips({ j, problems }: { j?: Join; problems: string[] }) {
  if (!j) return <span className="text-[11px] text-base-content/40">not read yet</span>
  const chip = (text: string, warn = false) => <span className={`rounded-md px-1.5 text-[11px] leading-5 ${warn ? 'bg-warning/15 text-warning' : 'bg-white/6 text-base-content/65'}`}>{text}</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Diamond j={j} /><b className="text-[11px] font-medium tabular-nums">{Math.round(j.blend * 100)}</b>
      {j.kindLabel && chip(j.kindLabel, problems.includes('clash'))}
      {j.bpmDelta != null && chip(`${j.bpmDelta > 0 ? '+' : ''}${j.bpmDelta} bpm`, problems.includes('tempo'))}
      {chip(leanOf(j), problems.includes('energy'))}
      {j.genreChange && chip('genre change')}
    </span>
  )
}

export function JoinLine({ j, problems, kept, onFix, onUnkeep }: { j?: Join; problems: string[]; kept: boolean; onFix: () => void; onUnkeep: () => void }) {
  return (
    <div className={`ml-14 flex items-center gap-2 py-0.5 ${problems.length ? 'rounded-md bg-warning/6 px-1.5' : ''}`}>
      <JoinChips j={j} problems={problems} />
      {kept && <span className="text-[11px] text-base-content/45">Kept · <button onClick={onUnkeep} className="underline">undo</button></span>}
      {problems.length > 0 && <button onClick={onFix} className="btn btn-xs h-5 min-h-0 rounded-md">Fix</button>}
    </div>
  )
}

function Tools({ t, pinned, onPin, onRemove }: { t: MusicTrack; pinned: boolean; /** Absent: nothing to pin (a hand-ordered playlist). */ onPin?: () => void; onRemove: () => void }) {
  return (
    <span className="inline-flex gap-0.5">
      {onPin && <button onClick={e => { e.stopPropagation(); onPin() }} aria-label={pinned ? `Unpin ${t.title}` : `Pin ${t.title}`} className={`grid size-6 place-items-center rounded-md hover:bg-white/10 ${pinned ? 'text-primary' : 'text-base-content/40'}`}><Ic name="pin" size={12} /></button>}
      <button onClick={e => { e.stopPropagation(); onRemove() }} aria-label={`Remove ${t.title}`} className="grid size-6 place-items-center rounded-md text-base-content/50 hover:bg-white/10"><Ic name="close" size={12} width={2.2} /></button>
    </span>
  )
}

export function Row({ t, i, facts, colour, pinned, picked, focused, moved = false, state, drag, hover, onClick, onPin, onRemove }: {
  t: MusicTrack; i: number; facts: Facts; colour: Colour; pinned: boolean; picked: boolean; focused: boolean
  /** A re-order just moved this row: a dot for a few seconds. */
  moved?: boolean
  /** While the playlist plays: a row already played is dimmed, the playing one tinted. */
  state?: 'played' | 'playing'
  drag: object; hover?: object; onClick: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void; onPin?: () => void; onRemove: () => void
}) {
  const f = facts(t.id)
  const c = trackColor(f, colour)
  return (
    <div data-set-item {...drag} {...hover} onClick={onClick} tabIndex={0} aria-label={t.title}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(e) } }}
      className={`flex h-11 cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-white/5 ${picked || state === 'playing' ? 'bg-primary/12' : ''} ${state === 'played' ? 'opacity-45' : ''} ${focused ? 'outline-1 outline-base-content/60' : ''}`}>
      <span className="cursor-grab text-base-content/30" aria-hidden="true">⋮⋮</span>
      <span className="relative w-5 text-right text-[11px] tabular-nums text-base-content/45">{moved && <i className="absolute -left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" title="Moved" />}{i + 1}</span>
      <svg width="36" height="24" viewBox="0 0 36 24" className="shrink-0" aria-hidden="true"><path d={silhouette(f.curve, 2, 32, 20, 12)} fill={c} /></svg>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px]">{t.title}</span>
        <span className="block truncate text-[11px] text-base-content/50">{[f.mood?.word, f.key && `${f.key}${f.camelot ? ` ${f.camelot}` : ''}`, f.bpm && Math.round(f.bpm), t.artist].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/8" title={`Energy ${f.energy ?? '?'}`}><span className="block h-full rounded-full" style={{ width: `${f.energy ?? 0}%`, background: c }} /></span>
      <span className="w-10 text-right text-[11px] tabular-nums text-base-content/50">{fmtTime(t.duration)}</span>
      <Tools t={t} pinned={pinned} onPin={onPin} onRemove={onRemove} />
    </div>
  )
}

interface Bridge { id: string; before: Join; after: Join; left: number }

/** Under a problem join: three bridges, a better spot for B, or keep it. `onInsert` and `onSpot` apply a fix to whatever holds the list. */
export function FixPanel({ a, b, shown, problems, facts, colour, byId, kept, onClose, onInsert, onSpot, className = 'my-1 ml-14' }: {
  a: MusicTrack; b: MusicTrack; shown: MusicTrack[]; problems: string[]; facts: Facts; colour: Colour
  byId: ReadonlyMap<string, MusicTrack>; kept: string[]; onClose: () => void
  onInsert: (t: MusicTrack) => void
  /** The server's order of the track ids with B at its better spot. */
  onSpot: (order: string[]) => void
  className?: string
}) {
  const [bridges, setBridges] = useState<Bridge[] | null>(null)
  useEffect(() => {
    let live = true
    post<{ results: Bridge[] }>('proximity/bridges', { a: a.id, b: b.id, exclude: shown.map(t => t.id), limit: 3, strict: false, ...blendBody() })
      .then(r => { if (live) setBridges(r.results.filter(x => byId.has(x.id)).slice(0, 3)) }, e => { if (live) { setBridges([]); fail(e) } })
    return () => { live = false }
  }, [a.id, b.id]) // eslint-disable-line react-hooks/exhaustive-deps -- asked once per join
  const insert = (t: MusicTrack) => { onInsert(t); onClose() }
  const move = () => {
    post<{ order: string[]; left: number }>('set/spot', { ids: shown.map(t => t.id), id: b.id, kept, ...blendBody() })
      .then(r => {
        onSpot(r.order)
        toast(`${b.title} moved to #${r.order.indexOf(b.id) + 1} · ${r.left} ${r.left === 1 ? 'problem' : 'problems'} left`)
        onClose()
      }, fail)
  }
  const keep = () => {
    const k = joinKey(a, b)
    keepJoin(k)
    toast('Kept', () => unkeepJoin(k))
    onClose()
  }
  return (
    <div className={`${className} flex flex-col gap-1.5 rounded-xl bg-base-200 p-2.5 text-xs`}>
      <p className="font-medium">{problems.map(p => PROBLEM_TITLE[p]).join(' and ')} between {a.title} and {b.title}</p>
      <p className="text-[11px] text-base-content/50">Put one of these between</p>
      {!bridges ? <p className="text-base-content/45">Looking…</p> : !bridges.length ? <p className="text-base-content/45">No track of your libraries fits between them.</p> : bridges.map(x => {
        const t = byId.get(x.id)!
        const f = facts(t.id)
        return (
          <div key={x.id} className="flex items-center gap-2">
            <svg width="36" height="24" viewBox="0 0 36 24" className="shrink-0" aria-hidden="true"><path d={silhouette(f.curve, 2, 32, 20, 12)} fill={trackColor(f, colour)} /></svg>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate">{t.title}</span>
              <span className="block truncate text-[11px] text-base-content/50">{[f.mood?.word, f.bpm && Math.round(f.bpm), x.before.shared != null && x.after.shared != null && `shares ${x.before.shared} and ${x.after.shared} notes`].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={x.left ? 'text-base-content/55' : 'text-success'}>{x.left ? `softer · ${x.left} left` : 'fixes it'}</span>
            <button onClick={() => insert(t)} className="btn btn-xs rounded-lg">Insert</button>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={move} className="btn btn-xs rounded-lg">Move {b.title.length > 24 ? `${b.title.slice(0, 23)}…` : b.title} to a better spot</button>
        <button onClick={keep} className="btn btn-ghost btn-xs rounded-lg">Keep, I like it</button>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-xs rounded-lg"><Ic name="close" size={11} /></button>
      </div>
    </div>
  )
}

/** The shapes' energy targets, as the server draws them (builder.SHAPES), 0..1. */
const TARGET: Record<string, (x: number) => number> = {
  Hold: () => 0.5,
  Lift: x => 0.25 + 0.65 * x,
  Ease: x => 0.85 - 0.6 * x,
  Arc: x => 0.3 + 0.6 * Math.sin(Math.PI * x),
}

/** The set's energy as a line over the lane; the shape's target dashed under it in Best blend. */
export function EnergyLine({ tracks, facts, shape, pinned, curve }: { tracks: MusicTrack[]; facts: Facts; shape?: string; /** Rows to mark with a dot on the line (pins). */ pinned?: (t: MusicTrack, i: number) => boolean; /** A flow's energy curve to draw dashed as the target instead of a named shape. */ curve?: [number, number][] }) {
  const total = tracks.reduce((a, t) => a + Math.max(1, t.duration), 0) || 1
  let run = 0
  const pts: [number, number][] = []
  const dots: [number, number][] = []
  for (const [i, t] of tracks.entries()) {
    const d = Math.max(1, t.duration)
    const e = facts(t.id).energy
    if (e != null) {
      pts.push([((run + d / 2) / total) * 100, 22 - (e / 100) * 20])
      if (pinned?.(t, i)) dots.push(pts[pts.length - 1])
    }
    run += d
  }
  const f = shape ? TARGET[shape] : undefined
  const target = curve ? curve.map(([x, v]) => `${(x * 100).toFixed(1)},${(22 - v * 20).toFixed(1)}`).join(' ') : f ? Array.from({ length: 21 }, (_, i) => `${i * 5},${(22 - f(i / 20) * 20).toFixed(1)}`).join(' ') : ''
  return (
    <div className="relative">
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="block h-6 w-full" aria-hidden="true">
      {target && <polyline points={target} fill="none" stroke="oklch(80% .02 240 / .45)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      {pts.length > 1 && <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke="oklch(82% .11 75)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
    </svg>
    {dots.map(([x, y], k) => <i key={k} className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: `${x}%`, top: `${(y / 24) * 100}%` }} />)}
    </div>
  )
}
