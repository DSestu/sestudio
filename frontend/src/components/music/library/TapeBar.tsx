import type { ReactNode } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { setColour, type Colour } from '../../../musicGrouping'
import { totalTime } from '../format'
import { MOOD_ORDER, type Facts } from './facts'
import { groupingLabel, sortLabel, type Grouping } from './grouping'
import { SHAPES, type Shape } from './tapeLayout'
import { Ic } from './icons'
import { energyColor, genreColor, UNREAD } from './sigil'

// The bar above the tape (SPEC-music-library §2.4): source chip, counts, Grouped / Best blend
// (+ shape), the grouping read-back, colour, Add all; a legend for the colour under it.

export type Order = 'grouped' | 'blend'
export type { Shape }

export function Seg<T extends string>({ options, value, onPick, label }: { options: readonly (readonly [T, string])[]; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-xl bg-black/25 p-0.5">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onPick(k)} aria-pressed={value === k} className={`h-7 rounded-[9px] px-3 text-xs ${value === k ? 'bg-primary/20 text-base-content' : 'text-base-content/60 hover:text-base-content'}`}>{l}</button>
      ))}
    </div>
  )
}

export default function TapeBar({ source, onClearSource, tracks, grouping, order, onOrder, shape, onShape, colour, facts, blendLine, onAddAll, children }: {
  source?: { kind: string; name: string }
  onClearSource: () => void
  tracks: MusicTrack[]
  grouping: Grouping
  order: Order
  onOrder: (o: Order) => void
  shape: Shape
  onShape: (s: Shape) => void
  colour: Colour
  facts: Facts
  /** Best blend's summary, once the server answered. */
  blendLine?: string
  onAddAll: () => void
  /** The Blend by chip (PR 9) and the selection chip (PR 7). */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 px-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex h-8 items-center gap-1 rounded-[10px] px-3 text-[13px] font-medium ${source ? 'bg-primary/15 text-primary' : 'bg-white/6 text-base-content/80'}`}>
          {source ? <>{source.kind}: {source.name}<button onClick={onClearSource} aria-label="Back to the whole library" className="ml-1 grid size-5 place-items-center rounded-md hover:bg-white/10"><Ic name="close" size={12} width={2.4} /></button></> : 'Whole library'}
        </span>
        <span className="text-[13px] text-base-content/55"><b className="font-semibold text-base-content">{tracks.length}</b> tracks · {totalTime(tracks.reduce((s, t) => s + t.duration, 0))}</span>
        <span className="flex-1" />
        <Seg label="Order" options={[['grouped', 'Grouped'], ['blend', 'Best blend']] as const} value={order} onPick={onOrder} />
        {order === 'blend' && <Seg label="Shape" options={SHAPES.map(s => [s, s] as const)} value={shape} onPick={onShape} />}
        {order === 'blend' && blendLine && <span className="text-xs text-base-content/55">{blendLine}</span>}
        {order === 'grouped' && <span className="hidden text-xs text-base-content/45 lg:inline" title="Change grouping and sorting in the explorer">{groupingLabel(grouping)} · {sortLabel(grouping)}</span>}
        <Seg label="Colour tracks by" options={[['mood', 'Mood'], ['energy', 'Energy'], ['genre', 'Genre']] as const} value={colour} onPick={setColour} />
        {children}
        <button onClick={onAddAll} className="btn btn-sm gap-1 rounded-xl"><Ic name="plus" size={14} width={2.2} />Add all to set</button>
      </div>
      <Legend tracks={tracks} colour={colour} facts={facts} />
    </div>
  )
}

/** Mood counts, the energy gradient, or the top 8 genres, following the colour choice. */
function Legend({ tracks, colour, facts }: { tracks: MusicTrack[]; colour: Colour; facts: Facts }) {
  if (colour === 'energy') {
    return (
      <div className="flex items-center gap-2 text-[11px] text-base-content/50">
        <span>Energy</span>
        <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${energyColor(0)}, ${energyColor(40)}, ${energyColor(70)}, ${energyColor(100)})` }} />
        <span>Calm → Intense</span>
      </div>
    )
  }
  const counts = new Map<string, number>()
  for (const t of tracks) {
    const f = facts(t.id)
    const k = colour === 'genre' ? f.genre : f.mood?.word
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const items = colour === 'genre'
    ? [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g, n]) => ({ k: g, n, c: genreColor(g) }))
    : MOOD_ORDER.filter(w => counts.has(w)).map(w => ({ k: w, n: counts.get(w)!, c: tracks.map(t => facts(t.id).mood).find(m => m?.word === w)?.color ?? UNREAD }))
  const unread = tracks.length - [...counts.values()].reduce((a, b) => a + b, 0)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-base-content/55">
      {items.map(i => <span key={i.k} className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: i.c }} />{i.k} <b className="font-medium text-base-content/80">{i.n}</b></span>)}
      {unread > 0 && <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: UNREAD }} />Unread <b className="font-medium text-base-content/80">{unread}</b></span>}
    </div>
  )
}
