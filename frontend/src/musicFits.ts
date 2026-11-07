import { useSyncExternalStore } from 'react'
import { fitsAfter, type Filters, type Join, type Kind, type ProxTrack } from './components/music/crates/proximity'
import type { Summary } from './musicMeta'
import type { MusicTrack } from './musicLibrary'

// The track whose "Fits next" panel is open on the Music page. Any row's menu, the key card
// and the Explore dot card open it; MusicView shows the panel while it is set.

export interface FitsFilters {
  /** lift / drop: only the same scale moved up / down (transpositions). */
  harmony: 'same' | 'close' | 'lift' | 'drop' | 'any'
  mood: 'any' | 'up' | 'same' | 'down'
  energy: 'any' | 'lift' | 'hold' | 'ease'
  genre: 'same' | 'any'
  tempo: 'near' | 'any'
}

let open: string | undefined
const listeners = new Set<() => void>()
const set = (id?: string) => { open = id; listeners.forEach(l => l()) }

export const openFitsFor = (id: string) => set(id)
export const closeFits = () => set()

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export const useFitsFor = (): string | undefined => useSyncExternalStore(subscribe, () => open)

/** A track and its summary as proximity ranks them. */
export const proxOf = (t: MusicTrack, s?: Summary): ProxTrack => ({
  id: t.id, bpm: s?.bpm || t.bpm, camelot: s?.camelot, genre: s?.genre, harmony: s?.harmony, energyScale: s?.energyScale,
})

/** The pool ranked after `ref` under the chosen moves; "Same notes" is all 7 shared, "Close" 6 or more (or the same
 *  scale moved), "Lift" / "Drop" only the same scale moved up / down. */
export function rankFits(ref: ProxTrack, pool: ProxTrack[], f: FitsFilters): { id: string; join: Join }[] {
  const filters: Filters = {
    harmony: f.harmony === 'any' ? 'any' : 'safe',
    tempo: f.tempo,
    mood: f.mood === 'any' ? undefined : f.mood,
    energy: f.energy === 'any' ? undefined : f.energy,
    genre: f.genre,
  }
  const out = fitsAfter(ref, pool, filters, Infinity)
  if (f.harmony === 'lift') return out.filter(r => (r.join.semitones ?? 0) > 0)
  if (f.harmony === 'drop') return out.filter(r => (r.join.semitones ?? 0) < 0)
  return f.harmony === 'same' ? out.filter(r => r.join.shared === 7) : out
}

/** One way out per active filter, each loosening just that filter. */
export function relaxations(f: FitsFilters): { label: string; key: keyof FitsFilters; to: string }[] {
  const out: { label: string; key: keyof FitsFilters; to: string }[] = []
  if (f.harmony === 'same') out.push({ label: 'Allow close notes', key: 'harmony', to: 'close' })
  else if (f.harmony === 'close') out.push({ label: 'Any harmony', key: 'harmony', to: 'any' })
  else if (f.harmony === 'lift' || f.harmony === 'drop') out.push({ label: 'Any good move', key: 'harmony', to: 'close' })
  if (f.mood !== 'any') out.push({ label: 'Any mood', key: 'mood', to: 'any' })
  if (f.energy !== 'any') out.push({ label: 'Any energy', key: 'energy', to: 'any' })
  if (f.genre !== 'any') out.push({ label: 'Any genre', key: 'genre', to: 'any' })
  if (f.tempo !== 'any') out.push({ label: 'Any tempo', key: 'tempo', to: 'any' })
  return out
}

/** The filters in force: the user's picks over the defaults, harmony starting from the settings' rule. */
export function filtersOf(p: Partial<FitsFilters>, rule?: FitsFilters['harmony']): FitsFilters {
  return { harmony: rule ?? 'close', mood: 'any', energy: 'any', genre: 'any', tempo: 'near', ...p }
}

/** A join in plain words: smooth (all notes shared), next door (one changes), clash. */
export function plainKind(kind: Kind | null): string {
  if (kind === 'clash') return 'clash'
  if (kind === 'transposed') return 'same scale'
  if (kind === 'modal-shift' || kind === 'next-door') return 'next door'
  return kind ? 'smooth' : 'key not known'
}
