// The numbers of the music player's interactions: scrub, glide and inertia
// (SPEC-music-player §6.10), the highlight (§6.11), the row drag (§5.4)
// and the queue animations (§7.7). Pure functions.

import { trackAt } from './timeline/sampling'

export const GLIDE_MS = 700
export const MORPH_MS = 650
/** A drag starts after this many pixels. */
export const SCRUB_SLOP = 4
/** The sound follows a drag at this interval, in ms. */
export const LIVE_MS = 90

/** cubic-bezier(.2, .8, .2, 1), the glide and morph easing, solved for x by Newton. */
export function bez(x: number): number {
  const [p1x, p1y, p2x, p2y] = [0.2, 0.8, 0.2, 1]
  let u = x
  for (let i = 0; i < 8; i++) {
    const X = 3 * (1 - u) * (1 - u) * u * p1x + 3 * (1 - u) * u * u * p2x + u * u * u - x
    const d = 3 * (1 - u) * (1 - u) * p1x + 6 * (1 - u) * u * (p2x - p1x) + 3 * u * u * (1 - p2x)
    if (Math.abs(d) < 1e-6) break
    u = Math.min(1, Math.max(0, u - X / d))
  }
  return 3 * (1 - u) * (1 - u) * u * p1y + 3 * (1 - u) * u * u * p2y + u * u * u
}

/** The view position stays inside the queue: the last track ends .5 s early. */
export const clampView = (g: number, end: number) => Math.max(0, Math.min(end, g))

/** Grab: the point pressed stays under the pointer. */
export const grabbed = (g0: number, sg: number, sNow: number, end: number) => clampView(g0 + sg - sNow, end)

/** Seconds of timeline per ms between the last two moves. */
export const velocity = (g: number, t: number, lastG: number, lastT: number) => (g - lastG) / Math.max(1, t - lastT)

const FRAME = 16
const DECAY = 0.9
export const INERTIA_MIN = 0.002
const STOP = 0.01

/**
 * One step of the release glide. `v` is seconds of timeline per 16 ms frame (the
 * release velocity × 16), multiplied by .9 each frame: the prototype's step made
 * frame-rate independent, with the same ≈ 158 ms time constant.
 */
export function inertiaStep(g: number, v: number, dtMs: number, end: number): { g: number; v: number; done: boolean } {
  const f = dtMs / FRAME
  const decay = DECAY ** f
  let next = g + (v * (1 - decay)) / (1 - DECAY)
  let nv = v * decay
  const c = clampView(next, end)
  if (c !== next) { next = c; nv = 0 }
  return { g: next, v: nv, done: Math.abs(nv) < STOP }
}

/** The view position of a glide: eases from `from` to a target that moves on with the clock while playing. */
export function glidePos(from: number, g: number, elapsedMs: number, playing: boolean): number {
  const p = Math.min(1, elapsedMs / GLIDE_MS)
  const to = g + (playing ? elapsedMs / 1000 : 0)
  return from + (to - from) * bez(p)
}

// --- highlight ----------------------------------------------------------------

/** The time constant of the highlight, seconds. */
export const HL_TAU = 0.12
const FLASH = 0.75

export const stepHl = (hl: number, target: number, dt: number) => hl + (target - hl) * (1 - Math.exp(-dt / HL_TAU))

/** The tracks a jump from `from` to `to` crossed (both ends included). Empty when the view moved 1 s or less. */
export function crossed(TS: number[], from: number, to: number): number[] {
  if (Math.abs(to - from) <= 1) return []
  const a = trackAt(TS, Math.min(from, to))
  const b = trackAt(TS, Math.max(from, to))
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

/** Lift the crossed tracks' highlight to at least .75 so a glide flashes everything it passes. */
export function flash(items: { hl: number }[], idx: number[]) {
  for (const i of idx) items[i].hl = Math.max(items[i].hl, FLASH)
}

// --- row drag -------------------------------------------------------------------

export const MOUSE_SLOP = 5
export const TOUCH_SLOP = 8
export const HOLD_MS = 300

/** What a pressed row does as the pointer moves: a mouse lifts after 5 px; a touch lifts after a 300 ms hold and is cancelled (it scrolls) by moving 8 px first. */
export function rowDragIntent(touch: boolean, dist: number, heldMs: number): 'wait' | 'lift' | 'cancel' {
  if (!touch) return dist > MOUSE_SLOP ? 'lift' : 'wait'
  if (heldMs >= HOLD_MS) return 'lift'
  return dist > TOUCH_SLOP ? 'cancel' : 'wait'
}

/**
 * The queue index a drag would land on (0..n), from the rows' vertical middles; `base` is the first one's index
 * (the queue renders a window of its rows).
 * A queue row never goes above the playing one unless it is the playing one;
 * a library row (`from` null) never above the row after it.
 */
export function dropIndex(mids: number[], y: number, from: number | null, cur: number, base = 0): number {
  let at = base + mids.length
  for (let i = 0; i < mids.length; i++) {
    if (y < mids[i]) { at = base + i; break }
  }
  if (from === cur) return at
  return Math.max(at, cur + (from === null ? 1 : 0))
}

/** A queue row's move is a no-op onto its own place or the one right after it. */
export const isMove = (from: number, at: number) => at !== from && at !== from + 1

// --- queue animations -----------------------------------------------------------

export const ENTER_MS = 560
export const LEAVE_MS = 500
export const FLIP_MS = 420

/** FLIP: how far each row sits from where it was. The moved row starts at the drop. */
export function flipOffsets(
  before: Map<string, number>,
  after: Map<string, number>,
  moved?: string,
  droppedAt?: number,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, top] of after) {
    const from = id === moved && droppedAt !== undefined ? droppedAt : before.get(id)
    if (from !== undefined && Math.abs(from - top) >= 0.5) out.set(id, from - top)
  }
  return out
}

/** How the timeline lags behind a change of the queue: each track's old time-to-playing minus its new one. */
export function morphOffsets(before: Map<string, number>, after: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, rel] of after) {
    const old = before.get(id)
    if (old !== undefined) out.set(id, old - rel)
  }
  return out
}

export const dipScale = (me: number) => 1 - 0.45 * Math.sin(Math.PI * me)
