// The layer's presence: 0 is the bar, 1 the full player (SPEC-music-player-motion §3).

export const OPEN_MS = 380
export const CLOSE_MS = 300
/** Reduced motion: a plain fade. */
export const FADE_MS = 150
/** A release past this share of the way finishes the move. */
export const SETTLE = 0.3
/** A release faster than this (px/ms) finishes the move in its direction. */
export const FLICK = 0.5
/** A flick needs this much travel (px), so a twitch is not one. */
export const FLICK_MIN = 20

/** A CSS cubic-bezier(p1x, p1y, p2x, p2y) as a function of x in [0, 1]. */
export function cubic(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by
  const X = (t: number) => ((ax * t + bx) * t + cx) * t
  return x => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0, hi = 1
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2
      if (X(m) < x) lo = m
      else hi = m
    }
    const t = (lo + hi) / 2
    return ((ay * t + by) * t + cy) * t
  }
}

/** The video morph's curve, and the one a released drag finishes on. */
export const standard = cubic(0.4, 0, 0.2, 1)
export const decelerate = cubic(0, 0, 0.2, 1)

/** Whether a drag released at `p` with vertical speed `v` (px/ms, positive is down) after `travel` px ends with the player open. */
export function settle(p: number, v: number, opening: boolean, travel = Infinity): boolean {
  const flick = Math.abs(travel) >= FLICK_MIN
  if (flick && v < -FLICK) return true
  if (flick && v > FLICK) return false
  return opening ? p > SETTLE : p > 1 - SETTLE
}

/** Vertical speed over the last 100 ms of `samples` ([event time ms, y px]), so a drag that stops before release is not a flick.
 *  Event times, not handling times: a busy main thread delays the handlers, not the finger. */
export function speed(samples: [number, number][], now: number): number {
  const recent = samples.filter(s => now - s[0] < 100)
  if (recent.length < 2) return 0
  const a = recent[0], b = recent[recent.length - 1]
  return (b[1] - a[1]) / Math.max(1, b[0] - a[0])
}

export class Presence {
  private from: number
  private to: number
  private t0 = 0
  private ms = 0
  private curve = standard
  private held: number | null = null
  /** Bumped whenever a motion or a hold starts, so the layer knows to measure the bar again. */
  gen = 0
  /** Reduced motion: the layer fades instead of growing. */
  fade = false

  constructor(p: number) {
    this.from = this.to = p
  }

  value(now: number): number {
    if (this.held !== null) return this.held
    const k = this.ms ? Math.min(1, Math.max(0, (now - this.t0) / this.ms)) : 1
    return this.from + (this.to - this.from) * this.curve(k)
  }

  target(): number {
    return this.held ?? this.to
  }

  moving(now: number): boolean {
    return this.held !== null || (this.from !== this.to && now - this.t0 < this.ms)
  }

  holding(): boolean {
    return this.held !== null
  }

  /** Runs to `to` from wherever it is; the duration shrinks with the distance left. */
  go(to: number, now: number, released = false, still = false): void {
    const from = this.value(now)
    if (this.held === null && to === this.to && this.moving(now)) return
    this.from = from
    this.held = null
    this.to = to
    this.t0 = now
    this.fade = still
    this.ms = (still ? FADE_MS : to > from ? OPEN_MS : CLOSE_MS) * Math.abs(to - from)
    this.curve = released ? decelerate : standard
    this.gen++
  }

  hold(p: number): void {
    if (this.held === null) this.gen++
    this.fade = false
    this.held = Math.min(1, Math.max(0, p))
  }
}
