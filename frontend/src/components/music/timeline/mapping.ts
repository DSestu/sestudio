// The two time-to-pixel maps of the timeline and the rects they live in
// (SPEC-music-player §6.2 to §6.4, §7). `t` is the mode progress: 0 default
// (fisheye strip), 1 expanded (life-size stage); in between is a straight
// interpolation of the two.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The playhead's place in the strip, as a fraction of its width. */
export const PH = 0.08
export const PHE = Math.min(0.34, PH * 1.7)
const B = 14
const PAST = 180
export const PHONE_WIDTH = 760

export const isPhone = (W: number) => W < PHONE_WIDTH

/** `d`: the default strip, `e`: the expanded stage. */
export function rects(W: number, H: number): { d: Rect; e: Rect } {
  if (isPhone(W)) {
    return { d: { x: 0, y: H * 0.3, w: W, h: H * 0.26 }, e: { x: 14, y: 88, w: W - 28, h: Math.min(250, H * 0.3) } }
  }
  const dh = Math.min(420, H * 0.47)
  return { d: { x: 0, y: H - dh, w: W, h: dh }, e: { x: 128, y: 92, w: W - 128 - 400, h: Math.min(520, H * 0.62) } }
}

export interface Lens {
  x: (s: number) => number
  s: (x: number) => number
  px: number
}

export function fish(R: Rect, H0: number): Lens {
  const px = R.x + R.w * PH
  const A = (R.w * (1 - PH) - 8) / Math.log(1 + H0 / B)
  const AL = Math.max(4, R.w * PH - 4) / Math.log(1 + PAST / B)
  return {
    px,
    x: s => (s >= 0 ? px + A * Math.log(1 + s / B) : px - AL * Math.log(1 - s / B)),
    s: x => {
      const d = x - px
      return Math.sign(d) * B * (Math.exp(Math.abs(d) / (d >= 0 ? A : AL)) - 1)
    },
  }
}

export function life(R: Rect, win: number): Lens {
  const px = R.x + R.w * PHE
  const pps = R.w / win
  return { px, x: s => px + s * pps, s: x => (x - px) / pps }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** The map for one frame size; `at(t)` re-aims it at a mode progress without allocating. */
export class Mapper {
  d: Rect
  e: Rect
  F: Lens
  L: Lens
  t = 0
  // Set by at(t):
  R: Rect = { x: 0, y: 0, w: 0, h: 0 }
  px = 0
  y0 = 0
  amp = 0

  readonly W: number
  readonly H: number

  constructor(W: number, H: number) {
    this.W = W
    this.H = H
    const r = rects(W, H)
    this.d = r.d
    this.e = r.e
    const small = isPhone(W)
    this.F = fish(r.d, small ? 900 : 1500)
    this.L = life(r.e, small ? 40 : 70)
    this.at(0)
  }

  at(t: number): this {
    const { d, e, R } = this
    this.t = t
    R.x = lerp(d.x, e.x, t)
    R.y = lerp(d.y, e.y, t)
    R.w = lerp(d.w, e.w, t)
    R.h = lerp(d.h, e.h, t)
    this.px = lerp(this.F.px, this.L.px, t)
    this.y0 = lerp(d.y + d.h * 0.58, e.y + e.h * 0.68, t)
    this.amp = lerp(d.h * 0.46, e.h * 0.4, t)
    return this
  }

  /** Pixel x of the time `s` seconds from the view position. */
  X = (s: number): number => (this.t === 0 ? this.F.x(s) : this.t === 1 ? this.L.x(s) : lerp(this.F.x(s), this.L.x(s), this.t))

  /** The scrub band: where a press is a scrub (PR 10). */
  band(): [number, number] {
    return [this.y0 - 1.02 * this.amp - 40, this.y0 + 0.95 * this.amp]
  }
}
