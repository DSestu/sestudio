import { useMemo } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { dragProps } from '../edit/focus'
import { fmtTime, totalTime } from '../format'
import type { Facts } from './facts'
import { DIMS, leavesOf, type GroupNode, type Grouping } from './grouping'
import { Ic } from './icons'

// The centre of the surface until the tape lands (SPEC-music-library §5 PR 2): the tracks in
// view as a grouped list, a header per group as the tape will have.

const bpmRange = (ts: MusicTrack[], facts: Facts) => {
  const b = ts.map(t => facts(t.id).bpm).filter((x): x is number => !!x)
  if (!b.length) return ''
  const lo = Math.round(Math.min(...b)), hi = Math.round(Math.max(...b))
  return lo === hi ? `${lo} bpm` : `${lo}–${hi} bpm`
}

export default function TrackList({ tree, grouping, facts, onPlay, onAdd }: {
  tree: GroupNode[]
  grouping: Grouping
  facts: Facts
  onPlay: (t: MusicTrack, list: MusicTrack[]) => void
  onAdd: (ts: MusicTrack[], label: string) => void
}) {
  const leaves = useMemo(() => leavesOf(tree), [tree])
  const level = grouping.files ? 'Folder' : grouping.dims.length ? DIMS[grouping.dims[grouping.dims.length - 1]].label : ''
  return (
    <div className="flex flex-col gap-4">
      {leaves.map(g => (
        <section key={g.key}>
          <header className="group flex items-baseline gap-2 px-3 pb-1">
            {level && <span className="text-[10px] font-semibold uppercase tracking-wider text-base-content/40">{g.kind === 'folder' || g.kind === 'library' ? g.key.split('|').slice(1, -1).join(' / ') || level : level}</span>}
            <h3 className="truncate text-sm font-semibold">{g.name}</h3>
            <span className="text-[11px] text-base-content/50">{[`${g.all.length}`, totalTime(g.all.reduce((s, t) => s + t.duration, 0)), bpmRange(g.all, facts)].filter(Boolean).join(' · ')}</span>
            <span className="flex-1" />
            <button onClick={() => onAdd(g.all, g.name)} className="btn btn-ghost btn-xs gap-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><Ic name="plus" size={12} width={2.2} />Add all</button>
          </header>
          <ul className="border-t border-white/8">
            {g.all.map(t => {
              const f = facts(t.id)
              return (
                <li key={t.id} className="group flex h-11 items-center gap-3 rounded-lg px-3 hover:bg-white/5" {...dragProps(t)}>
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: f.mood?.color ?? 'oklch(45% .02 240)' }} />
                  <button onClick={() => onPlay(t, g.all)} className="min-w-0 flex-1 text-left leading-tight">
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="block truncate text-[11px] text-base-content/55">{[t.artist, t.album || t.albumName, f.mood?.word, f.genre].filter(Boolean).join(' · ')}</span>
                  </button>
                  <span className="w-9 text-right text-[11px] tabular-nums text-base-content/50">{f.bpm ? Math.round(f.bpm) : ''}</span>
                  <span className="w-10 text-right text-[11px] tabular-nums text-base-content/50">{fmtTime(t.duration)}</span>
                  <button onClick={() => onAdd([t], t.title)} aria-label={`Add ${t.title}`} className="grid size-7 place-items-center rounded-md text-base-content/60 opacity-0 hover:bg-white/10 group-hover:opacity-100 focus-visible:opacity-100"><Ic name="plus" size={13} width={2.2} /></button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
