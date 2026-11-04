import type { PointerEvent as ReactPointerEvent } from 'react'
import { cancelArm } from './rowDrag'

// A finger swipes a row sideways (SPEC-music-player §5.4): right plays next, left
// removes. The row's `[data-fg]` follows the finger over a coloured backing that
// says what a release will do; past 30 % of the row's width it commits.

export interface SwipeSide {
  label: string
  tone: 'primary' | 'error'
  act: () => void
}

/** A swipe takes over once the finger moved this far, mostly sideways. */
export const SWIPE_SLOP = 10
export const COMMIT = 0.3

/** What a touch that moved by (dx, dy) is: still unsure, a sideways swipe, or a scroll (left to the list). */
export function swipeIntent(dx: number, dy: number): 'wait' | 'swipe' | 'scroll' {
  if (Math.hypot(dx, dy) < SWIPE_SLOP) return 'wait'
  return Math.abs(dx) > 1.5 * Math.abs(dy) ? 'swipe' : 'scroll'
}

export const commits = (dx: number, width: number) => Math.abs(dx) >= COMMIT * width

const EASE = 'cubic-bezier(.2,.7,.2,1)'
let endedAt = -1e9
/** The click that follows a swipe's release is not a tap on the row. */
export const justSwiped = () => performance.now() - endedAt < 350

export function armSwipe(e: ReactPointerEvent, sides: { right?: SwipeSide; left?: SwipeSide }) {
  if (e.pointerType !== 'touch' || (e.target as Element).closest('button, input, [data-grip]')) return
  const row = e.currentTarget as HTMLElement
  const fg = row.querySelector<HTMLElement>('[data-fg]')
  if (!fg) return
  const x0 = e.clientX
  const y0 = e.clientY
  const id = e.pointerId
  let on = false
  let bg: HTMLElement | null = null
  let side: SwipeSide | undefined
  let dx = 0

  const backing = (s: SwipeSide, right: boolean) => {
    const b = document.createElement('div')
    b.setAttribute('aria-hidden', 'true')
    b.className = `pointer-events-none absolute inset-0 flex items-center px-4 text-[13px] font-bold ${right ? 'justify-start' : 'justify-end'} ${s.tone === 'primary' ? 'bg-primary text-primary-content' : 'bg-error text-error-content'}`
    b.textContent = s.label
    row.prepend(b)
    return b
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const mx = ev.clientX - x0
    if (!on) {
      const v = swipeIntent(mx, ev.clientY - y0)
      if (v === 'wait') return
      side = mx > 0 ? sides.right : sides.left
      if (v === 'scroll' || !side) return done()
      on = true
      cancelArm()
      bg = backing(side, mx > 0)
      fg.style.transition = 'none'
    }
    // It only goes the way it started, and resists past the commit point.
    const w = row.offsetWidth
    const raw = side === sides.right ? Math.max(0, mx) : Math.min(0, mx)
    const lim = COMMIT * w
    dx = Math.abs(raw) <= lim ? raw : Math.sign(raw) * (lim + (Math.abs(raw) - lim) * 0.5)
    fg.style.transform = `translateX(${dx}px)`
    const armed = commits(dx, w)
    if (armed !== (bg!.dataset.armed === '1')) {
      bg!.dataset.armed = armed ? '1' : '0'
      bg!.style.filter = armed ? 'none' : 'saturate(.55) brightness(.8)'
      if (armed) navigator.vibrate?.(10)
    }
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const s = on && side && commits(dx, row.offsetWidth) ? side : undefined
    done()
    if (!on) return
    endedAt = performance.now()
    const b = bg
    const back = fg.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 260, easing: EASE })
    fg.style.transform = ''
    back.onfinish = () => b?.remove()
    s?.act()
  }
  const cancel = () => {
    done()
    fg.style.transform = ''
    bg?.remove()
  }
  function done() {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}
