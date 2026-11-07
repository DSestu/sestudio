import type { Reading } from './components/music/crates/proximity'
import type { Flow } from './musicFlows'

// Suggestions ranked by the flow model (SPEC-music-flows §4.2): the join from the anchor in one word,
// its fit to what is wanted, weighted by the pull, plus tempo and energy closeness. Harmony leads the
// ranking and never hides a track. The server's sestudio.music.flows has the same rules.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }
const pc = (n: string) => NAMES.indexOf(FLATS[n] ?? n)

export const PULL: Record<Flow['pull'], number> = { light: 1, strong: 2, only: 6 }

export interface FitTrack { id: string; bpm?: number; energy?: number; reading?: Reading }

/** What the join a → b is: match, relative, up, down, mode+, mode-, shift, lift, lower or break; null when a key is unread. */
export function joinKind(a?: Reading, b?: Reading): string | null {
  if (!a?.notes?.length || !b?.notes?.length) return null
  const na = new Set(a.notes.map(pc)), nb = new Set(b.notes.map(pc))
  const shared = [...na].filter(n => nb.has(n)).length
  if (shared === 7) return a.tonic === b.tonic ? 'match' : 'relative'
  // The same scale moved up or down (any distance): a lift or a drop, never a break.
  if (shared < 6 && a.mode === b.mode && pc(a.tonic) !== pc(b.tonic)) return (pc(b.tonic) - pc(a.tonic) + 12) % 12 <= 6 ? 'lift' : 'lower'
  if (shared < 6) return 'break'
  const dropped = [...na].find(n => !nb.has(n))!, added = [...nb].find(n => !na.has(n))!
  const dir = (added - dropped + 12) % 12 === 1 ? '+' : (dropped - added + 12) % 12 === 1 ? '-' : null
  if (!dir) return 'shift'
  if (pc(a.tonic) === pc(b.tonic)) return `mode${dir}`
  return dir === '+' ? 'up' : 'down'
}

/** How well a join serves what is wanted, 0..1. */
export function fit(kind: string | null, want = 'match'): number {
  if (kind === null) return 0.4
  if (kind === want) return 1
  if (kind === 'break') return 0
  if (want === 'match') return kind === 'relative' ? 0.8 : 0.6
  if (want === 'break') return 0.2
  return kind === 'match' ? 0.5 : 0.6
}

export interface Ranked { id: string; join: string | null; fit: number; score: number; tempo: number | null; energy: number | null }

/** Every candidate, best first: pull × fit, plus closeness in tempo (±8 BPM) and energy (±0.4). */
export function rankByPull(anchor: FitTrack, pool: FitTrack[], want: string, pull: number): Ranked[] {
  return pool
    .map(t => {
      const join = joinKind(anchor.reading, t.reading)
      const f = fit(join, want)
      const tempo = anchor.bpm && t.bpm ? t.bpm - anchor.bpm : null
      const energy = anchor.energy !== undefined && t.energy !== undefined ? t.energy - anchor.energy : null
      const score = pull * f + (tempo === null ? 0.5 : 1 - Math.min(2, Math.abs(tempo) / 8)) + (energy === null ? 0.5 : 1 - Math.min(2, Math.abs(energy) / 0.4))
      return { id: t.id, join, fit: f, score, tempo, energy }
    })
    .sort((a, b) => b.score - a.score)
}
