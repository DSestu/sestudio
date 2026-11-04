import { useSyncExternalStore } from 'react'
import { PALETTES, TIMELINE_PALETTE, type Palette, type PaletteName } from '../timeline/palette'

// The spectral background's knobs (SPEC-music-player §5.8) and the Look panel's store.

export type Style = 'wash' | 'bloom' | 'field' | 'mirror' | 'aurora' | 'ridge' | 'fall' | 'pulse'
export const STYLES: Style[] = ['wash', 'bloom', 'field', 'mirror', 'aurora', 'ridge', 'fall', 'pulse']

/** key, label, min, max, step, default, group (a = audio, e = energy, v = look, f = finish), unit. A new key's default changes nothing. */
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
  // §5.8.7: the Drive look.
  ['warp', 'Band spacing  log ↔ mel', 0, 1, 0.05, 0, 'a', ''], ['abLo', 'Loudness from', 0, 200, 5, 110, 'a', ''], ['abHi', 'Loudness to', 120, 255, 5, 230, 'a', ''],
  ['gate', 'Gate', 0, 0.5, 0.01, 0, 'a', ''], ['agc', 'Auto level', 0, 1, 0.05, 0, 'a', ''], ['agcT', 'Auto level target', 0.3, 1.5, 0.05, 0.85, 'a', ''],
  ['agcSp', 'Auto level follow', 0.3, 8, 0.1, 2, 'a', ' s'], ['knee', 'Soft ceiling from', 0.4, 1, 0.05, 0.75, 'a', ''],
  ['sync', 'Light ahead of the sound', -100, 250, 5, 220, 'a', ' ms'],
  ['en', 'Follow energy', 0, 1, 0.05, 0, 'e', ''], ['eq', 'Changes land on  beat ↔ bar ↔ 4 bars', 0, 3, 1, 2, 'e', ''],
  ['esm', 'Energy smoothing', 0, 16, 0.25, 2, 'e', ' beats'], ['dead', 'Ignore changes under', 0, 0.3, 0.01, 0.06, 'e', ''],
  ['efloor', 'Quietest intensity', 0, 1, 0.05, 0.3, 'e', ''], ['ecrv', 'Energy contrast', 0.3, 3, 0.05, 1, 'e', ''],
  ['erise', 'Rise time', 0, 16, 0.25, 0, 'e', ' beats'], ['efall', 'Fall time', 0, 32, 0.5, 4, 'e', ' beats'],
  ['eSh', 'Dynamics follow energy', 0, 1, 0.05, 1, 'e', ''], ['relLo', 'Release at full energy', 0.0625, 2, 0.0625, 0.25, 'e', ' beat'],
  ['relHi', 'Release when quiet', 0.25, 8, 0.25, 2, 'e', ' beats'], ['crvQ', 'Curve when quiet', 0.3, 3, 0.05, 1.1, 'e', ''],
  ['smQ', 'Smoothing when quiet', 0, 0.95, 0.05, 0.55, 'e', ''], ['pkQ', 'Peak fall when quiet', 0.5, 40, 0.5, 5, 'e', '/s'],
  ['lwQ', 'Loudness weight when quiet', 0, 1, 0.05, 0.15, 'e', ''], ['gateQ', 'Gate when quiet', 0, 0.5, 0.01, 0.1, 'e', ''],
  ['abLoQ', 'Loudness from, quiet', 0, 200, 5, 70, 'e', ''], ['abHiQ', 'Loudness to, quiet', 120, 255, 5, 190, 'e', ''],
  ['eCol', 'Colour reach follows energy', 0, 1, 0.05, 0, 'e', ''], ['eOp', 'Brightness follows energy', 0, 1, 0.05, 0, 'e', ''],
  ['eHt', 'Size follows energy', 0, 1, 0.05, 0, 'e', ''], ['blurHi', 'Blur at full energy', 0.2, 1, 0.05, 1, 'e', '×'],
  ['wdHi', 'Width at full energy', 0.4, 1, 0.05, 1, 'e', '×'], ['acc', 'Beat accent', 0, 1, 0.05, 0, 'e', ''], ['accDb', 'Downbeat extra', 0, 1, 0.05, 0.5, 'e', ''],
  ['xmap', 'Bass  left ↔ centre', 0, 1, 1, 0, 'v', ''], ['t1', 'Palette to', 0, 1, 0.05, 1, 'v', ''], ['hot', 'White-hot peaks', 0, 1, 0.05, 0, 'v', ''],
  ['res', 'Canvas detail', 48, 256, 8, 96, 'v', ' px'], ['asp', 'Canvas  16:9 ↔ screen shape', 0, 1, 1, 0, 'v', ''],
  ['ease', 'Column ends  linear ↔ eased', 0, 1, 1, 0, 'f', ''], ['side', 'Soft sides', 0, 1, 1, 0, 'f', ''], ['lower', 'Below the timeline', 0.3, 1, 0.05, 1, 'f', '×'],
  ['hueTop', 'Tip hue drift', -40, 40, 1, 0, 'f', '°'], ['bloom', 'Bloom', 0, 0.4, 0.01, 0, 'f', ''], ['grain', 'Grain', 0, 0.4, 0.01, 0, 'f', ''],
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
  {
    id: 'drive', name: 'Drive', style: 'wash', blur: 4,
    desc: 'Bass in the middle; the track’s energy, bar by bar, sets how hard and fast the bands move. Sharp and crisp in drops, soft and slow in intros.',
    s: {
      nb: 48, lo: 49, hi: 12400, warp: 0.45, att: 20, rel: 250, sm: 0.1, pk: 20.5, fl: 4, rng: 6, gain: 0.85, crv: 1.4, tilt: 0, lw: 1, abLo: 130, abHi: 255, gate: 0.41,
      agc: 1, en: 1, relLo: 0.125, relHi: 8, crvQ: 0.3, smQ: 0.95, pkQ: 34.5, lwQ: 1, gateQ: 0.12, abLoQ: 75, abHiQ: 195, eCol: 1, blurHi: 0.5, wdHi: 0.8, acc: 0.2, accDb: 0.3,
      op: 0.58, alpha: 1.5, sat: 1.05, ht: 2.85, wd: 1.2, xmap: 1, hot: 0.3, res: 192, asp: 1, anc: 1, cmap: 1, rx: 1, rfix: 0.9, swing: 34, ipow: 1.8, ko: 1, kb: 3,
      ease: 1, side: 1, lower: 0.7, hueTop: 14, bloom: 0.12, grain: 0.12,
    },
  },
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
  ['edge', 'Edge line', 0, 3, 0.25, 1, ' px'], ['glow', 'Glow', 0, 3, 0.05, 0.75, ''],
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

/** Drive on the Abyss background, Reef timeline. */
export const DEFAULT_LOOK: Look = applyPreset(
  { style: 'wash', blur: BLUR_DEFAULT, s: DEFAULTS, preset: null, bgPal: 'abyss', tlPal: TIMELINE_PALETTE, tl: TL_DEFAULTS },
  'drive',
)

/** The background palette; "same" follows the timeline's. */
export const bgPalette = (l: Look): Palette => PALETTES[l.bgPal === 'same' ? l.tlPal : l.bgPal]

// --- store: the lab overrides, persisted ------------------------------------

// v2: the Drive default (2026-11-04); older lab overrides were tuned on Rollers.
const KEY = 'music.look2'

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
