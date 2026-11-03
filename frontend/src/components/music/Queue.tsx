import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { metaLine, useSummary } from '../../musicMeta'
import { queueActions, type QueueItem, type QueueState, type TrackInfo } from '../../musicQueue'
import { BLEND } from './engine'
import { fmtTime } from './format'
import { ENTER_MS, FLIP_MS, flipOffsets, LEAVE_MS } from './interact'
import Meter from './Meter'
import { playItem } from './player'
import { armRowDrag, gripRowDrag, justDragged, lastDrop, type DragSource } from './rowDrag'

const EASE = 'cubic-bezier(.2,.7,.2,1)'
/** More changes than this at once (a replaced queue, a playlist) just appear. */
const MAX_ANIMATED = 3

interface RowProps {
  item: QueueItem
  info?: TrackInfo
  playing: boolean
  source: DragSource
  /** A row that has been removed and is sliding out. */
  leaving?: () => void
  tv: boolean
}

function Row({ item, info, playing, source, leaving, tv }: RowProps) {
  const analysis = useSummary(item.library === 'online' ? undefined : item.track_id)
  const el = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const row = el.current
    if (!leaving || !row) return
    const h = row.offsetHeight
    row.style.overflow = 'hidden'
    const a = row.animate(
      [
        { height: `${h}px`, opacity: 1, transform: 'none' },
        { height: `${h}px`, opacity: 0, transform: 'translateX(48px)', offset: 0.5 },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateX(48px)' },
      ],
      { duration: LEAVE_MS, easing: EASE, fill: 'forwards' },
    )
    a.onfinish = leaving
    return () => a.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = () => { if (!playing && !justDragged()) playItem(item.item_id) }
  return (
    <div
      ref={el}
      role="button"
      tabIndex={0}
      data-row
      {...(!leaving && { 'data-item': item.item_id })}
      aria-current={playing || undefined}
      className={`group relative flex items-center gap-2.5 px-3 py-[7px] text-[13px] cursor-pointer select-none transition-opacity duration-[350ms] hover:bg-white/5 data-[played=1]:opacity-[.42] ${leaving ? 'pointer-events-none' : ''}`}
      onClick={go}
      onKeyDown={e => { if (e.key === 'Enter') go() }}
      onPointerDown={leaving ? undefined : e => armRowDrag(e, source)}
    >
      {/* --hl (0..1) is animated by the timeline: the row under the view takes a Signal Blue wash and an accent edge. The title goes near-white, not blue: blue text on a blue wash is hard to read. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-primary" style={{ opacity: 'calc(var(--hl, 0) * .22)' }} />
      <span aria-hidden="true" className="pointer-events-none absolute left-0 inset-y-1 w-0.5 rounded-full bg-primary" style={{ opacity: 'var(--hl, 0)' }} />
      {!tv && <span
        aria-label="Drag to reorder"
        data-grip
        className="relative flex shrink-0 px-0.5 py-1 text-base-content/30 hover:text-base-content cursor-grab touch-none"
        onPointerDown={e => gripRowDrag(e, source)}
        onClick={e => e.stopPropagation()}
      >
        <svg className="size-3.5" viewBox="0 0 14 14" fill="currentColor">
          {[3, 7, 11].map(y => [4, 10].map(x => <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" />))}
        </svg>
      </span>}
      <div className="relative flex-1 min-w-0">
        <b className="block truncate font-medium" style={{ color: 'color-mix(in oklch, white calc(var(--hl, 0) * 100%), currentColor)' }}>{info?.title ?? '…'}</b>
        <span className="block truncate text-[11px] text-base-content/52">
          {info?.artist}
          {metaLine(analysis) && <em className="not-italic ml-[7px] opacity-55 tabular-nums">{metaLine(analysis)}</em>}
        </span>
      </div>
      {analysis?.balance && <Meter balance={analysis.balance} />}
      <span className="relative w-[30px] text-right text-[11px] text-base-content/42 tabular-nums">{info?.duration ? fmtTime(info.duration) : ''}</span>
      {tv ? null : playing ? (
        <span className="size-[22px]" />
      ) : (
        <button
          aria-label="Remove from the queue"
          className="relative size-[22px] rounded-[7px] grid place-items-center text-base text-base-content/40 hover:bg-white/8 hover:text-base-content opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          onClick={e => { e.stopPropagation(); void queueActions.remove(item.item_id) }}
        >
          ×
        </button>
      )}
    </div>
  )
}

interface Leaving {
  item: QueueItem
  at: number
}

// The row a local drag dropped, so it settles from the drop; read once by the FLIP.
let dropped: string | null = null

/** The queue sheet: header and rows. Rows slide in, out and over each other (SPEC-music-player §7.7). */
export default function Queue({ q, info, adding, onAdd, expanded, onPin, tv = false }: {
  q: QueueState
  info: (id: string) => TrackInfo | undefined
  adding: boolean
  onAdd: () => void
  expanded: boolean
  onPin: () => void
  /** The station's picture: read-only, and it scrolls itself to the playing row. */
  tv?: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  const seen = useRef<{ ids: string[]; tops: Map<string, number> }>({ ids: [], tops: new Map() })

  // Removed rows stay (sliding out) until their animation ends.
  const [shown, setShown] = useState(q.items)
  const [leaving, setLeaving] = useState<Leaving[]>([])
  if (shown !== q.items) {
    setShown(q.items)
    const now = new Set(q.items.map(i => i.item_id))
    const gone = shown.filter(i => !now.has(i.item_id))
    const was = new Set(shown.map(i => i.item_id))
    const added = q.items.filter(i => !was.has(i.item_id)).length
    if (shown.length && gone.length && gone.length + added <= MAX_ANIMATED) {
      setLeaving(l => [...l, ...gone.map(item => ({ item, at: shown.indexOf(item) }))])
    }
  }

  useLayoutEffect(() => {
    const box = list.current
    if (!box) return
    const rows = [...box.querySelectorAll<HTMLElement>('[data-item]')]
    const tops = new Map(rows.map(r => [r.dataset.item!, r.offsetTop]))
    const ids = [...tops.keys()]
    const before = seen.current
    seen.current = { ids, tops }
    const added = ids.filter(id => !before.tops.has(id))
    if (!before.ids.length || ids.join() === before.ids.join()) return
    if (!added.length && ids.length === before.ids.length) {
      // A reorder: every row slides from where it was; the dragged one from where it was dropped.
      const moved = dropped
      dropped = null
      const drop = moved && lastDrop.top !== null && performance.now() - lastDrop.at < 1500
        ? lastDrop.top - box.getBoundingClientRect().top + box.scrollTop
        : undefined
      const off = flipOffsets(before.tops, tops, moved ?? undefined, drop)
      for (const r of rows) {
        const dy = off.get(r.dataset.item!)
        if (dy === undefined) continue
        const lifted = r.dataset.item === moved
        if (lifted) r.style.zIndex = '2'
        r.animate(
          [{ transform: `translateY(${dy}px)`, boxShadow: lifted ? '0 10px 28px rgb(0 0 0 / .45)' : 'none' }, { transform: 'none', boxShadow: 'none' }],
          { duration: FLIP_MS, easing: EASE },
        ).onfinish = () => { r.style.zIndex = '' }
      }
    } else if (added.length && added.length <= MAX_ANIMATED) {
      for (const r of rows) {
        if (!added.includes(r.dataset.item!)) continue
        const h = r.offsetHeight
        r.style.overflow = 'hidden'
        r.animate(
          [
            { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateX(48px)' },
            { height: `${h}px`, paddingTop: '7px', paddingBottom: '7px', opacity: 0, transform: 'translateX(48px)', offset: 0.42 },
            { height: `${h}px`, paddingTop: '7px', paddingBottom: '7px', opacity: 1, transform: 'none' },
          ],
          { duration: ENTER_MS, easing: EASE },
        ).onfinish = () => { r.style.overflow = '' }
      }
    }
  })

  const cur = q.current
  // The playing row sits 56 px below the header.
  useEffect(() => {
    if (!tv) return
    const row = list.current?.querySelector<HTMLElement>('[aria-current]')
    if (row) list.current!.scrollTo({ top: row.offsetTop - 56, behavior: 'smooth' })
  }, [tv, cur, q.items.length])

  const left = q.items.slice(q.current + 1)
  const seconds = left.reduce((s, i) => s + (info(i.track_id)?.duration ?? 0) - BLEND.auto, 0)

  const source = (i: number, item: QueueItem): DragSource => ({
    from: i,
    cur: () => q.current,
    onDrop: at => {
      dropped = item.item_id
      void queueActions.move(item.item_id, at > i ? at - 1 : at)
    },
  })

  const entries: { item: QueueItem; i: number; gone?: boolean }[] = q.items.map((item, i) => ({ item, i }))
  for (const l of leaving) entries.splice(Math.min(l.at, entries.length), 0, { item: l.item, i: -1, gone: true })

  return (
    <section data-queue className="relative rounded-[inherit] flex flex-col min-h-0 h-full overflow-hidden">
      {/* The layer cross-fades these two with the mode: glass by default, a flat column expanded. */}
      <span aria-hidden="true" data-qglass className="glass absolute inset-0 rounded-[inherit]" />
      <span aria-hidden="true" data-qflat className="absolute inset-0 rounded-[inherit] bg-base-200 opacity-0" />
      {!tv && <button onClick={onPin} aria-label={expanded ? 'Back to the default view' : 'Open the expanded view'} data-handle className="relative md:hidden grid h-[22px] shrink-0 place-items-center">
        <span data-bar className="h-1 w-9 rounded-full bg-white/30" />
      </button>}
      <header className="relative flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] font-semibold max-md:pt-0">
        <span>Queue</span>
        <span className="ml-auto text-xs font-normal text-base-content/42">
          {left.length} left · {Math.max(0, Math.round(seconds / 60))} min
        </span>
        {!tv && <button
          aria-expanded={adding}
          className={`h-[26px] rounded-[9px] bg-primary/20 px-2.5 text-xs font-semibold text-primary hover:bg-primary/30 ${expanded ? '' : 'max-md:hidden'}`}
          onClick={onAdd}
        >
          + Add
        </button>}
        {!tv && <button
          aria-label={expanded ? 'Unpin the queue' : 'Pin the queue'}
          aria-pressed={expanded}
          className={`max-md:hidden grid size-[26px] place-items-center rounded-[9px] hover:bg-white/10 ${expanded ? 'bg-primary/20 text-primary' : 'text-base-content/60'}`}
          onClick={onPin}
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-3 1-3.5 3.5.5 4.5-2 2-3.5-5.5L5 20l-1-1 4.5-4.5L3 11l2-2 4.5.5L13 6z" /></svg>
        </button>}
      </header>
      <div ref={list} data-list className={`relative flex-1 overflow-y-auto overscroll-contain ${expanded ? '' : 'max-md:overflow-hidden'}`}>
        <span
          data-dropline
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2.5 z-10 h-0.5 rounded-sm bg-primary opacity-0 ring-[3px] ring-primary/22 transition-[top,opacity] duration-80"
        />
        {entries.map(({ item, i, gone }) => (
          <Row
            key={item.item_id}
            item={item}
            info={info(item.track_id)}
            playing={!gone && i === q.current}
            source={source(i, item)}
            tv={tv}
            leaving={gone ? () => setLeaving(l => l.filter(x => x.item.item_id !== item.item_id)) : undefined}
          />
        ))}
        {!q.items.length && <p className="px-3 py-6 text-center text-xs text-base-content/42">The queue is empty.</p>}
      </div>
    </section>
  )
}
