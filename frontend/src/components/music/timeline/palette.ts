// SPEC-music-player §5.9. Each colour is [L %, C, H]; `edge` is the fine line on the highs.
export type Oklch = readonly [number, number, number]
export interface Palette {
  lo: Oklch
  mi: Oklch
  hi: Oklch
  edge: Oklch
}

export const PALETTES = {
  twilight: { lo: [42, 0.16, 300], mi: [70, 0.15, 355], hi: [87, 0.12, 75], edge: [95, 0.07, 75] },
  lagoon: { lo: [40, 0.14, 255], mi: [68, 0.12, 200], hi: [90, 0.09, 180], edge: [97, 0.05, 180] },
  glacier: { lo: [38, 0.13, 265], mi: [70, 0.11, 232], hi: [93, 0.05, 205], edge: [98, 0.02, 205] },
  reef: { lo: [44, 0.11, 215], mi: [74, 0.13, 188], hi: [90, 0.13, 155], edge: [97, 0.07, 155] },
  abyss: { lo: [34, 0.16, 282], mi: [64, 0.18, 252], hi: [88, 0.13, 200], edge: [97, 0.06, 200] },
  tide: { lo: [40, 0.14, 258], mi: [70, 0.12, 195], hi: [88, 0.12, 85], edge: [96, 0.06, 85] },
  studio: { lo: [36, 0.12, 248], mi: [72, 0.15, 230], hi: [93, 0.06, 215], edge: [98, 0.03, 215] },
} satisfies Record<string, Palette>

export type PaletteName = keyof typeof PALETTES
/** The timeline's default; the background's is abyss. */
export const TIMELINE_PALETTE: PaletteName = 'reef'

export const oklch = (c: Oklch, alpha = 1) => `oklch(${c[0]}% ${c[1]} ${c[2]} / ${alpha})`
