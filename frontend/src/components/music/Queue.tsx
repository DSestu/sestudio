import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { metaLine, useSummary } from '../../musicMeta'
import { useTheory } from '../../musicTheory'
import { getQueue, queueActions, type QueueItem, type QueueState, type TrackInfo } from '../../musicQueue'
import { removeItem } from './adding'
import { useAutopilot } from './autopilot'
import JoinChip from './crates/JoinChip'
import { BLEND } from './engine'
import { fmtTime } from './format'
import { ENTER_MS, FLIP_MS, flipOffsets, LEAVE_MS } from './interact'
import Meter from './Meter'
import KeyListen from './KeyListen'
import QueueActions from './QueueActions'
import { useAnalyses } from './mix/analysis'
import { playItem } from './player'
import { armRowDrag, gripRowDrag, justDragged, lastDrop, type DragSource } from './rowDrag'
import { armSwipe, justSwiped } from './swipe'
import RowThread from './RowThread'
import FlowStrip, { SlotChip } from './flows/FlowStrip'
import { rangeOf, type Range } from './thread'

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
  /** The queue's energy scale, for the row's thread. */
  range: Range | null
  /** Bumps when analyses arrive: the thread reads them at render. */
  v: number
}

// Memoised: the Layer re-renders on every mode change and queue tick, and a long queue re-rendering all its rows
// stalls the frame. `source` is rebuilt each render but reads the queue through a ref, so only its index counts.
const Row = memo(function Row({ item, info, playing, source, leaving, tv, range }: RowProps) {
  const theory = useTheory()
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

  const go = () => { if (!playing && !justDragged() && !justSwiped()) playItem(item.item_id) }
  const title = info?.title ?? 'the track'
  const remove = tv || playing ? undefined : () => removeItem(item, title)
  const src = remove ? { ...source, onRemove: remove } : source
  return (
    <div
      ref={el}
      role="button"
      tabIndex={0}
      data-row
      {...(!leaving && { 'data-item': item.item_id })}
      // Off-screen rows skip layout and paint (a long queue re-flows on every frame of the mode switch); 50 px is a row's height.
      aria-current={playing || undefined}
      className={`group relative overflow-hidden [content-visibility:auto] [contain-intrinsic-height:auto_50px] cursor-pointer select-none touch-pan-y transition-opacity duration-[350ms] data-[played=1]:opacity-[.42] ${leaving ? 'pointer-events-none' : ''}`}
      onClick={go}
      onKeyDown={e => { if (e.key === 'Enter') go(); else if (e.key === 'Delete' || e.key === 'Backspace') remove?.() }}
      onPointerDown={leaving ? undefined : e => {
        armRowDrag(e, src)
        if (remove) armSwipe(e, { left: { label: 'Remove', tone: 'error', act: remove } })
      }}
    >
      <div data-fg className="relative flex items-center gap-2.5 px-3 py-[7px] text-[13px] group-hover:bg-white/5" style={{ background: 'var(--rowbg)' }}>
        {/* --hl (0..1) is animated by the timeline: the row under the view takes a Signal Blue wash and an accent edge. The title goes near-white, not blue: blue text on a blue wash is hard to read. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-primary" style={{ opacity: 'calc(var(--hl, 0) * .22)' }} />
        <span aria-hidden="true" className="pointer-events-none absolute left-0 inset-y-1 w-0.5 rounded-full bg-primary" style={{ opacity: 'var(--hl, 0)' }} />
        {!tv && <span
          aria-label="Drag to reorder"
          data-grip
          className="relative flex shrink-0 px-0.5 py-1 text-base-content/30 hover:text-base-content cursor-grab touch-none"
          onPointerDown={e => gripRowDrag(e, src)}
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
            {metaLine(analysis, undefined, theory) && <em className={`not-italic ${info?.artist ? 'ml-[7px]' : ''} opacity-55 tabular-nums`}>{metaLine(analysis, undefined, theory)}</em>}
          </span>
        </div>
        {item.flow && <SlotChip slot={item.flow} />}
        {/* While its key is measured the row shows the notes heard so far, then the key's run (harmonyListen). */}
        <KeyListen id={item.track_id} reading={analysis?.harmony?.track} fallback={analysis?.balance && <Meter balance={analysis.balance} />} />
        {info?.duration ? <RowThread id={item.track_id} dur={info.duration} range={range} playing={playing} /> : null}
        <span className="relative w-[30px] text-right text-[11px] text-base-content/42 tabular-nums">{info?.duration ? fmtTime(info.duration) : ''}</span>
      </div>
    </div>
  )
}, (a, b) => a.item === b.item && a.info === b.info && a.playing === b.playing && a.tv === b.tv && a.range === b.range && a.v === b.v && a.source.from === b.source.from && !a.leaving === !b.leaving)

interface Leaving {
  item: QueueItem
  at: number
}

const plus = <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>

// The row a local drag dropped, so it settles from the drop; read once by the FLIP.
let dropped: string | null = null

/** The queue sheet: header and rows. Rows slide in, out and over each other (SPEC-music-player §7.7). */
export default function Queue({ q, info, adding, onAdd, expanded, onPin, library, tv = false }: {
  q: QueueState
  info: (id: string) => TrackInfo | undefined
  /** The library is open: the crate, the desktop's column, or (with `library`) this sheet's Library page. */
  adding: boolean
  onAdd: () => void
  /** Phones (and short windows) in the expanded view: the sheet has a Library page, this list. */
  library?: ReactNode
  expanded: boolean
  onPin: () => void
  /** The station's picture: read-only, and it scrolls itself to the playing row. */
  tv?: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  const ids = q.items.map(i => i.track_id)
  const [v] = useAnalyses(ids)
  const range = rangeOf(ids)
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
            { height: '0px', opacity: 0, transform: 'translateX(48px)' },
            { height: `${h}px`, opacity: 0, transform: 'translateX(48px)', offset: 0.42 },
            { height: `${h}px`, opacity: 1, transform: 'none' },
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

  const pilot = useAutopilot(q, !tv)
  const left = q.items.slice(q.current + 1)
  const seconds = left.reduce((s, i) => s + (info(i.track_id)?.duration ?? 0) - BLEND.auto, 0)

  const source = (i: number, item: QueueItem): DragSource => ({
    from: i,
    // The live queue, not this render's: a memoised row keeps the source of its last render.
    cur: () => getQueue().current,
    onDrop: at => {
      dropped = item.item_id
      void queueActions.move(item.item_id, at > i ? at - 1 : at)
    },
  })

  const entries: { item: QueueItem; i: number; gone?: boolean }[] = q.items.map((item, i) => ({ item, i }))
  for (const l of leaving) entries.splice(Math.min(l.at, entries.length), 0, { item: l.item, i: -1, gone: true })

  return (
    <section data-queue className="relative rounded-[inherit] flex flex-col min-h-0 h-full overflow-hidden" style={{ ['--rowbg' as string]: expanded ? 'var(--color-base-200)' : 'hsl(205 42% 12%)' }}>
      {/* The layer cross-fades these two with the mode: glass by default, a flat column expanded. */}
      <span aria-hidden="true" data-qglass className="glass absolute inset-0 rounded-[inherit]" />
      <span aria-hidden="true" data-qflat className="absolute inset-0 rounded-[inherit] bg-base-200 opacity-0" />
      {!tv && <button onClick={onPin} aria-label={expanded ? 'Back to the default view' : 'Open the expanded view'} data-handle className="relative md:hidden grid h-[22px] shrink-0 place-items-center">
        {/* The sheet's three heights (player bar, this view, the list pulled up): the lit dot is where you are; a pull spreads them. */}
        <span data-bar className="group flex h-1.5 w-9 items-center justify-between">
          {[0, 1, 2].map(i => (
            <i key={i} className={`h-1.5 rounded-full group-data-armed:bg-primary ${i === (expanded ? 2 : 1) ? 'w-3.5 bg-primary' : 'w-1.5 bg-white/30'}`} />
          ))}
        </span>
      </button>}
      <header className="relative flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] font-semibold max-md:pt-0">
        {library ? (
          <div role="tablist" className="flex flex-1 gap-0.5 rounded-xl bg-white/7 p-[3px] data-[over=1]:ring-2 data-[over=1]:ring-primary">
            <button role="tab" aria-selected={!adding} className="h-9 flex-1 rounded-[9px] text-[13px] font-semibold aria-selected:bg-primary/22 aria-selected:text-primary text-base-content/55" onClick={() => { if (adding) onAdd() }}>
              Queue · {left.length}
            </button>
            <button role="tab" aria-selected={adding} data-droptab className="h-9 flex-1 rounded-[9px] text-[13px] font-semibold aria-selected:bg-primary/22 aria-selected:text-primary text-base-content/55" onClick={() => { if (!adding) onAdd() }}>
              Library
            </button>
          </div>
        ) : (
          <>
            <span>Queue</span>
            <span className="ml-auto text-xs font-normal text-base-content/42">
              {left.length} left · {Math.max(0, Math.round(seconds / 60))} min
            </span>
          </>
        )}
        {!tv && !expanded && <button
          aria-expanded={adding}
          className="md:hidden flex h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-primary px-3.5 text-[13px] font-semibold text-primary-content"
          onClick={onAdd}
        >
          {plus}
          Add
        </button>}
        {!tv && expanded && !library && <button
          aria-pressed={adding}
          title={adding ? 'Unlock: the library opens on hover' : 'Keep the library open'}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-xs font-semibold ${adding ? 'bg-primary/22 text-primary' : 'bg-white/7 hover:bg-white/12'}`}
          onClick={onAdd}
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d={adding ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.7-1.5'} />
          </svg>
          Library
        </button>}
        {!tv && <QueueActions info={info} />}
        {!tv && <button
          aria-label={expanded ? 'Unpin the queue' : 'Pin the queue'}
          aria-pressed={expanded}
          className={`max-md:hidden grid size-[26px] place-items-center rounded-[9px] hover:bg-white/10 ${expanded ? 'bg-primary/20 text-primary' : 'text-base-content/60'}`}
          onClick={onPin}
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-3 1-3.5 3.5.5 4.5-2 2-3.5-5.5L5 20l-1-1 4.5-4.5L3 11l2-2 4.5.5L13 6z" /></svg>
        </button>}
      </header>
      {!tv && !(library && adding) && <FlowStrip q={q} />}
      {library && adding ? library : <div ref={list} data-list className={`relative flex-1 overflow-y-auto overscroll-contain ${expanded ? '' : 'max-md:overflow-hidden'}`}>
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
            range={range}
            v={v}
            leaving={gone ? () => setLeaving(l => l.filter(x => x.item.item_id !== item.item_id)) : undefined}
          />
        ))}
        {pilot.ghosts.map(g => (
          <div key={g.track.id} aria-label={`Autopilot will add ${g.track.title}`} className="flex min-h-14 items-center gap-2.5 px-3 py-1.5 text-[13px] opacity-55">
            <div className="min-w-0 flex-1">
              <b className="block truncate font-medium">{g.track.title}</b>
              {g.join && <JoinChip join={g.join} className="max-w-full text-[11px] text-base-content/70" />}
            </div>
            <span className="text-[11px] text-base-content/60">Autopilot</span>
          </div>
        ))}
        {!q.items.length && <p className="px-3 py-6 text-center text-xs text-base-content/42">The queue is empty.</p>}
        {!tv && <div className={`sticky bottom-0 z-10 px-2.5 pb-2.5 pt-1.5 ${expanded ? '' : 'max-md:hidden'}`} style={{ background: 'linear-gradient(transparent, var(--rowbg) 10px)' }}>
          <button
            data-add-row
            aria-pressed={adding}
            className={`flex h-12 w-full items-center gap-2.5 rounded-xl border-[1.5px] px-3 text-[13px] font-semibold text-primary ${adding ? 'border-primary bg-primary/14' : 'border-dashed border-primary/45 hover:bg-primary/8'}`}
            onClick={onAdd}
          >
            {plus}
            Add to queue
            <span className="ml-auto text-[11px] font-normal text-base-content/42"><kbd className="font-sans">A</kbd></span>
          </button>
        </div>}
      </div>}
    </section>
  )
}
