import type { CSSProperties, DragEvent } from 'react'
import { moodOf } from '../../../harmony'
import { formatDuration } from '../../../musicLibrary'
import { flowStats, type Flow, type FlowRef, type Row } from './flows'

const blur = () => (document.activeElement as HTMLElement | null)?.blur()

const Line = () => <li aria-hidden="true" className="h-0.5 mx-2 -my-px rounded-full bg-(--lc)" />

/** One flow: its colour and name, a summary line and its tracks in order; a place to drop tracks on desktop. */
export default function FlowColumn({ flow, color, rows, active, over, onActive, onRename, onDelete, onRemove, onDragStart, onOver, onDrop }: {
  flow: Flow
  color: string
  rows: Row[]
  active: boolean
  /** Where a dragged track would land (0..rows.length), null when it is not over this flow. */
  over: number | null
  onActive: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onRemove: (index: number) => void
  onDragStart: (ref: FlowRef) => void
  /** The drag is over the flow at a boundary, or has left it (null); true when a drag is running (then it may drop). */
  onOver: (at: number | null) => boolean
  onDrop: (at: number) => void
}) {
  const st = flowStats(rows)
  const hover = (at: number) => (e: DragEvent) => {
    if (!onOver(at)) return
    e.preventDefault()
    e.stopPropagation()
  }
  const rowHover = (i: number) => (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    hover(e.clientY > r.top + r.height / 2 ? i + 1 : i)(e)
  }
  return (
    <section
      style={{ '--lc': color } as CSSProperties}
      aria-label={flow.name}
      onDragOver={hover(rows.length)}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onOver(null) }}
      onDrop={e => { if (over !== null) { e.preventDefault(); onDrop(over) } }}
      className={`flex flex-col min-h-0 h-full w-full md:w-72 md:shrink-0 rounded-2xl border transition-colors ${
        over !== null ? 'bg-(--lc)/10 border-(--lc)' : active ? 'bg-white/4 border-(--lc)/60' : 'bg-white/4 border-transparent'
      }`}
    >
      <header onClick={onActive} className="flex flex-col gap-1 px-3 pt-3 pb-2 cursor-pointer">
        <div className="flex items-center gap-2">
          <i aria-hidden="true" className="w-1 h-4 rounded-full bg-(--lc)" />
          <h2 className="flex-1 min-w-0 truncate text-sm font-semibold">{flow.name}</h2>
          <div className="dropdown dropdown-end" onClick={e => e.stopPropagation()}>
            <button tabIndex={0} aria-label={`Options for ${flow.name}`} className="btn btn-ghost btn-circle btn-xs">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
            <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-44 rounded-xl bg-base-200 p-1 shadow-lg">
              <li><button onClick={() => { blur(); const n = window.prompt('Rename', flow.name); if (n?.trim()) onRename(n.trim()) }}>Rename</button></li>
              <li><button className="text-error" onClick={() => { blur(); if (window.confirm(`Delete ${flow.name}?`)) onDelete() }}>Delete</button></li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-base-content/60 tabular-nums">
          {st.count} {st.count === 1 ? 'track' : 'tracks'}{st.duration ? ` · ${formatDuration(st.duration)}` : ''}
        </p>
      </header>
      <ol className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-3">
        {rows.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-base-content/50">
            <span className="hidden md:inline">Drag tracks here, or tap + in the picker.</span>
            <span className="md:hidden">Tap + on a track to add it here.</span>
          </li>
        )}
        {rows.map((r, i) => (
          <li key={`${r.ref.track_id}:${i}`} className="contents">
            {over === i && <Line />}
            <div
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.title); onDragStart(r.ref) }}
              onDragOver={rowHover(i)}
              className="group flex items-center gap-2 rounded-xl px-2 min-h-12 py-1 hover:bg-white/5 md:cursor-grab"
            >
              <i aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: moodOf(r.mode)?.color ?? 'transparent' }} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className={`block truncate text-sm font-medium ${r.missing ? 'text-base-content/40' : ''}`}>{r.title}</span>
                <span className="block truncate text-xs text-base-content/60">{r.artist}</span>
              </span>
              <span className="text-xs tabular-nums text-base-content/50">{formatDuration(r.duration)}</span>
              <button onClick={() => onRemove(i)} aria-label={`Remove ${r.title}`} className="btn btn-ghost btn-circle btn-xs relative hit">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </li>
        ))}
        {over === rows.length && <Line />}
      </ol>
    </section>
  )
}
