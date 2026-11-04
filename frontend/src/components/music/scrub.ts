import { getQueue, queueActions } from '../../musicQueue'
import { engine } from './engine'
import {
  clampView, glidePos, GLIDE_MS, grabbed, inertiaStep, INERTIA_MIN, LIVE_MS, SCRUB_SLOP, velocity,
} from './interact'
import type { TimelineRenderer } from './timeline/render'
import { trackAt } from './timeline/sampling'

// Scrubbing and jumping on the timeline (SPEC-music-player §6.10): a drag
// inside the scrub band grabs the timeline and the sound follows live, a
// release keeps gliding, a double tap glides to the time pressed (or to the
// label's track). Title and row clicks glide too.

const DOUBLE_MS = 350

/** What the scrubber needs of the drawn queue. */
export interface ScrubModel {
  /** Where each laid-out track starts on the global axis. */
  TS: number[]
  /** Queue item id of each laid-out track. */
  ids: string[]
  /** The last position the view may reach. */
  end: number
}

// The blend length the next `go` should use (the engine reads it, see player.ts).
let hint: { len: number; at: number } | null = null
export const takeBlend = (): number | null => {
  const h = hint
  hint = null
  return h && Date.now() - h.at < 2000 ? h.len : null
}

/** True while a scrub is going (and just after), so the layer's swipe-down does not close it. */
export const gesture = { active: false, endedAt: 0 }
export const scrubbing = () => gesture.active || Date.now() - gesture.endedAt < 150

const SKIP = 'button, input, a, textarea, [role=slider], [data-queue], [data-addp]'

interface Drag {
  x0: number
  y0: number
  g0: number
  sg: number
  moved: boolean
  last: [number, number]
  vel: number
  label: number
  seekAt: number
}

/** The seek bar's drag, in the playing track's seconds; t0 is the release time (0 while dragging). */
export const bar = { pos: null as number | null, t0: 0 }
/** Where the seek bar holds the playing track, so the timeline follows a drag; null when it does not. */
export function barPos(now: number): number | null {
  if (bar.pos === null) return null
  if (!bar.t0) return bar.pos
  // Held after the release until the server's own position has caught up.
  if (now - bar.t0 > 400) { bar.pos = null; return null }
  return bar.pos + (getQueue().playing ? (now - bar.t0) / 1000 : 0)
}

let current: Scrubber | null = null
/** The timeline that is up, so a row click can glide it. */
export const registerScrubber = (s: Scrubber | null) => { current = s }
/** Glide the view to a queue row and play it; false when no timeline is up to do it. */
export function glideToItem(itemId: string): boolean {
  return current?.glideToItem(itemId) ?? false
}

export class Scrubber {
  /** The view position while scrubbing or gliding, else null (the sound's own). */
  view: number | null = null
  private drag: Drag | null = null
  private jump: { from: number; g: number; t0: number; play: boolean } | null = null
  private glide: { g: number; v: number; last: number } | null = null
  private settle: { g: number; t0: number } | null = null
  private hover = -1
  private nowG = 0
  /** The last tap without a drag, so the next one can make it a double tap. */
  private tapped: { at: number; x: number; y: number } | null = null

  constructor(o: Scrubber['o']) {
    this.o = o
  }

  private o: {
    root: HTMLElement
    r: TimelineRenderer
    model: () => ScrubModel | null
    progress: () => number
    /** A press on the timeline outside the scrub band. */
    outside: () => void
  }

  /** The hovered label (layout index), -1 for none. */
  get hovered() {
    return this.hover
  }

  /** Call every frame. `nowG` is the view the sound has; the result is the one to draw. */
  frame(now: number, nowG: number): number {
    this.nowG = nowG
    const m = this.o.model()
    const playing = getQueue().playing
    if (this.jump) {
      const j = this.jump
      this.view = glidePos(j.from, j.g, now - j.t0, playing || j.play)
      if (now - j.t0 >= GLIDE_MS) { this.settle = { g: this.view, t0: now }; this.jump = null }
    } else if (this.glide && m) {
      const s = inertiaStep(this.glide.g, this.glide.v, now - this.glide.last, m.end)
      this.glide = { g: s.g, v: s.v, last: now }
      this.view = s.g
      if (s.done) this.finish(s.g)
    } else if (this.settle && !this.drag) {
      // Until the server's own position has caught up with the jump.
      if (now - this.settle.t0 > 400) { this.settle = null; this.view = null }
      else this.view = this.settle.g + (playing ? (now - this.settle.t0) / 1000 : 0)
    } else if (!this.drag) this.view = null
    return this.view ?? nowG
  }

  private map() {
    const M = this.o.r.M
    return this.o.progress() > 0.5 ? M.L : M.F
  }

  private seek(g: number, blend: number) {
    const m = this.o.model()
    if (!m) return
    const at = clampView(g, m.end)
    const k = trackAt(m.TS, at)
    const off = at - m.TS[k]
    const q = getQueue()
    if (q.items[q.current]?.item_id === m.ids[k]) {
      engine.seek(off)
      void queueActions.transport('seek', { position: off })
    } else {
      hint = { len: blend, at: Date.now() }
      void queueActions.play(m.ids[k], off)
    }
  }

  private finish(g: number) {
    this.glide = null
    this.seek(g, 0.4)
    this.settle = { g, t0: performance.now() }
    this.view = g
  }

  /** Ease the view to `g`; the sound crossfades there over .6 s. `play`: start it from the top (a queue row). */
  glideTo(g: number, play = false, itemId?: string) {
    const m = this.o.model()
    if (!m) return
    const at = clampView(g, m.end)
    if (play && itemId) {
      hint = { len: 0.6, at: Date.now() }
      void queueActions.play(itemId)
    } else this.seek(at, 0.6)
    this.jump = { from: this.view ?? this.nowG, g: at, t0: performance.now(), play }
    this.drag = this.glide = this.settle = null
    gesture.active = false
  }

  glideToItem(itemId: string): boolean {
    const m = this.o.model()
    const k = m?.ids.indexOf(itemId) ?? -1
    if (!m || k < 0) return false
    this.glideTo(m.TS[k], true, itemId)
    return true
  }

  private inBand(y: number) {
    const [a, b] = this.o.r.M.band()
    return y >= a && y <= b
  }

  private hit(x: number, y: number) {
    return this.o.r.labelAt(x, y)
  }

  private down = (e: PointerEvent) => {
    const t = this.o.progress()
    const target = e.target as Element
    if ((e.pointerType === 'mouse' && e.button !== 0) || !this.o.root.contains(target) || target.closest(SKIP)) return
    if (t > 0 && t < 1) return
    if (!this.inBand(e.clientY)) { this.o.outside(); return }
    const g0 = this.view ?? this.nowG
    this.jump = this.glide = this.settle = null
    this.view = g0
    this.drag = {
      x0: e.clientX, y0: e.clientY, g0, sg: this.map().s(e.clientX), moved: false,
      last: [performance.now(), g0], vel: 0, label: this.hit(e.clientX, e.clientY)?.i ?? -1, seekAt: 0,
    }
    gesture.active = true
  }

  private move = (e: PointerEvent) => {
    const d = this.drag
    if (!d) {
      if (!this.o.root.contains(e.target as Node)) return
      const over = !(e.target as Element).closest(SKIP)
      this.hover = over ? this.hit(e.clientX, e.clientY)?.i ?? -1 : -1
      this.o.root.style.cursor = !over ? '' : this.hover >= 0 ? 'pointer' : this.inBand(e.clientY) ? 'grab' : ''
      return
    }
    const m = this.o.model()
    if (!m) return
    const dx = Math.abs(e.clientX - d.x0)
    const dy = Math.abs(e.clientY - d.y0)
    // A vertical drag is the layer's (it switches the mode), not a scrub or a tap.
    if (!d.moved && dy > SCRUB_SLOP * 2 && dy > dx) {
      this.drag = this.view = null
      gesture.active = false
      this.o.root.style.cursor = ''
      return
    }
    if (dx > SCRUB_SLOP) d.moved = true
    if (!d.moved) return
    this.o.root.style.cursor = 'grabbing'
    const now = performance.now()
    const g = grabbed(d.g0, d.sg, this.map().s(e.clientX), m.end)
    d.vel = velocity(g, now, d.last[1], d.last[0])
    d.last = [now, g]
    this.view = g
    if (now - d.seekAt > LIVE_MS) {
      d.seekAt = now
      this.seek(g, 0.12)
    }
  }

  private up = (e: PointerEvent) => {
    const d = this.drag
    if (!d) return
    this.drag = null
    gesture.active = false
    gesture.endedAt = Date.now()
    this.o.root.style.cursor = ''
    const m = this.o.model()
    if (!m) { this.view = null; return }
    if (!d.moved) {
      const h = d.label >= 0 ? this.hit(e.clientX, e.clientY) : undefined
      this.view = null
      // Only a double tap glides; a single one on a label opens its transition popover (Timeline).
      const now = performance.now()
      const t = this.tapped
      const twice = !!t && now - t.at < DOUBLE_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 24
      this.tapped = twice ? null : { at: now, x: e.clientX, y: e.clientY }
      if (!twice) return
      if (h) this.glideTo(m.TS[h.i])
      else this.glideTo(this.nowG + this.map().s(e.clientX))
      return
    }
    const g = this.view ?? d.g0
    if (Math.abs(d.vel) > INERTIA_MIN) this.glide = { g, v: d.vel * 16, last: performance.now() }
    else this.finish(g)
  }

  private cancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.drag) this.up(e)
  }

  private key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.drag) return
    e.stopImmediatePropagation()
    const g0 = this.drag.g0
    this.drag = null
    gesture.active = false
    gesture.endedAt = Date.now()
    this.o.root.style.cursor = ''
    this.seek(g0, 0.2)
    this.settle = { g: g0, t0: performance.now() }
    this.view = g0
  }

  // A touch that starts a scrub must not scroll the page behind the layer.
  private touch = (e: TouchEvent) => {
    if (this.drag && !(e.target as Element).closest(SKIP)) e.preventDefault()
  }

  attach(): () => void {
    const { root } = this.o
    window.addEventListener('pointerdown', this.down)
    window.addEventListener('pointermove', this.move)
    window.addEventListener('pointerup', this.up)
    window.addEventListener('pointercancel', this.cancel)
    window.addEventListener('keydown', this.key, true)
    root.addEventListener('touchstart', this.touch, { passive: false })
    return () => {

      gesture.active = false
      window.removeEventListener('pointerdown', this.down)
      window.removeEventListener('pointermove', this.move)
      window.removeEventListener('pointerup', this.up)
      window.removeEventListener('pointercancel', this.cancel)
      window.removeEventListener('keydown', this.key, true)
      root.removeEventListener('touchstart', this.touch)
    }
  }
}
