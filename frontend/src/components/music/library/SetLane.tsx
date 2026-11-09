import { useEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import type { Summary } from '../../../musicMeta'
import { createWithTracks, usePlaylists } from '../../../musicPlaylists'
import { addPayload } from '../../../musicQueue'
import {
  clearSet, joinKey, LANDED_MS, removeFromSet, setPinOnDrop, setSetMode, setSetShape,
  togglePin, UNDO_MS, undoRemove, unpinAll, useSet,
} from '../../../musicSet'
import { totalTime } from '../format'
import { toast } from '../toast'
import type { useSetOrder } from './blendOrder'
import { clearSelection, clickSelect, idsIn, useSelection } from './selection'
import { useDeleteKey, useDragOff, useSetDrop } from './setGestures'
import type { Facts } from './facts'
import { Ic } from './icons'
import { playSetAsFlow, playSetNext, queueSetBlended } from './setQueue'
import { silhouette, trackColor, type Colour } from './sigil'
import { Seg } from './TapeBar'
import { MARK_COLOR, SHAPES } from './tapeLayout'

// Your set (SPEC-music-library §2.6): the lane under the tape. Title and actions, the order and
// pin controls, the score, the energy line (the target shape dashed in Best blend), then the
// tracks as sigils with a join diamond between each pair. Drops land between two tracks.

const LANE_H = 64
const MIN_W = 28
/** The shapes' energy targets, as the server draws them (builder.SHAPES), 0..1. */
const TARGET: Record<string, (x: number) => number> = {
  Hold: () => 0.5,
  Lift: x => 0.25 + 0.65 * x,
  Ease: x => 0.85 - 0.6 * x,
  Arc: x => 0.3 + 0.6 * Math.sin(Math.PI * x),
}

/** Re-render when a timed message runs out. */
function useExpiry(at: number | undefined, ms: number) {
  const [gone, setGone] = useState<number>()
  useEffect(() => {
    if (!at) return
    const t = window.setTimeout(() => setGone(at), Math.max(0, at + ms - Date.now()))
    return () => window.clearTimeout(t)
  }, [at, ms])
  return !!at && gone !== at
}

export default function SetLane({ order, facts, colour, get, wide, sourceName, selectedId, onSelect, hoverProps }: {
  /** The set as shown and its joins (asked once, shared with the list). */
  order: ReturnType<typeof useSetOrder>
  facts: Facts
  colour: Colour
  get: (id: string) => Summary | undefined
  wide: boolean
  /** The album open on the tape, for the suggested name. */
  sourceName?: string
  selectedId?: string
  onSelect: (t: MusicTrack) => void
  hoverProps?: (t: MusicTrack) => object
}) {
  const s = useSet()
  const blend = s.mode === 'blend'
  const { res, shown, joins } = order
  const clashes = joins?.filter((j, i) => j.problems.includes('clash') && !s.kept.includes(joinKey(shown[i], shown[i + 1]))).length ?? 0
  const secs = s.tracks.reduce((a, t) => a + t.duration, 0)
  const showLanded = useExpiry(s.landed?.at, LANDED_MS)
  const showUndo = useExpiry(s.undo?.at, UNDO_MS)
  const lane = useRef<HTMLDivElement>(null)
  const picked = idsIn(useSelection(), 'set')
  const shownIds = useMemo(() => shown.map(t => t.id), [shown])
  const { off, moveProps } = useDragOff(lane, shown, picked, 'x')
  useDeleteKey()
  const { slot, ...dropProps } = useSetDrop(lane, shown, 'x', blend)

  const landed = s.landed && showLanded ? landedLine(s.landed, shown, joins) : ''
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-white/4 p-3" aria-label="Your set">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Your set</h3>
        <span className="text-xs text-base-content/55">{s.tracks.length} {s.tracks.length === 1 ? 'track' : 'tracks'}{s.tracks.length ? ` · ${totalTime(secs)}` : ''}{res && s.tracks.length > 1 ? ` · ${res.score} blend` : ''}</span>
        <span className="flex-1" />
        <button disabled={!s.tracks.length} onClick={() => void playSetNext(shown).catch((e: Error) => toast(e.message))} className="btn btn-primary btn-sm rounded-xl gap-1"><svg className="size-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Play the set</button>
        <button disabled={!s.tracks.length} onClick={() => void queueSetBlended(shown, get).catch((e: Error) => toast(e.message))} className="btn btn-sm rounded-xl">Queue</button>
        <SaveSet tracks={shown} facts={facts} sourceName={sourceName} />
        {wide && <button disabled={!s.tracks.length} onClick={() => void playSetAsFlow(shown, sourceName ? `${sourceName} flow` : 'Your set').catch((e: Error) => toast(e.message))} className="btn btn-sm rounded-xl">As a flow</button>}
        <button disabled={!s.tracks.length} onClick={clearSet} className="btn btn-ghost btn-sm rounded-xl">Clear</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Seg label="Set order" options={[['mine', 'Your order'], ['blend', 'Best blend']] as const} value={s.mode} onPick={setSetMode} />
        {blend && <Seg label="Shape" options={SHAPES.map(x => [x, x] as const)} value={s.shape} onPick={setSetShape} />}
        <label className="flex cursor-pointer items-center gap-1.5 text-base-content/70">
          <input type="checkbox" className="toggle toggle-xs toggle-primary" checked={s.pinOnDrop} onChange={e => setPinOnDrop(e.target.checked)} />Pin on drop
        </label>
        {s.pinned.length > 0 && <button onClick={unpinAll} className="btn btn-ghost btn-xs rounded-lg">Unpin all · {s.pinned.length}</button>}
        {showUndo && s.undo && <button onClick={undoRemove} className="btn btn-xs rounded-lg">Undo remove · {s.undo.count}</button>}
        {picked.size > 0 && (
          <span className="flex items-center gap-1 text-primary">{picked.size} selected
            <button onClick={() => { removeFromSet([...picked]); clearSelection() }} className="btn btn-xs rounded-lg">Remove</button>
            <button onClick={clearSelection} className="btn btn-ghost btn-xs rounded-lg">Clear</button>
          </span>
        )}
        <span className="flex-1" />
        {s.tracks.length > 1 && <span className="tabular-nums text-base-content/55">{res ? `${res.score} blend · ${res.rough} rough · ` : ''}{s.pinned.length} pinned · {clashes} {clashes === 1 ? 'clash' : 'clashes'}</span>}
      </div>
      {off !== null && <p className="text-center text-xs font-medium text-error" role="status">Release to remove {off} {off === 1 ? 'track' : 'tracks'}</p>}
      <div {...dropProps}>
        {!s.tracks.length ? (
          <div className={`grid h-24 place-items-center rounded-xl border-2 border-dashed px-4 text-center text-xs ${slot !== null ? 'border-primary/70 bg-primary/5 text-base-content' : 'border-white/15 text-base-content/50'}`}>
            Drag tracks, albums, moods or a selection here, or press + anywhere. Best blend orders them; pinned ones stay put.
          </div>
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <EnergyLine tracks={shown} facts={facts} shape={blend ? s.shape : undefined} />
            <div ref={lane} className="relative flex items-center" style={{ height: LANE_H + 18 }}>
              {shown.map((t, i) => {
                const f = facts(t.id)
                const c = trackColor(f, colour)
                const pinned = s.pinned.includes(t.id)
                const j = joins?.[i]
                return (
                  <div key={t.id} className="contents">
                    {slot === i && <Marker />}
                    <div
                      data-set-item
                      {...moveProps(t)}
                      {...hoverProps?.(t)}
                      onClick={e => { clickSelect('set', t.id, shownIds, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey }); onSelect(t) }}
                      className={`group relative flex h-full shrink-0 cursor-pointer flex-col rounded-lg hover:bg-white/6 ${picked.has(t.id) ? 'bg-primary/12 ring-1 ring-primary/60' : ''} ${t.id === selectedId ? 'outline-1.5 outline-offset-1 outline-base-content' : ''}`}
                      style={{ flex: `${Math.max(1, t.duration)} 1 0`, minWidth: MIN_W }}
                    >
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height: LANE_H }} aria-hidden="true">
                        <path d={silhouette(f.curve, 2, 96, 96, 50)} fill={c} fillOpacity=".85" />
                      </svg>
                      <span className="truncate px-0.5 text-[10px] text-base-content/55">{pinned && <Ic name="pin" size={9} className="mr-0.5 inline text-primary" />}{t.title}</span>
                      <span className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
                        <button onClick={e => { e.stopPropagation(); togglePin(t.id, shown) }} aria-label={pinned ? `Unpin ${t.title}` : `Pin ${t.title}`} className={`grid size-5 place-items-center rounded bg-base-300/90 text-[10px] ${pinned ? 'text-primary' : ''}`}><Ic name="pin" size={11} /></button>
                        <button onClick={e => { e.stopPropagation(); removeFromSet([t.id]) }} aria-label={`Remove ${t.title}`} className="grid size-5 place-items-center rounded bg-base-300/90"><Ic name="close" size={11} width={2.4} /></button>
                      </span>
                    </div>
                    {i < shown.length - 1 && (
                      <i className="mx-0.5 size-2 shrink-0 rotate-45 rounded-[1px]" style={{ background: j ? MARK_COLOR[j.mark] : 'oklch(55% .02 240)' }} title={j ? `${Math.round(j.blend * 100)} blend${j.problems.length ? ` · ${j.problems.join(', ')}` : ''}` : 'Not read yet'} />
                    )}
                  </div>
                )
              })}
              {slot === shown.length && <Marker />}
            </div>
          </div>
        )}
      </div>
      {landed && <p className="text-xs text-base-content/70" role="status">{landed}</p>}
    </section>
  )
}

function Marker() {
  return <span className="mx-0.5 h-full w-0.5 shrink-0 rounded bg-primary" aria-hidden="true" />
}

/** `Full Bloom → #6 · blends 91 · pinned there`, `Unstable · 14 tracks → #5–18 · pinned there · 3 already in`. */
function landedLine(l: { ids: string[]; label: string; pinned: boolean; skipped: number }, shown: MusicTrack[], joins?: { blend: number }[]): string {
  if (!l.ids.length) return `${l.label}: already in your set`
  const at = l.ids.map(id => shown.findIndex(t => t.id === id)).filter(i => i >= 0).sort((a, b) => a - b)
  if (!at.length) return ''
  const where = at.length > 1 ? `#${at[0] + 1}–${at[at.length - 1] + 1}` : `#${at[0] + 1}`
  const j = l.ids.length === 1 ? joins?.[at[0] > 0 ? at[0] - 1 : 0] : undefined
  return [
    `${l.label}${l.ids.length > 1 ? ` · ${l.ids.length} tracks` : ''} → ${where}`,
    j && `blends ${Math.round(j.blend * 100)}`,
    l.pinned && 'pinned there',
    l.skipped > 0 && `${l.skipped} already in`,
  ].filter(Boolean).join(' · ')
}

/** The set's energy as a line over the lane; the shape's target dashed under it in Best blend. */
function EnergyLine({ tracks, facts, shape }: { tracks: MusicTrack[]; facts: Facts; shape?: string }) {
  const total = tracks.reduce((a, t) => a + Math.max(1, t.duration), 0) || 1
  let run = 0
  const pts: [number, number][] = []
  for (const t of tracks) {
    const d = Math.max(1, t.duration)
    const e = facts(t.id).energy
    if (e != null) pts.push([((run + d / 2) / total) * 100, 22 - (e / 100) * 20])
    run += d
  }
  const f = shape ? TARGET[shape] : undefined
  const target = f ? Array.from({ length: 21 }, (_, i) => `${i * 5},${(22 - f(i / 20) * 20).toFixed(1)}`).join(' ') : ''
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="block h-6 w-full" aria-hidden="true">
      {target && <polyline points={target} fill="none" stroke="oklch(80% .02 240 / .45)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      {pts.length > 1 && <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke="oklch(82% .11 75)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

/** Save: a small form under the button with a suggested name and a warning for a name in use. */
function SaveSet({ tracks, facts, sourceName }: { tracks: MusicTrack[]; facts: Facts; sourceName?: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const lists = usePlaylists()
  const suggest = () => {
    if (sourceName) return `${sourceName} mix`
    const n = new Map<string, number>()
    for (const t of tracks) { const w = facts(t.id).mood?.word; if (w) n.set(w, (n.get(w) ?? 0) + 1) }
    const mood = [...n].sort((a, b) => b[1] - a[1])[0]?.[0]
    const b = tracks.map(t => facts(t.id).bpm).filter((x): x is number => !!x)
    const bpm = b.length ? Math.round(b.reduce((a, x) => a + x, 0) / b.length) : undefined
    return [mood, bpm, 'set'].filter(Boolean).join(' ')
  }
  const v = name.trim()
  const dup = lists.some(l => l.name.toLowerCase() === v.toLowerCase())
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!v) return
    setOpen(false)
    createWithTracks(addPayload(tracks, 'append').tracks, v).then(
      () => toast(`Saved “${v}” · ${tracks.length} tracks · it's in Lists`),
      (err: Error) => toast(err.message),
    )
  }
  return (
    <span className="relative">
      <button disabled={!tracks.length} onClick={() => { setName(suggest()); setOpen(o => !o) }} aria-expanded={open} className="btn btn-sm rounded-xl">Save</button>
      {open && (
        <form onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }} className="absolute right-0 top-full z-30 mt-1.5 flex w-72 flex-col gap-2 rounded-xl bg-base-200 p-3 shadow-lg">
          <label className="flex flex-col gap-1 text-xs text-base-content/60">Name this playlist
            <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} className="input input-sm input-bordered text-sm text-base-content" onFocus={e => e.target.select()} />
          </label>
          <p className="text-[11px] text-base-content/50">{tracks.length} tracks · {totalTime(tracks.reduce((a, t) => a + t.duration, 0))} · in this order</p>
          {(!v || dup) && <p className="text-[11px] text-warning">{!v ? 'Give it a name' : 'A list with this name exists; this saves a second one'}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>
            <button disabled={!v} className="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
      )}
    </span>
  )
}
