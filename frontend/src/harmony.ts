// The shared words and colours of the harmony features (master plan E1): the mood
// of a mode, and later the energy level and the key label at the chosen theory level.

/** A mood: the word a mode reads as, and its colour on the twilight ramp (warm gold for the bright, violet for the dark). */
export interface Mood {
  word: string
  color: string
}

/** The seven church modes from the brightest (Lydian, +3) to the darkest (Locrian, -3). */
export const MOOD_LADDER: (Mood & { mode: string; brightness: number })[] = [
  { mode: 'Lydian', brightness: 3, word: 'Floating', color: 'oklch(88% .12 95)' },
  { mode: 'Ionian', brightness: 2, word: 'Bright', color: 'oklch(83% .13 75)' },
  { mode: 'Mixolydian', brightness: 1, word: 'Warm', color: 'oklch(77% .13 45)' },
  { mode: 'Dorian', brightness: 0, word: 'Smooth', color: 'oklch(72% .13 10)' },
  { mode: 'Aeolian', brightness: -1, word: 'Dark', color: 'oklch(66% .15 340)' },
  { mode: 'Phrygian', brightness: -2, word: 'Menacing', color: 'oklch(62% .17 310)' },
  { mode: 'Locrian', brightness: -3, word: 'Unstable', color: 'oklch(56% .18 290)' },
]

/** Both harmonic-minor modes, which have no place on the ladder. */
export const EXOTIC: Mood = { word: 'Exotic', color: 'oklch(70% .14 200)' }

/** The mood of a mode by name ("Dorian"; the analysis' own spelling); undefined while a track has no mode. */
export function moodOf(mode?: string | null): Mood | undefined {
  if (!mode) return undefined
  return MOOD_LADDER.find(m => m.mode.toLowerCase() === mode.toLowerCase()) ?? (/harmonic|dominant/i.test(mode) ? EXOTIC : undefined)
}

/** The four energy levels, lowest first: the library's tracks ranked in quarters (the analysis' `energyLevel`). */
export const ENERGY_LEVELS = ['Calm', 'Steady', 'Driving', 'Intense'] as const

/** How many of the meter's four steps a level lights (1..4); 0 while a track has no level. */
export const energySteps = (level?: string | null): number => (ENERGY_LEVELS as readonly string[]).indexOf(level ?? '') + 1
