import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getQueue, type QueueItem, type QueueState, type TrackInfo } from '../../musicQueue'
import { useSummaries, useSummary } from '../../musicMeta'
import type { MusicTrack } from '../../musicLibrary'
import type { Join } from './crates/proximity'
import { addTracks } from './adding'
import { gapBridges, roughLabel } from './gaps'
import { gapName, gapTone, proxOfId, type Gap } from './queueGaps'
import { useLibraryPool } from './libraryPool'
import { armRowDrag, type DragSource } from './rowDrag'
import { fmtTime } from './format'
import { usePosition } from './player'

// The queue's transitions as places to insert (SPEC-fits-between): a mark between two rows (a pill when
// rough), the gap opened in place with what fits there, and a rail of the rough ones on the queue's edge.

const plus = <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>

/** The mark between two rows: a pill when rough, a dot otherwise; hover shows where an insert lands, a click opens it.
 *  Memoised: the queue keeps a mark per row mounted and re-renders on every mode switch and queue change. `onOpen`
 *  is left out of the comparison: it only sets the layer's state, so an older render's callback does the same. */
export const GapMark = memo(function GapMark({ gap, at, title, onOpen }: { gap: Gap | null; at: number; title?: string; onOpen: (at: number) => void }) {
  const tone = gap && gapTone(gap.join)
  return (
    <button
      type="button"
      data-gap={at}
      data-rowbg
      aria-label={`What fits before ${title ?? 'this track'}${gap?.rough ? `: ${roughLabel(gap.join)}` : ''}`}
      onClick={() => onOpen(at)}
      className="group/gap relative z-[2] -my-2 block h-4 w-full outline-none [content-visibility:auto]"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity duration-100 group-hover/gap:opacity-100 group-focus-visible/gap:opacity-100 group-data-[hl=1]/gap:opacity-100" />
      <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 grid size-4 -translate-y-1/2 scale-75 place-items-center rounded-full bg-primary text-primary-content opacity-0 transition duration-100 group-hover/gap:scale-100 group-hover/gap:opacity-100 group-focus-visible/gap:opacity-100 group-data-[hl=1]/gap:scale-100 group-data-[hl=1]/gap:opacity-100">{plus}</span>
      {gap?.rough
        ? <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 rounded-full border px-1.5 text-[10px] font-semibold leading-[14px]" style={{ color: tone!, borderColor: 'currentColor', background: 'var(--rowbg)' }}>{roughLabel(gap.join)}</span>
        : gap?.join.kind && <span aria-hidden="true" className="pointer-events-none absolute right-[58px] top-1/2 size-[5px] -translate-y-1/2 rounded-full opacity-70" style={{ background: tone! }} />}
    </button>
  )
}, (a, b) => a.gap === b.gap && a.at === b.at && a.title === b.title)

const songKey = (t: MusicTrack) => `${t.title}\u0000${t.artist}`.toLowerCase()

/** What fits a gap: the open gap's three best bridges, from every library. */
function useBridges(a: QueueItem, b: QueueItem, items: QueueItem[], limit = 3) {
  const pool = useLibraryPool()
  const { get, v } = useSummaries(useMemo(() => pool.map(t => t.id), [pool]))
  const sa = useSummary(a.track_id)
  const sb = useSummary(b.track_id)
  const taken = items.map(i => i.track_id).join()
  const list = useMemo(() => {
    if (!sa || !sb) return []
    const byId = new Map(pool.map(t => [t.id, t]))
    const known = pool.filter(t => get(t.id))
    const skip = new Set(taken.split(','))
    // A song already queued (from any library) is not offered again.
    const seen = new Set([...skip].flatMap(id => byId.has(id) ? [songKey(byId.get(id)!)] : []))
    return gapBridges(proxOfId(a.track_id, sa), proxOfId(b.track_id, sb), known.map(t => proxOfId(t.id, get(t.id))), limit * 3, skip)
      .map(r => ({ ...r, t: byId.get(r.id)! }))
      .filter(r => !seen.has(songKey(r.t)) && !!seen.add(songKey(r.t)))
      .slice(0, limit)
  }, [pool, v, sa, sb, taken, a.track_id, b.track_id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { list, ready: !!sa && !!sb, bpm: [sa?.bpm, sb?.bpm] as const }
}

function Why({ before, after, bpm }: { before: Join; after: Join; bpm: (number | undefined)[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-base-content/55">
      <i className="size-1.5 shrink-0 rounded-full" style={{ background: gapTone(before) }} />
      <span style={{ color: gapTone(before) }}>{gapName(before)}</span>
      <span>· then</span>
      <span style={{ color: gapTone(after) }}>{gapName(after)}</span>
      {bpm.every(Boolean) && <span className="tabular-nums">· {bpm.map(x => Math.round(x!)).join('→')}</span>}
    </span>
  )
}

/** The gap opened in place: its transition, the best bridges with Insert, then More and Keep. */
export function GapBox({ q, at, gap, info, onClose, onMore, onKeep }: {
  q: QueueState
  at: number
  gap: Gap | null
  info: (id: string) => TrackInfo | undefined
  onClose: () => void
  onMore: () => void
  onKeep: () => void
}) {
  const a = q.items[at - 1]
  const b = q.items[at]
  const { list, ready, bpm } = useBridges(a, b, q.items)
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = el.current
    if (!box) return
    const h = box.offsetHeight
    box.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }, [])
  const ta = info(a.track_id)?.title ?? 'the track'
  const tb = info(b.track_id)?.title ?? 'the next one'
  const tone = gap ? gapTone(gap.join) : undefined
  const insert = (t: MusicTrack, where = at) => {
    void addTracks([{ library: t.library, track_id: t.id }], where, where === at ? `${t.title} goes between ${ta} and ${tb}` : `Added ${t.title}`)
    if (where === at) onClose()
  }
  const src = (t: MusicTrack): DragSource => ({ from: null, id: t.id, cur: () => getQueue().current, onDrop: to => insert(t, to) })
  return (
    <div
      ref={el}
      data-gapbox={at}
      role="group"
      aria-label={`What fits between ${ta} and ${tb}`}
      className="relative mx-2 my-1.5 overflow-hidden rounded-xl border bg-white/[.04]"
      style={{ borderColor: gap?.rough ? `color-mix(in oklch, ${tone} 45%, transparent)` : 'rgb(255 255 255 / .1)' }}
    >
      <div className="flex items-center gap-2 border-b border-white/6 py-1.5 pl-3 pr-1.5 text-xs">
        {tone && <i className="size-2 shrink-0 rounded-full" style={{ background: tone }} />}
        <span className="min-w-0 truncate">
          <b className="font-semibold" style={{ color: tone }}>{gap ? gapName(gap.join) : 'Between'}</b>
          {bpm.every(Boolean) && <span className="text-base-content/60 tabular-nums"> · {Math.round(bpm[0]!)} → {Math.round(bpm[1]!)} BPM</span>}
        </span>
        <button aria-label="Close" onClick={onClose} className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-base text-base-content/60 hover:bg-white/8">×</button>
      </div>
      {list.map(r => (
        <div key={r.id} data-row onPointerDown={e => armRowDrag(e, src(r.t))} className="flex cursor-grab select-none touch-pan-y items-center gap-2.5 py-1.5 pl-3 pr-2 hover:bg-white/5">
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[13px] font-medium">{r.t.title}</b>
            <Why before={r.before} after={r.after} bpm={[bpm[0], r.t.bpm, bpm[1]]} />
          </div>
          <button onClick={() => insert(r.t)} className="h-8 shrink-0 rounded-lg bg-primary/20 px-3 text-xs font-semibold text-primary hover:bg-primary/30">Insert</button>
        </div>
      ))}
      {!list.length && <p className="px-3 py-3 text-xs text-base-content/55">{ready ? 'Nothing in your libraries to put here.' : 'Still reading these two tracks.'}</p>}
      <div className="flex items-center gap-3 px-3 pb-2 pt-1 text-xs">
        <button onClick={onMore} className="font-semibold text-primary hover:underline">More in Fits next</button>
        {gap?.rough && <button onClick={onKeep} className="ml-auto text-base-content/55 hover:text-base-content">Keep it as is</button>}
      </div>
    </div>
  )
}

/** Every rough transition of the queue on its right edge, placed by index, with the playing position. */
export function GapRail({ rough, n, current, title, onOpen }: { rough: Gap[]; n: number; current: number; title: (at: number) => string; onOpen: (at: number) => void }) {
  if (!rough.length || n < 2) return null
  return (
    <div aria-label="Rough transitions" className="pointer-events-none absolute bottom-16 right-0.5 top-1 z-[3] w-2 rounded-full bg-white/[.04] max-md:w-3">
      <span aria-hidden="true" className="absolute inset-x-0 h-0.5 bg-white/55" style={{ top: `${((current + 0.5) / n) * 100}%` }} />
      {rough.map(g => (
        <button
          key={g.at}
          aria-label={`${roughLabel(g.join)} before ${title(g.at)}`}
          title={`${roughLabel(g.join)} before ${title(g.at)}`}
          onClick={() => onOpen(g.at)}
          className="pointer-events-auto absolute -inset-x-0.5 h-[5px] -translate-y-1/2 rounded-sm transition-transform hover:scale-x-150 max-md:h-1.5"
          style={{ top: `${(g.at / n) * 100}%`, background: gapTone(g.join) }}
        />
      ))}
    </div>
  )
}

/** Phones: the next rough transition above the queue, with a countdown; Fix opens it, › steps to the one after. */
export function ComingUp({ q, info, rough, onFix }: { q: QueueState; info: (id: string) => TrackInfo | undefined; rough: Gap[]; onFix: (at: number) => void }) {
  const [k, setK] = useState(0)
  const cur = q.items[q.current]
  const dur = (id: string) => info(id)?.duration ?? 0
  const pos = usePosition(q, cur ? dur(cur.track_id) : 0)
  if (!rough.length || !cur) return null
  const g = rough[k % rough.length]
  let s = dur(cur.track_id) - pos
  for (let i = q.current + 1; i < g.at; i++) s += dur(q.items[i].track_id)
  const tone = gapTone(g.join)
  return (
    <div className="relative mx-3 mb-2 flex items-center gap-2.5 rounded-xl border py-1.5 pl-3 pr-1.5" style={{ borderColor: `color-mix(in oklch, ${tone} 38%, transparent)`, background: `color-mix(in oklch, ${tone} 9%, transparent)` }}>
      <i className="size-2 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block text-[13px] font-semibold">{roughLabel(g.join)} <span className="font-normal tabular-nums text-base-content/70">in {fmtTime(Math.max(0, s))}</span></b>
        <span className="block truncate text-[11px] text-base-content/60">{info(q.items[g.at - 1].track_id)?.title} → {info(q.items[g.at].track_id)?.title}{rough.length > 1 && ` · ${(k % rough.length) + 1} of ${rough.length}`}</span>
      </span>
      <button onClick={() => onFix(g.at)} className="h-10 shrink-0 rounded-lg bg-primary/20 px-3.5 text-xs font-semibold text-primary">Fix</button>
      {rough.length > 1 && <button aria-label="Next rough transition" onClick={() => setK(k + 1)} className="grid size-10 shrink-0 place-items-center rounded-lg text-lg text-base-content/60 hover:bg-white/8">›</button>}
    </div>
  )
}
