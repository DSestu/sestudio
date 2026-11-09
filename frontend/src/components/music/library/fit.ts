import type { TrackFacts } from './facts'

// How well a track follows another, for the orbit and "Fits after it" (SPEC-music-library §2.5):
// tempo (double and half time count as near), mood brightness and energy, weighted .25 / .45 / .25.
// Not the server's Blend: a light client-side distance for 470 tracks on every focus change.

export const FIT_WEIGHTS = { tempo: 0.25, mood: 0.45, energy: 0.25 }
/** Inside this distance a track "fits next" (the orbit's inner ring). */
export const FITS_RING = 0.22
export const RINGS: [number, string][] = [[FITS_RING, 'Fits next'], [0.45, 'Close'], [0.7, 'A step away'], [1, 'Far']]

/** Beats per minute apart, the nearer of straight, double and half time; 40 when unknown. */
export const tempoDist = (a?: number, b?: number): number =>
  a && b ? Math.min(Math.abs(a - b), Math.abs(a * 2 - b), Math.abs(a / 2 - b)) : 40

/** 0 (the same) .. 1 (far). */
export function fitDist(t: TrackFacts, p: TrackFacts): number {
  const tempo = (tempoDist(t.bpm, p.bpm) / 40) * FIT_WEIGHTS.tempo
  const mood = (Math.abs((t.brightness ?? -4) - (p.brightness ?? -4)) / 4) * FIT_WEIGHTS.mood
  const energy = (Math.abs((t.energy ?? 0) - (p.energy ?? 0)) / 60) * FIT_WEIGHTS.energy
  return Math.min(1, tempo + mood + energy)
}
