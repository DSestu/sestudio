import type { PointerEvent as ReactPointerEvent } from 'react'
import { getQueue } from '../../musicQueue'
import { wake } from './idle'
import { dropIndex, HOLD_MS, isMove, rowDragIntent } from './interact'
import { joinNear, joins } from './joins'

// Drag a row of the queue, or of the library, into the queue (SPEC-music-player §5.4);
// a library row can also land on a join of the timeline.
// A ghost follows the pointer, a drop line (the `[data-dropline]` in the queue) shows the
// place; nothing re-renders while it runs.

export interface DragSource {
  /** Queue index of the row, null for a library row that is not queued yet. */
  from: number | null
  /** Queue index of the playing row, read when needed. */
  cur: () => number
  /** Where the row was dropped (0..n, a queue boundary). */
  onDrop: (at: number) => void
  /** A queue row that can leave: a mouse dropping it outside the queue removes it. */
  onRemove?: () => void
}

interface Active {
  src: DragSource
  row: HTMLElement
  ghost: HTMLElement
  dx: number
  dy: number
  pointer: number
  at: number | null
  /** The ghost follows the pointer sideways too: a library row, or a removable row under a mouse. */
  free: boolean
  /** Out of the queue with a removable row: a release removes it. */
  out: boolean
}
interface Pending {
  src: DragSource
  row: HTMLElement
  x: number
  y: number
  pointer: number
  touch: boolean
  t0: number
  timer: number
}

let active: Active | null = null
let pending: Pending | null = null
let endedAt = -1e9
/** Where the last drop's ghost was (client px), for the FLIP of the row that settles from there. */
export const lastDrop: { top: number | null; at: number } = { top: null, at: 0 }

/** A click right after a drag is not a press on the row. */
export const justDragged = () => performance.now() - endedAt < 350

const queueEl = () => document.querySelector<HTMLElement>('[data-queue]')
const listEl = () => document.querySelector<HTMLElement>('[data-queue] [data-list]')
const rowsEl = () => [...(listEl()?.querySelectorAll<HTMLElement>('[data-item]') ?? [])]

function showLine(at: number | null) {
  const line = document.querySelector<HTMLElement>('[data-dropline]')
  if (!line) return
  line.style.opacity = at === null ? '0' : '1'
  if (at === null) return
  const rows = rowsEl()
  const ref = rows[at] ? rows[at].offsetTop : rows.length ? rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight : 0
  line.style.top = `${ref - 1}px`
}

/** Out of the queue, the ghost and the queue edge turn red and say a release removes the row. */
function setOut(a: Active, out: boolean) {
  if (a.out === out) return
  a.out = out
  document.querySelectorAll('[data-removering], [data-removechip]').forEach(el => el.remove())
  // A played row's ghost is dimmed like the row; the chip sits above the ghost's edge.
  Object.assign(a.ghost.style, { opacity: out ? '1' : '', overflow: out ? 'visible' : '', outline: out ? '1.5px solid var(--color-error)' : '' })
  a.ghost.style.setProperty('--rowbg', out ? 'color-mix(in oklch, var(--color-error) 28%, hsl(205 42% 12%))' : '')
  if (!out) return
  const ring = document.createElement('span')
  ring.dataset.removering = ''
  ring.className = 'pointer-events-none absolute inset-0 z-20 rounded-[inherit] ring-2 ring-inset ring-error'
  queueEl()?.append(ring)
  const chip = document.createElement('span')
  chip.dataset.removechip = ''
  chip.className = 'absolute -top-3 left-3 z-10 rounded-full bg-error px-2.5 py-0.5 text-[11px] font-bold text-error-content shadow'
  chip.textContent = 'Release to remove'
  a.ghost.append(chip)
}

function moveTo(e: PointerEvent) {
  const a = active
  if (!a) return
  a.ghost.style.top = `${e.clientY - a.dy}px`
  if (a.free) a.ghost.style.left = `${e.clientX - a.dx}px`
  // The phone's Library page: dropped on the Queue tab, a track goes last.
  const tab = document.querySelector<HTMLElement>('[data-droptab]')
  const tr = a.src.from === null ? tab?.parentElement?.getBoundingClientRect() : undefined
  const overTab = !!tr && e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top - 12 && e.clientY <= tr.bottom + 12
  if (tab) tab.parentElement!.dataset.over = overTab ? '1' : '0'
  if (overTab) {
    a.at = getQueue().items.length
    showLine(null)
    return
  }
  const q = queueEl()?.getBoundingClientRect()
  const list = listEl()
  if (!q || !list || e.clientX < q.left || e.clientX > q.right || e.clientY < q.top - 20 || e.clientY > q.bottom + 20) {
    setOut(a, a.free && !!a.src.onRemove)
    showLine(null)
    const j = a.src.from === null ? joinNear(joins.list, joins.band, e.clientX, e.clientY) : null
    a.at = j?.at ?? null
    if (joins.slot !== a.at) { joins.slot = a.at; wake() }
    return
  }
  setOut(a, false)
  if (joins.slot !== null) { joins.slot = null; wake() }
  if (e.clientY < q.top + 50) list.scrollTop -= 8
  else if (e.clientY > q.bottom - 40) list.scrollTop += 8
  const mids = rowsEl().map(r => r.getBoundingClientRect().top + r.offsetHeight / 2)
  a.at = dropIndex(mids, e.clientY, a.src.from, a.src.cur())
  showLine(a.at)
}

function end(cancel: boolean) {
  const a = active
  if (!a) return
  active = null
  endedAt = performance.now()
  const out = a.out
  setOut(a, false)
  lastDrop.top = cancel || out ? null : a.ghost.getBoundingClientRect().top
  lastDrop.at = endedAt
  a.ghost.remove()
  a.row.style.opacity = ''
  showLine(null)
  joins.dragging = false
  joins.slot = null
  delete document.documentElement.dataset.libdrag
  wake()
  const tabs = document.querySelector<HTMLElement>('[data-droptab]')?.parentElement
  if (tabs) tabs.dataset.over = '0'
  document.removeEventListener('touchmove', stopScroll)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('contextmenu', stopMenu)
  if (!cancel && out) return a.src.onRemove?.()
  if (cancel || a.at === null) return
  if (a.src.from !== null && !isMove(a.src.from, a.at)) return
  a.src.onDrop(a.at)
}

const stopScroll = (e: TouchEvent) => e.preventDefault()
const stopMenu = (e: Event) => e.preventDefault()
const onMove = (e: PointerEvent) => { if (active && e.pointerId === active.pointer) moveTo(e) }
const onUp = () => end(false)
const onCancel = () => end(true)
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  e.stopImmediatePropagation()
  end(true)
}

function lift(row: HTMLElement, src: DragSource, x: number, y: number, pointer: number, mouse: boolean) {
  const r = row.getBoundingClientRect()
  const ghost = row.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-item')
  ghost.classList.add('glass')
  Object.assign(ghost.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, zIndex: '100',
    pointerEvents: 'none', transform: 'scale(1.02)', borderRadius: '12px', boxShadow: '0 14px 34px rgb(0 0 0 / .55)',
  })
  document.body.append(ghost)
  row.style.opacity = '.3'
  joins.dragging = src.from === null
  // The phone's crate sheet steps aside so the queue and the timeline under it can take the drop.
  if (src.from === null) document.documentElement.dataset.libdrag = '1'
  wake()
  active = { src, row, ghost, dx: x - r.left, dy: y - r.top, pointer, at: null, free: src.from === null || (mouse && !!src.onRemove), out: false }
  document.addEventListener('touchmove', stopScroll, { passive: false })
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('contextmenu', stopMenu)
}

/** The grip starts a drag at once. */
export function gripRowDrag(e: ReactPointerEvent, src: DragSource) {
  const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-row]')
  if (!row || active) return
  e.preventDefault()
  e.stopPropagation()
  lift(row, src, e.clientX, e.clientY, e.pointerId, e.pointerType === 'mouse')
}

/** A swipe took the touch: it is not a hold any more. */
export const cancelArm = () => unarm()

function unarm() {
  if (!pending) return
  window.clearTimeout(pending.timer)
  window.removeEventListener('pointermove', onArmMove)
  window.removeEventListener('pointerup', unarm)
  window.removeEventListener('pointercancel', unarm)
  pending = null
}

function liftPending(e?: PointerEvent) {
  const p = pending
  if (!p) return
  unarm()
  lift(p.row, p.src, p.x, p.y, p.pointer, !p.touch)
  if (e) moveTo(e)
}

function onArmMove(e: PointerEvent) {
  const p = pending
  if (!p || e.pointerId !== p.pointer) return
  const verdict = rowDragIntent(p.touch, Math.hypot(e.clientX - p.x, e.clientY - p.y), performance.now() - p.t0)
  if (verdict === 'lift') liftPending(e)
  else if (verdict === 'cancel') unarm()
}

/** The rest of the row: a mouse drags after 5 px, a touch after a 300 ms hold (a swipe still scrolls). */
export function armRowDrag(e: ReactPointerEvent, src: DragSource) {
  if (e.button > 0 || active || pending || (e.target as Element).closest('button, input, [data-grip]')) return
  const touch = e.pointerType !== 'mouse'
  pending = {
    src, row: e.currentTarget as HTMLElement, x: e.clientX, y: e.clientY, pointer: e.pointerId, touch,
    t0: performance.now(),
    timer: touch ? window.setTimeout(() => { navigator.vibrate?.(12); liftPending() }, HOLD_MS) : 0,
  }
  window.addEventListener('pointermove', onArmMove)
  window.addEventListener('pointerup', unarm)
  window.addEventListener('pointercancel', unarm)
}
