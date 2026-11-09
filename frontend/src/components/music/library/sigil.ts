import type { Colour } from '../../../musicGrouping'
import type { TrackFacts } from './facts'

// The one drawing of a track on the Music page (SPEC-music-library §2.2 "No cards"): its energy
// curve mirrored about the middle, in its colour. Lifted from the mockup's `silhouette`.

export type { Colour }

const FLAT = [20, 20]

/** The mirrored silhouette of `vals` (0..100) as an SVG path in a `w` × `h` box at `x`. */
export function silhouette(vals: number[] | undefined, x: number, w: number, h: number, cy = h / 2): string {
  const v = vals?.length ? vals : FLAT
  const n = v.length
  const px = (i: number) => (x + (i / (n - 1)) * w).toFixed(1)
  const amp = (i: number) => (v[i] / 100) * (h / 2)
  const top = v.map((_, i) => `${px(i)},${(cy - amp(i)).toFixed(1)}`)
  const bot = v.map((_, i) => `${px(i)},${(cy + amp(i)).toFixed(1)}`).reverse()
  return `M${top.join('L')}L${bot.join('L')}Z`
}

/** A stable hue for a genre name. */
export const hueOf = (s: string): number => {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export const UNREAD = 'oklch(45% .02 240)'
/** Calm blue to intense red-orange, the energy legend's gradient. */
export const energyColor = (e: number) => `oklch(${55 + (e / 100) * 28}% ${0.1 + (e / 100) * 0.08} ${250 - (e / 100) * 225})`
export const genreColor = (g?: string) => (g ? `oklch(72% .13 ${hueOf(g)})` : 'oklch(50% .02 240)')

/** A track's colour by the chosen axis; grey until its key is read. */
export function trackColor(f: TrackFacts, by: Colour): string {
  if (by === 'energy') return f.energy == null ? UNREAD : energyColor(f.energy)
  if (by === 'genre') return genreColor(f.genre)
  return f.mood?.color ?? UNREAD
}
