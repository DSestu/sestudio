import type { Summary } from '../../../musicMeta'
import { modeNotes, parseReading } from '../harmony/scales'

// Where a track sits on the Explore map (master plan E8). Vibe: mood across, energy up.
// Notes: the circle of fifths of note sets, so neighbours share 6 of 7 notes, with brightness as the radius.

export interface Dot {
  id: string
  /** Lydian +3 .. Locrian -3. */
  brightness: number
  /** Energy on the library scale, 0..100. */
  energy: number
  /** Place of the track's note set on the circle of fifths (0 = C major's notes, 1 = G, ...); undefined off the 7 church modes. */
  set?: number
  genre?: string
}

/** A track as a dot, or undefined while it has no mood or energy to place it by. */
export function dotOf(id: string, s?: Summary): Dot | undefined {
  const r = s?.harmony?.track
  const energy = s?.energyScale?.track
  if (!r || r.brightness == null || energy == null) return undefined
  const pcs = parseReading(`${r.tonic} ${r.mode}`)?.notes
  // The track's notes are those of one major scale; its tonic gives the place on the circle.
  const major = pcs && [...Array(12).keys()].find(c => modeNotes(c, 'ionian').every(n => pcs.includes(n)))
  return { id, brightness: r.brightness, energy, set: major === undefined ? undefined : (major * 7) % 12, genre: s?.genre }
}

/** A steady pseudo-random 0..1 from an id and a salt, so dots keep their place between draws. */
export function jitter(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

export const PAD = 24

/** The outer radius of the notes circle, leaving room for the note names. */
export const ringRadius = (w: number, h: number) => Math.min(w, h) / 2 - 26

/** The dot's place in a w x h map. */
export function place(d: Dot, view: 'vibe' | 'notes', w: number, h: number): [number, number] {
  const j = jitter(d.id)
  const j2 = jitter(d.id, 1)
  const b = (d.brightness + 3) / 6
  if (view === 'vibe') return [PAD + b * (w - 2 * PAD) + (j - 0.5) * 28, h - 22 - (d.energy / 100) * (h - 44) + (j2 - 0.5) * 10]
  const a = ((d.set ?? 0) / 12) * Math.PI * 2 - Math.PI / 2 + (j2 - 0.5) * 0.22
  const r = ringRadius(w, h) * (0.32 + b * 0.62) + (j - 0.5) * 8
  return [w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r]
}
