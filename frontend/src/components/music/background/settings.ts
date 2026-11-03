import { useSyncExternalStore } from 'react'
import { PALETTES, TIMELINE_PALETTE, type Palette, type PaletteName } from '../timeline/palette'

// The spectral background's knobs (SPEC-music-player §5.8) and the Look panel's store.

export type Style = 'wash' | 'bloom' | 'field' | 'mirror' | 'aurora' | 'ridge' | 'fall' | 'pulse'
export const STYLES: Style[] = ['wash', 'bloom', 'field', 'mirror', 'aurora', 'ridge', 'fall', 'pulse']

/** key, label, min, max, step, default, group (a = audio, v = look), unit */
export const SPD = [
  ['nb', 'Bands', 6, 64, 1, 24, 'a', ''], ['lo', 'Lowest band', 20, 200, 1, 30, 'a', ' Hz'], ['hi', 'Highest band', 2000, 20000, 100, 16000, 'a', ' Hz'],
  ['att', 'Attack', 5, 400, 5, 35, 'a', ' ms'], ['rel', 'Release', 30, 3000, 10, 230, 'a', ' ms'], ['sm', 'Analyser smoothing', 0, 0.95, 0.05, 0.55, 'a', ''],
  ['pk', 'Peak fall', 0.5, 40, 0.5, 3.6, 'a', '/s'], ['fl', 'Floor rise', 0.2, 20, 0.2, 1.8, 'a', '/s'], ['rng', 'Min range', 2, 60, 1, 14, 'a', ''],
  ['gain', 'Gain', 0.2, 3, 0.05, 1, 'a', '×'], ['crv', 'Curve', 0.3, 3, 0.05, 1, 'a', ''], ['tilt', 'Tilt  bass ↔ highs', -1, 1, 0.05, 0, 'a', ''], ['lw', 'Loudness weight', 0, 1, 0.05, 0.5, 'a', ''],
  ['op', 'Opacity', 0, 1, 0.01, 0.62, 'v', ''], ['alpha', 'Intensity', 0, 3, 0.05, 1, 'v', '×'], ['sat', 'Saturation', 0, 3, 0.05, 1.15, 'v', ''],
  ['ht', 'Height', 0.2, 2, 0.05, 1, 'v', '×'], ['wd', 'Band width', 0.2, 3, 0.05, 1, 'v', '×'], ['ch', 'Chroma', 0, 0.32, 0.01, 0.16, 'v', ''], ['hue', 'Hue shift', -180, 180, 1, 0, 'v', '°'],
  ['lt', 'Lightness', -30, 30, 1, 0, 'v', ''], ['zoom', 'Zoom', 1, 1.6, 0.01, 1.08, 'v', '×'], ['spd', 'Motion speed', 0, 4, 0.05, 1, 'v', '×'], ['beat', 'Beat flash', 0, 2, 0.05, 1, 'v', '×'],
  ['add', 'Additive blend', 0, 1, 1, 1, 'v', ''], ['anc', 'Wash anchor  bottom ↔ timeline', 0, 1, 1, 0, 'v', ''], ['cmap', 'Colour from  frequency ↔ intensity', 0, 1, 1, 1, 'v', ''],
  ['rx', 'React by  size ↔ intensity', 0, 1, 1, 1, 'v', ''], ['rfix', 'Fixed size', 0.2, 1.2, 0.05, 0.75, 'v', '×'], ['swing', 'Brightness swing', 0, 50, 1, 8, 'v', ''],
  ['ipow', 'Intensity contrast', 0.5, 4, 0.1, 1.8, 'v', ''], ['ko', 'Timeline halo', 0, 1, 0.05, 0.85, 'v', ''], ['kb', 'Halo size', 0, 10, 0.25, 3, 'v', ' px'],
] as const

export type SKey = (typeof SPD)[number][0]
export type Params = Record<SKey, number>

export const DEFAULTS = Object.fromEntries(SPD.map(d => [d[0], d[5]])) as Params

/** CSS blur in screen px, per style. */
export const BLUR_DEFAULT: Record<Style, number> = { wash: 40, bloom: 48, field: 64, mirror: 14, aurora: 36, ridge: 22, fall: 30, pulse: 56 }

export interface Preset {
  id: string
  name: string
  desc: string
  style: Style
  blur: number
  s: Partial<Params>
}

export const PRESETS: Preset[] = [
  { id: 'drop', name: 'Drop', desc: 'Hard, instant hits. Made for dubstep drops.', style: 'bloom', blur: 40, s: { nb: 20, att: 5, rel: 140, sm: 0.3, pk: 14, fl: 8, rng: 6, gain: 1.1, crv: 1.8, op: 0.75, alpha: 1.3, sat: 1.4, ht: 1.15 } },
  { id: 'sub', name: 'Sub pulse', desc: 'The left side breathes with the kick and sub, on the beat.', style: 'pulse', blur: 60, s: { nb: 16, lo: 30, hi: 8000, att: 8, rel: 220, sm: 0.35, pk: 10, fl: 6, rng: 5, gain: 0.85, crv: 2, tilt: -0.3, op: 0.7, beat: 1.5, sat: 1.3 } },
  { id: 'roll', name: 'Rollers', desc: 'Even, steady motion for long d&b mixes.', style: 'wash', blur: 10, s: { nb: 64, lo: 49, hi: 18600, att: 30, rel: 420, sm: 0.6, pk: 6, fl: 4, rng: 6, gain: 0.85, crv: 1.9, tilt: 0, lw: 1, op: 0.55, alpha: 0.7, sat: 1.05, ht: 1.65, anc: 1, cmap: 1, rx: 1, rfix: 0.75, swing: 34, ipow: 1.8 } },
  { id: 'liquid', name: 'Liquid', desc: 'Slow curtains for liquid and melodic tracks.', style: 'aurora', blur: 52, s: { nb: 20, att: 90, rel: 900, sm: 0.75, pk: 4, fl: 3, rng: 10, gain: 1, crv: 1.3, op: 0.55, ch: 0.2, spd: 0.6, ht: 1.1 } },
  { id: 'eq', name: 'Equalizer', desc: 'Sharp bars, close to a hardware EQ.', style: 'mirror', blur: 8, s: { nb: 40, att: 6, rel: 160, sm: 0.25, pk: 12, fl: 8, rng: 5, gain: 0.95, crv: 1.9, op: 0.7, wd: 1.2, sat: 1.3 } },
  { id: 'neon', name: 'Neon ridge', desc: 'One bright spectrum line on the horizon.', style: 'ridge', blur: 18, s: { nb: 32, att: 12, rel: 260, sm: 0.45, pk: 10, fl: 6, rng: 6, gain: 0.9, crv: 1.9, op: 0.72, ch: 0.22, sat: 1.4, ht: 1.2 } },
  { id: 'smoke', name: 'Smoke', desc: 'A drifting spectrogram that rises like smoke.', style: 'fall', blur: 34, s: { nb: 28, att: 15, rel: 300, sm: 0.5, pk: 8, fl: 5, rng: 6, gain: 0.9, crv: 1.8, op: 0.65, spd: 1.4, ht: 1.2 } },
  { id: 'ambient', name: 'Ambient', desc: 'Barely moves. For background listening.', style: 'field', blur: 80, s: { nb: 12, att: 200, rel: 2000, sm: 0.85, pk: 2, fl: 1.5, rng: 12, gain: 0.9, crv: 1.2, op: 0.45 } },
]

/** Timeline parameters the Look panel changes: key, label, min, max, step, default, unit. */
export const TLD = [
  ['klo', 'Bass depth', 0.2, 1.4, 0.05, 0.7, ''], ['kmi', 'Mids height', 0.2, 1.4, 0.05, 0.9, ''], ['khi', 'Highs height', 0.1, 1, 0.02, 0.42, ''],
  ['alo', 'Bass opacity', 0, 1, 0.05, 0.9, ''], ['ami', 'Mids opacity', 0, 1, 0.05, 0.5, ''], ['ahi', 'Highs opacity', 0, 1, 0.05, 0.82, ''],
  ['edge', 'Edge line', 0, 3, 0.25, 1, ' px'], ['glow', 'Glow', 0, 3, 0.05, 0.75, ''], ['bb', 'Bass blur', 0, 8, 0.5, 3.5, ' px'],
] as const
export type TKey = (typeof TLD)[number][0]
export type TimelineLook = Record<TKey, number>
export const TL_DEFAULTS = Object.fromEntries(TLD.map(d => [d[0], d[5]])) as TimelineLook

export type BgPalette = PaletteName | 'same'

export interface Look {
  style: Style
  blur: Record<Style, number>
  s: Params
  preset: string | null
  bgPal: BgPalette
  tlPal: PaletteName
  tl: TimelineLook
}

export function applyPreset(l: Look, id: string): Look {
  const p = PRESETS.find(x => x.id === id)!
  return { ...l, style: p.style, preset: id, s: { ...DEFAULTS, ...p.s }, blur: { ...BLUR_DEFAULT, [p.style]: p.blur } }
}

/** Rollers on the Abyss background, Reef timeline. */
export const DEFAULT_LOOK: Look = applyPreset(
  { style: 'wash', blur: BLUR_DEFAULT, s: DEFAULTS, preset: null, bgPal: 'abyss', tlPal: TIMELINE_PALETTE, tl: TL_DEFAULTS },
  'roll',
)

/** The background palette; "same" follows the timeline's. */
export const bgPalette = (l: Look): Palette => PALETTES[l.bgPal === 'same' ? l.tlPal : l.bgPal]

// --- store: the lab overrides, persisted ------------------------------------

const KEY = 'music.look'

function load(): Look {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { ...DEFAULT_LOOK, ...o, s: { ...DEFAULT_LOOK.s, ...o.s }, blur: { ...DEFAULT_LOOK.blur, ...o.blur }, tl: { ...TL_DEFAULTS, ...o.tl } }
  } catch {
    return DEFAULT_LOOK
  }
}

let look = load()
const subs = new Set<() => void>()

export const getLook = () => look
export function setLook(next: Look) {
  look = next
  try { localStorage.setItem(KEY, JSON.stringify(look)) } catch { /* private mode: not persisted */ }
  subs.forEach(f => f())
}
export const useLook = () => useSyncExternalStore(f => (subs.add(f), () => void subs.delete(f)), getLook)
