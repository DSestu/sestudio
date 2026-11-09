import { EXOTIC, MOOD_LADDER, moodOf, type Mood } from '../../../harmony'
import type { MusicTrack } from '../../../musicLibrary'
import type { Summary } from '../../../musicMeta'

// What the Music page knows about a track beyond its tags: read once from its summary
// (SPEC-music-library §2.2, §2.4). Everything that groups, sorts or colours uses this.

export interface TrackFacts {
  /** The mood word and colour of the track's mode; the exotic modes are "Exotic". */
  mood?: Mood
  /** Lydian +3 .. Locrian -3; absent for the exotic modes and unread keys. */
  brightness?: number
  bpm?: number
  genre?: string
  /** "F minor". */
  key?: string
  camelot?: string
  /** Energy on the library's scale, 0..100. */
  energy?: number
  level?: Level
  curve?: number[]
  /** The mode by its analysis name ("Dorian") and the 7 notes of the scale. */
  mode?: string
  notes?: string[]
  /** Mean bass, mids, highs, 0..1. */
  balance?: [number, number, number]
  energyIn?: number
  energyOut?: number
}

export type Level = (typeof LEVELS)[number]
/** The energy words, a quarter of the 0..100 scale each (default decision, §2.10). */
export const LEVELS = ['Calm', 'Steady', 'Driving', 'Intense'] as const
export const levelOf = (e?: number): Level | undefined => (e == null ? undefined : LEVELS[Math.min(3, Math.floor(e / 25))])

export type Facts = (id: string) => TrackFacts

/** The mood words in ladder order, then Exotic: the natural order of a Mood grouping. */
export const MOOD_ORDER: string[] = [...MOOD_LADDER.map(m => m.word), EXOTIC.word]

export function factsOf(s: Summary | undefined, t?: MusicTrack): TrackFacts {
  if (!s) return { bpm: t?.bpm }
  const mode = s.harmony?.track?.mode
  return {
    mood: moodOf(mode),
    brightness: s.harmony?.track?.brightness ?? MOOD_LADDER.find(m => m.mode.toLowerCase() === mode?.toLowerCase())?.brightness,
    bpm: s.bpm || t?.bpm,
    genre: s.genre,
    key: s.key,
    camelot: s.camelot,
    energy: s.energyScale?.track,
    level: s.energyLevel ?? levelOf(s.energyScale?.track),
    curve: s.curve,
    mode,
    notes: s.harmony?.track?.notes,
    balance: s.balance,
    energyIn: s.energyScale?.intro,
    energyOut: s.energyScale?.outro,
  }
}

/** A facts getter over a summary getter, so views ask for one thing. */
export const factsFrom = (get: (id: string) => Summary | undefined, byId?: ReadonlyMap<string, MusicTrack>): Facts =>
  id => factsOf(get(id), byId?.get(id))

/** A track's colour: its mood by default, else a quiet grey until its key is read. */
export const UNREAD_COLOR = 'oklch(45% .02 240)'
export const moodColor = (f: TrackFacts) => f.mood?.color ?? UNREAD_COLOR
