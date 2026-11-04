import type { Palette } from '../timeline/palette'
import type { Params } from './settings'

// SPEC-music-player §5.8.3: a band's colour is picked along the palette by its intensity.

/** Shortest-arc hue interpolation. */
const hueLerp = (a: number, b: number, t: number) => a + ((((b - a + 540) % 360) - 180) * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** This frame's energy state (§5.8.7): the beat accent and the intensity, set by the background before painting. */
export const fx = { acc: 0, I: 1 }

/** `e` is the band level (0..1.5), `i` its index, `dh` a hue shift (the tips' drift). Chroma and alpha scale come with it. */
export function bandColour(e: number, i: number, p: Params, pal: Palette, dh = 0) {
  const E = Math.min(1, e)
  const t = p.cmap ? E * p.t1 : i / (p.nb - 1)
  const hue = (t < 0.5 ? hueLerp(pal.lo[2], pal.mi[2], t * 2) : hueLerp(pal.mi[2], pal.hi[2], (t - 0.5) * 2)) + p.hue + dh
  const base = t < 0.5 ? lerp(pal.lo[0], pal.mi[0], t * 2) : lerp(pal.mi[0], pal.hi[0], (t - 0.5) * 2)
  let L = clamp(base + p.lt + (p.rx ? (E - 0.5) * p.swing : 0) + fx.acc * 9 * E, 0, 100)
  let C = p.rx ? p.ch * (0.25 + 1.1 * E) : p.ch
  // White-hot: in high-energy passages the loudest bands overexpose towards white.
  const k = clamp((E - 0.6) / 0.4, 0, 1) * p.hot * fx.I
  L += (100 - L) * k * 0.85
  C *= 1 - k * 0.7
  return { L, C, hue, alpha: p.alpha * (p.rx ? Math.pow(E, p.ipow - 1) : 1) * (1 + fx.acc * 0.6) }
}

/** The CSS colour for a band at alpha `a` (before the intensity scaling). */
export function bandCss(e: number, i: number, a: number, p: Params, pal: Palette, dh = 0) {
  const c = bandColour(e, i, p, pal, dh)
  return `oklch(${c.L}% ${c.C} ${c.hue} / ${Math.min(1, a * c.alpha)})`
}
