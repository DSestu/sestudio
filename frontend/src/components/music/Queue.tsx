import { useRef, useState } from 'react'
import { queueActions, useAnalysis, type QueueItem, type QueueState, type TrackInfo } from '../../musicQueue'
import { BLEND } from './engine'
import { fmtBpm, fmtTime } from './format'
import Meter from './Meter'
import { playItem } from './player'

interface RowProps {
  item: QueueItem
  info?: TrackInfo
  state: 'played' | 'playing' | 'next'
  onGrip: (e: React.PointerEvent) => void
}

function Row({ item, info, state, onGrip }: RowProps) {
  const analysis = useAnalysis(item.track_id)
  const playing = state === 'playing'
  return (
    <div
      role="button"
      tabIndex={0}
      data-row
      className={`group relative flex items-center gap-2.5 px-3 py-[7px] text-[13px] cursor-pointer select-none transition-opacity hover:bg-white/5 ${
        playing ? 'bg-primary/22' : ''
      } ${state === 'played' ? 'opacity-[.42]' : ''}`}
      onClick={() => { if (!playing) playItem(item.item_id) }}
      onKeyDown={e => { if (e.key === 'Enter' && !playing) playItem(item.item_id) }}
    >
      {/* The playing row keeps its title near-white on the tint, plus an accent edge: Signal Blue text on a Signal Blue wash is hard to read. */}
      {playing && <span aria-hidden="true" className="absolute left-0 inset-y-1 w-0.5 rounded-full bg-primary" />}
      <span
        aria-label="Drag to reorder"
        className="flex shrink-0 px-0.5 py-1 text-base-content/30 hover:text-base-content cursor-grab touch-none"
        onPointerDown={onGrip}
        onClick={e => e.stopPropagation()}
      >
        <svg className="size-3.5" viewBox="0 0 14 14" fill="currentColor">
          {[3, 7, 11].map(y => [4, 10].map(x => <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" />))}
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <b className={`block truncate font-medium ${playing ? 'text-white' : ''}`}>{info?.title ?? '…'}</b>
        <span className="block truncate text-[11px] text-base-content/52">
          {info?.artist}
          {analysis?.bpm && <em className="not-italic ml-[7px] opacity-55 tabular-nums">{fmtBpm(analysis.bpm)}</em>}
        </span>
      </div>
      {analysis?.balance && <Meter balance={analysis.balance} />}
      <span className="w-[30px] text-right text-[11px] text-base-content/42 tabular-nums">{info?.duration ? fmtTime(info.duration) : ''}</span>
      {playing ? (
        <span className="size-[22px]" />
      ) : (
        <button
          aria-label="Remove from the queue"
          className="size-[22px] rounded-[7px] grid place-items-center text-base text-base-content/40 hover:bg-white/8 hover:text-base-content opacity-60 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          onClick={e => { e.stopPropagation(); void queueActions.remove(item.item_id) }}
        >
          ×
        </button>
      )}
    </div>
  )
}

function DropLine() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-x-2.5 -top-px z-10 h-0.5 rounded-sm bg-primary ring-[3px] ring-primary/22" />
}

/** The queue sheet: header and rows. Reordering drags from the grip. */
export default function Queue({ q, info }: { q: QueueState; info: (id: string) => TrackInfo | undefined }) {
  const list = useRef<HTMLDivElement>(null)
  // The row boundary the dragged row would land on (0..n), shown as a drop line.
  const [drop, setDrop] = useState<number | null>(null)

  const left = q.items.slice(q.current + 1)
  const seconds = left.reduce((s, i) => s + (info(i.track_id)?.duration ?? 0) - BLEND.auto, 0)

  const boundary = (y: number) => {
    let at = 0
    list.current!.querySelectorAll('[data-row]').forEach((r, i) => {
      const b = r.getBoundingClientRect()
      if (y > b.top + b.height / 2) at = i + 1
    })
    return at
  }
  const grip = (from: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    setDrop(from)
    const done = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', done)
      setDrop(null)
    }
    const move = (ev: PointerEvent) => setDrop(boundary(ev.clientY))
    const up = (ev: PointerEvent) => {
      const at = boundary(ev.clientY)
      done()
      // Never to its own place or the one right after it.
      if (at !== from && at !== from + 1) void queueActions.move(q.items[from].item_id, at > from ? at - 1 : at)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', done)
  }

  return (
    <section data-queue className="glass rounded-2xl flex flex-col min-h-0 h-full overflow-hidden">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2 text-[13px] font-semibold">
        <span>Queue</span>
        <span className="ml-auto text-xs font-normal text-base-content/42">
          {left.length} left · {Math.max(0, Math.round(seconds / 60))} min
        </span>
        {/* "+ Add" arrives with the add panel. */}
      </header>
      <div ref={list} className="relative flex-1 overflow-y-auto overscroll-contain">
        {q.items.map((item, i) => (
          <div key={item.item_id} className="relative">
            {drop === i && <DropLine />}
            <Row
              item={item}
              info={info(item.track_id)}
              state={i < q.current ? 'played' : i === q.current ? 'playing' : 'next'}
              onGrip={grip(i)}
            />
          </div>
        ))}
        {drop === q.items.length && <DropLine />}
        {!q.items.length && <p className="px-3 py-6 text-center text-xs text-base-content/42">The queue is empty.</p>}
      </div>
    </section>
  )
}
