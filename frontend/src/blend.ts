import type { ProxTrack, Reading } from './components/music/crates/proximity'
import { fit, joinKind } from './flowFits'

// Blend (SPEC-blend §2): how well one track follows another, as one soft score. The same rules and
// numbers as src/sestudio/music/blend.py; tests/fixtures/blend.json checks both against each other.

export const LAYERS = ['energy', 'tempo', 'harmony', 'colour', 'genre'] as const
export type Layer = (typeof LAYERS)[number]
export type Setting = 'must' | 'prefer' | 'ignore'
export type Lean = 'lift' | 'hold' | 'ease'

export const WEIGHTS: Record<Layer, number> = { energy: 1.5, tempo: 1, harmony: 1.5, colour: 0.5, genre: 0.5 }
export const MUST = 3
export const LIMITS = { energy: 33, tempo: 8 }
export const SPREAD = { energy: 12, tempo: 5 }
export const LEAN: Record<Lean, { energy: number; tempo: number }> = {
  lift: { energy: 10, tempo: 1 }, hold: { energy: 0, tempo: 0 }, ease: { energy: -10, tempo: -1 },
}
export const CHANGE = 0.4

export interface BlendTrack extends ProxTrack { harmony?: { track?: Reading } }
export interface Blend {
  score: number
  parts: Record<Layer, number | null>
  steps: { energy: number | null; tempo: number | null }
  join: string | null
  blocked: boolean
}
export interface BlendOpts {
  lean?: Lean
  settings?: Partial<Record<Layer, Setting>>
  want?: string
  colour?: string | null
  genres?: string[] | null
  /** The harmony part when the caller reads joins its own way (proximity, with its Camelot fallback). */
  harmony?: number
}

const BRIGHTNESS: Record<string, number> = { Lydian: 3, Ionian: 2, Mixolydian: 1, Dorian: 0, Aeolian: -1, Phrygian: -2, Locrian: -3 }
const NAMES = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])
const EXOTIC = new Set(['Harmonic minor', 'Phrygian dominant'])

/** bright, warm, dark or exotic from the key's mode; null while the key is unread. */
export function colourOf(t: BlendTrack): string | null {
  const r = t.harmony?.track
  if (!r || !NAMES.has(r.tonic)) return null
  if (EXOTIC.has(r.mode)) return 'exotic'
  const b = BRIGHTNESS[r.mode]
  if (b === undefined) return null
  return b >= 2 ? 'bright' : b >= 0 ? 'warm' : 'dark'
}

/** The energy of a track's intro, outro or whole; the whole stands in for a missing edge. */
export const edge = (t: BlendTrack, which: 'intro' | 'outro' | 'track'): number | null =>
  t.energyScale?.[which] ?? t.energyScale?.track ?? null

const near = (step: number, best: number, spread: number) => Math.exp(-(((step - best) / spread) ** 2))

/** An energy step "holds" while the Hold part stays this high (about 8 points either way). */
export const HOLD_PART = 0.64
/** What an energy step does, from the Blend energy part: hold while Hold scores HOLD_PART or more, else lift or ease. */
export const energyLean = (delta: number): Lean => (near(delta, LEAN.hold.energy, SPREAD.energy) >= HOLD_PART ? 'hold' : delta > 0 ? 'lift' : 'ease')
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** How well `b` follows `a`: the score, each layer's part, the energy and tempo steps, the join, and whether a Must blocks it. */
export function blend(a: BlendTrack, b: BlendTrack, o: BlendOpts = {}): Blend {
  const cfg = Object.fromEntries(LAYERS.map(k => [k, o.settings?.[k] ?? 'prefer'])) as Record<Layer, Setting>
  const best = LEAN[o.lean ?? 'hold'] ?? LEAN.hold
  const parts: Record<Layer, number | null> = { energy: null, tempo: null, harmony: null, colour: null, genre: null }
  let blocked = false

  const ea = edge(a, 'outro'), eb = edge(b, 'intro')
  const de = ea == null || eb == null ? null : eb - ea
  if (de != null) {
    parts.energy = near(de, best.energy, SPREAD.energy)
    blocked ||= cfg.energy === 'must' && Math.abs(de) > LIMITS.energy
  }

  const dt = a.bpm && b.bpm ? Math.round((b.bpm - a.bpm) * 10) / 10 : null
  if (dt != null) {
    parts.tempo = near(dt, best.tempo, SPREAD.tempo)
    blocked ||= cfg.tempo === 'must' && Math.abs(dt) > LIMITS.tempo
  }

  const kind = joinKind(a.harmony?.track, b.harmony?.track)
  parts.harmony = o.harmony ?? fit(kind, o.want ?? 'match')

  const ca = colourOf(a), cb = colourOf(b)
  if (o.colour) {
    if (cb != null) {
      parts.colour = cb === o.colour ? 1 : 0
      blocked ||= cfg.colour === 'must' && cb !== o.colour
    }
  } else if (ca != null && cb != null) parts.colour = ca === cb ? 1 : CHANGE

  const ga = norm(a.genre), gb = norm(b.genre)
  if (o.genres?.length) {
    const ok = o.genres.some(g => norm(g) === gb)
    parts.genre = ok ? 1 : 0
    blocked ||= cfg.genre === 'must' && !ok
  } else if (ga && gb) parts.genre = ga === gb ? 1 : CHANGE

  let total = 0, weight = 0
  for (const k of LAYERS) {
    if (cfg[k] === 'ignore') parts[k] = null
    const p = parts[k]
    if (p == null) continue
    const w = WEIGHTS[k] * (cfg[k] === 'must' ? MUST : 1)
    total += w * p
    weight += w
  }
  return {
    score: weight ? r3(total / weight) : 0.5,
    parts: Object.fromEntries(LAYERS.map(k => [k, parts[k] == null ? null : r3(parts[k]!)])) as Record<Layer, number | null>,
    steps: { energy: de, tempo: dt },
    join: kind,
    blocked,
  }
}

/** well, fairly or roughly: the word for a score. */
export const blendWord = (s: number) => (s >= 0.75 ? 'well' : s >= 0.5 ? 'fairly' : 'roughly')
