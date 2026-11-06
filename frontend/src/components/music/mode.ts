import { useSyncExternalStore } from 'react'
import { bez } from './interact'
import { isPhone, isShort, rects, shortCols, stageShift, type Rect } from './timeline/mapping'

// The player's two modes and the motion between them (SPEC-music-player §7, §8).

const KEY = 'sestudio.music.mode'
export type Mode = 'default' | 'expanded'

export function readMode(s?: Pick<Storage, 'getItem'>): Mode {
  try {
    return (s ?? localStorage).getItem(KEY) === 'expanded' ? 'expanded' : 'default'
  } catch {
    return 'default'
  }
}

let mode = readMode()
const listeners = new Set<() => void>()

export const getMode = () => mode

export function useMode(): Mode {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => mode)
}

export function setMode(m: Mode): void {
  mode = m
  try {
    localStorage.setItem(KEY, m)
  } catch {
    // ignore
  }
  listeners.forEach(l => l())
}

export const MODE_MS = 620

/** The mode progress, 0 default, 1 expanded. A new target retargets from wherever it is now. */
export class ModeMotion {
  private from: number
  private to: number
  private t0 = 0
  /** 0 makes it jump (reduced motion). */
  ms = MODE_MS
  /** While set, a gesture holds the progress. */
  private held: number | null = null

  constructor(t: number) {
    this.from = this.to = t
  }

  value(now: number): number {
    if (this.held !== null) return this.held
    const p = this.ms ? Math.min(1, Math.max(0, (now - this.t0) / this.ms)) : 1
    return this.from + (this.to - this.from) * bez(p)
  }

  moving(now: number): boolean {
    return this.held !== null || (this.from !== this.to && now - this.t0 < this.ms)
  }

  go(to: number, now: number): void {
    this.from = this.value(now)
    this.held = null
    this.to = to
    this.t0 = now
  }

  hold(t: number): void {
    this.held = t
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export interface Box extends Rect {
  r: number
}

export interface Frame {
  /** The sky and the light: the whole page narrowing to the stage. */
  clip: Box
  title: { x: number; y: number; scale: number }
  transport: { x: number; y: number; w: number }
  queue: Box
}

function mix<T extends Record<string, number>>(p: T, q: T, t: number): T {
  return Object.fromEntries(Object.keys(p).map(k => [k, lerp(p[k], q[k], t)])) as T
}

/** Preferred title measure on desktop default before the queue grows past its floor.
 *  136 (title.x) + 560 + 14 (gap) + 20 (right inset) = 730. Keeps the title readable on
 *  tablet / mid widths where the old W−590 rule froze it at 420 while the queue absorbed every pixel. */
const TITLE_PREF = 560
/** The default view's queue width on desktop: 1.5 × 350 once the title has TITLE_PREF, else the floor. */
const queueW = (W: number) => Math.max(350, Math.min(525, W - 170 - TITLE_PREF))

/** The title's box width, before its scale. */
/** The phone's expanded one-row transport: three buttons. */
export const PHONE_ROW = 156

export function titleWidth(W: number, H: number, x: number, t: number): number {
  if (isShort(W, H)) return shortCols(W).l - x
  // Expanded: beside the one-row transport, at scale .62.
  if (isPhone(W)) return t ? lerp(W - 44, (W - 14 - PHONE_ROW - 8 - x) / 0.62, t) : W - 44
  // With the library column open the stage is narrower: the title (at scale .73) stays inside it.
  // It stops 14 px short of the queue: the wide one of the default view, the narrower one expanded.
  const free = lerp(W - 170 - queueW(W), W - 520, t)
  const { e } = rects(W, H)
  return stageShift() ? Math.min(free, (e.x + e.w - 16 - x) / 0.73) : free
}

/** Where every part sits at progress `t`, for a viewport of W by H. */
export function frameAt(W: number, H: number, t: number): Frame {
  const { d, e } = rects(W, H)
  const sb = e.y + e.h
  const short = isShort(W, H) && shortCols(W)
  const [a, b] = short
    ? [
        // The title clears the 40 px close button at 16 px; the transport is one 48 px row.
        {
          title: { x: 68, y: 12, scale: 1 },
          transport: { x: 16, y: H - 64, w: short.l - 16 },
          queue: { x: W - short.q - 16, y: 16, w: short.q, h: H - 32, r: 16 },
        },
        {
          title: { x: 68, y: 12, scale: 1 },
          transport: { x: 16, y: H - 64, w: short.l - 16 },
          queue: { x: W - short.q - 16, y: 16, w: short.q, h: H - 32, r: 10 },
        },
      ]
    : isPhone(W)
    ? [
        {
          title: { x: 22, y: d.y + d.h + 6, scale: 1 },
          // Under the title, which sits in the 84 px under the strip.
          transport: { x: 14, y: d.y + d.h + 98, w: W - 28 },
          queue: { x: 12, y: H - 170, w: W - 24, h: 150, r: 16 },
        },
        {
          // Under the stage, the title and a one-row transport (previous, play, next) side by side.
          title: { x: 18, y: sb + 8, scale: 0.62 },
          transport: { x: W - 14 - PHONE_ROW, y: sb + 8, w: PHONE_ROW },
          queue: { x: 14, y: sb + 72, w: W - 28, h: H - (sb + 84), r: 8 },
        },
      ]
    : [
        {
          title: { x: 136, y: 118, scale: 1 },
          transport: { x: 136, y: 250, w: 420 },
          queue: { x: W - 20 - queueW(W), y: 72, w: queueW(W), h: 430, r: 16 },
        },
        {
          title: { x: 154, y: 116, scale: 0.73 },
          transport: { x: 128, y: sb + 14, w: Math.min(420, e.w) },
          queue: { x: W - 380, y: 92, w: 360, h: H - 112, r: 8 },
        },
      ]
  return {
    clip: { x: e.x * t, y: e.y * t, w: lerp(W, e.w, t), h: lerp(H, e.h, t), r: 12 * t },
    title: mix(a.title, b.title, t),
    transport: mix(a.transport, b.transport, t),
    queue: mix(a.queue, b.queue, t),
  }
}

/** A phone's pull-down of the expanded list (§7.6): the progress under the finger, the handle's width, and whether it is armed. */
export function pull(d: number) {
  const p = Math.min(1, Math.max(0, d / 120))
  return { t: 1 - 0.35 * (1 - (1 - p) ** 2), bar: 36 + 30 * p, armed: d >= 120 }
}
