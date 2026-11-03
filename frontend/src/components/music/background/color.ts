import type { Palette } from '../timeline/palette'
import type { Params } from './settings'

// SPEC-music-player §5.8.3: a band's colour is picked along the palette by its intensity.

/** Shortest-arc hue interpolation. */
const hueLerp = (a: number, b: number, t: number) => a + ((((b - a + 540) % 360) - 180) * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** `e` is the band level (0..1.5), `i` its index. Chroma and alpha scale come with it. */
export function bandColour(e: number, i: number, p: Params, pal: Palette) {
  const E = Math.min(1, e)
  const t = p.cmap ? E : i / (p.nb - 1)
  const hue = (t < 0.5 ? hueLerp(pal.lo[2], pal.mi[2], t * 2) : hueLerp(pal.mi[2], pal.hi[2], (t - 0.5) * 2)) + p.hue
  const base = t < 0.5 ? lerp(pal.lo[0], pal.mi[0], t * 2) : lerp(pal.mi[0], pal.hi[0], (t - 0.5) * 2)
  const L = clamp(base + p.lt + (p.rx ? (E - 0.5) * p.swing : 0), 0, 100)
  const C = p.rx ? p.ch * (0.25 + 1.1 * E) : p.ch
  return { L, C, hue, alpha: p.alpha * (p.rx ? Math.pow(E, p.ipow - 1) : 1) }
}

/** The CSS colour for a band at alpha `a` (before the intensity scaling). */
export function bandCss(e: number, i: number, a: number, p: Params, pal: Palette) {
  const c = bandColour(e, i, p, pal)
  return `oklch(${c.L}% ${c.C} ${c.hue} / ${Math.min(1, a * c.alpha)})`
}
