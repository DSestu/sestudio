import { useMemo, useState, type ReactNode } from 'react'
import { getQueue, type QueueState } from '../../musicQueue'
import { useSummaries } from '../../musicMeta'
import type { MusicTrack } from '../../musicLibrary'
import { addTracks } from './adding'
import type { Aim } from './Crate'
import FitsNext from './FitsNext'
import { fmtTime } from './format'
import { bestGap, isRough, type BestGap } from './gaps'
import { usePosition } from './player'
import { gapName, gapTone, proxOfId, useQueueGaps } from './queueGaps'
import { armRowDrag, type DragSource } from './rowDrag'

// The player's Fits next (SPEC-fits-between): One gap ranks what fits the focus gap (the open one,
// else the next rough transition while it follows playback, else after the last track);
// Anywhere puts each library track at its best gap.

const songKey = (t: MusicTrack) => `${t.title}\u0000${t.artist}`.toLowerCase()
const ref = (t: MusicTrack) => ({ library: t.library, track_id: t.id })

/** One choice of two, as joined pills. */
function Pair<T extends string>({ value, options, onPick, label }: { value: T; options: [T, string][]; onPick: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full bg-white/6 p-0.5">
      {options.map(([v, text]) => (
        <button key={v} aria-pressed={v === value} onClick={() => onPick(v)} className={`relative hit h-7 rounded-full px-3 text-xs font-medium ${v === value ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:text-base-content'}`}>{text}</button>
      ))}
    </div>
  )
}

/** Seconds until the transition before `items[at]`: what is left of the playing track and every track up to it. */
function useUntil(q: QueueState, byId: Map<string, MusicTrack>, at: number | null): number | null {
  const cur = q.items[q.current]
  const pos = usePosition(q, cur ? byId.get(cur.track_id)?.duration ?? 0 : 0)
  if (at === null || !cur) return null
  let s = (byId.get(cur.track_id)?.duration ?? 0) - pos
  for (let i = q.current + 1; i < at; i++) s += byId.get(q.items[i].track_id)?.duration ?? 0
  return Math.max(0, s)
}

/** Each library track at the gap where it helps most, those that fix a rough transition first. */
function Anywhere({ library, q }: { library: MusicTrack[]; q: QueueState }) {
  const { get, v } = useSummaries(useMemo(() => [...new Set([...library.map(t => t.id), ...q.items.map(i => i.track_id)])], [library, q.items]))
  const titles = (at: number) => {
    const a = library.find(t => t.id === q.items[at - 1]?.track_id)?.title
    const b = library.find(t => t.id === q.items[at]?.track_id)?.title
    return b ? `between ${a ?? 'a track'} & ${b}` : `after ${a ?? 'the last track'}, at the end`
  }
  const rows = useMemo(() => {
    const list = q.items.map(i => proxOfId(i.track_id, get(i.track_id)))
    const taken = new Set(q.items.map(i => i.track_id))
    const seen = new Set<string>()
    const out: { t: MusicTrack; g: BestGap }[] = []
    for (const t of library) {
      const s = get(t.id)
      if (!s || taken.has(t.id) || seen.has(songKey(t))) continue
      seen.add(songKey(t))
      const g = bestGap(proxOfId(t.id, s), list, Math.max(0, q.current))
      if (g) out.push({ t, g })
    }
    return out.sort((x, y) => y.g.gain - x.g.gain).slice(0, 30)
  }, [library, q.items, q.current, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const light = (at: number | null) => document.querySelectorAll<HTMLElement>('[data-gap]').forEach(el => { el.dataset.hl = String(+el.dataset.gap! === at ? 1 : 0) })
  const src = (t: MusicTrack): DragSource => ({ from: null, cur: () => getQueue().current, onDrop: at => void addTracks([ref(t)], at, `Added ${t.title}`) })
  if (!rows.length) return <p className="px-4 py-8 text-center text-sm text-base-content/60">Nothing analysed to place yet.</p>
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onMouseLeave={() => light(null)}>
      {rows.map(({ t, g }) => {
        const fixes = g.gain > 0 && !isRough(g.before) && !(g.after && isRough(g.after))
        return (
          <li key={t.id} data-row onMouseEnter={() => light(g.at)} onPointerDown={e => armRowDrag(e, src(t))} className="flex cursor-grab select-none touch-pan-y items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{t.title}</span>
              <span className="block truncate text-xs text-base-content/60">{t.artist}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-primary">
                → {titles(g.at)}
                {fixes && <span className="shrink-0 rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">smooths it</span>}
              </span>
            </span>
            <button
              onClick={() => void addTracks([ref(t)], g.at, `${t.title} goes ${titles(g.at)}`)}
              aria-label={`Insert ${t.title} ${titles(g.at)}`}
              className="btn btn-ghost btn-circle size-11 sm:size-8 text-primary"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Fits next in the player: One gap (the focus gap) or Anywhere. */
export default function FitsGap({ library, q, aim, dense, footer }: { library: MusicTrack[]; q: QueueState; aim: Aim; dense?: boolean; footer?: ReactNode }) {
  const [scope, setScope] = useState<'gap' | 'any'>('gap')
  const [follow, setFollow] = useState(true)
  const [pin, setPin] = useState<number | null>(null)
  const gaps = useQueueGaps(q)
  const byId = useMemo(() => new Map(library.map(t => [t.id, t])), [library])
  const ids = q.items.map(i => i.track_id)
  const inner = (at: number | null) => at !== null && at > q.current && at < ids.length && byId.has(ids[at - 1]) && byId.has(ids[at]) ? at : null
  const open = inner(aim.at)
  const pinned = follow ? null : inner(pin)
  const coming = follow ? inner(gaps.rough[0]?.at ?? null) : null
  const at = open ?? pinned ?? coming
  const until = useUntil(q, byId, at)
  const lastId = [...ids].reverse().find(id => byId.has(id)) ?? ids[q.current]
  const anchor = at !== null ? byId.get(ids[at - 1]) : lastId ? byId.get(lastId) : undefined
  const then = at !== null ? byId.get(ids[at]) : undefined
  const gap = at !== null ? gaps.gap(at) : null
  const label = open !== null ? 'Open gap' : pinned !== null ? 'Picked gap' : coming !== null ? 'Coming up' : 'After the last track'

  const insert = (t: MusicTrack) => {
    void addTracks([ref(t)], at ?? undefined, at !== null ? `${t.title} goes between ${anchor?.title} and ${then?.title}` : `Added ${t.title}`)
    // The gap is filled: the panel moves on (the next rough transition, while following).
    if (open !== null) aim.set(null)
    if (pinned !== null) { setPin(null); setFollow(true) }
  }
  const head = (
    <div className={`flex flex-col gap-1.5 ${dense ? 'px-2 pb-1' : 'px-4 pt-3'}`}>
      <Pair label="Where" value={scope} options={[['gap', 'One gap'], ['any', 'Anywhere']]} onPick={setScope} />
      {scope === 'gap' && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs">
            {gap && <i className="size-2 shrink-0 rounded-full" style={{ background: gapTone(gap.join) }} />}
            <b className="shrink-0 font-semibold">{label}</b>
            {at !== null && until !== null && <span className="shrink-0 tabular-nums text-base-content/60">in {fmtTime(until)}</span>}
            {gap && <span className="truncate" style={{ color: gapTone(gap.join) }}>· {gapName(gap.join)}</span>}
          </span>
          <button
            aria-pressed={follow}
            title="Follow playback: show the next rough transition as the music plays"
            onClick={() => { setFollow(!follow); setPin(follow ? at : null) }}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs ${follow ? 'text-primary' : 'text-base-content/60 hover:text-base-content'}`}
          >
            <i className={`relative h-3.5 w-6 rounded-full transition-colors ${follow ? 'bg-primary/60' : 'bg-white/15'}`}>
              <i className={`absolute top-0.5 size-2.5 rounded-full bg-base-content transition-[left] ${follow ? 'left-3' : 'left-0.5'}`} />
            </i>
            Follow playback
          </button>
        </div>
      )}
    </div>
  )
  if (scope === 'any') return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{head}<Anywhere library={library} q={q} /></div>
  if (!anchor) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {head}
        <p className="px-4 py-6 text-center text-sm text-base-content/60">Play or queue a track and what fits after it shows here.</p>
        {footer && <div className="px-4 pb-3">{footer}</div>}
      </div>
    )
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {head}
      <FitsNext
        anchor={anchor} then={then} library={library} exclude={ids} dense={dense} footer={at === null ? footer : undefined}
        where={at === null && lastId === ids.at(-1) ? 'last in the queue' : undefined}
        onAfter={() => { aim.set(null); setPin(null); setFollow(false) }}
        action={{ label: at !== null ? 'Insert' : 'Add to queue', onPick: insert }}
        drag={t => ({ from: null, cur: () => getQueue().current, onDrop: to => void addTracks([ref(t)], to, `Added ${t.title}`) })}
      />
    </div>
  )
}
