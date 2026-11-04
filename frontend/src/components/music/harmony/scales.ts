export const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

const MAJOR = [0, 2, 4, 5, 7, 9, 11]

/** The seven modes from the brightest to the darkest; `degree` is where each starts in the major scale. */
export const MODES = [
  { name: 'lydian', degree: 3, word: 'Floating' },
  { name: 'ionian', degree: 0, word: 'Bright' },
  { name: 'mixolydian', degree: 4, word: 'Warm' },
  { name: 'dorian', degree: 1, word: 'Smooth' },
  { name: 'aeolian', degree: 5, word: 'Dark' },
  { name: 'phrygian', degree: 2, word: 'Menacing' },
  { name: 'locrian', degree: 6, word: 'Unstable' },
] as const
export type ModeName = (typeof MODES)[number]['name']

export const modeOf = (name: ModeName) => MODES.find(m => m.name === name)!

/** The seven pitch classes of a mode on a tonic, in scale order. */
export function modeNotes(tonic: number, mode: ModeName): number[] {
  const d = MAJOR[modeOf(mode).degree]
  return MAJOR.map((_, i) => (tonic + MAJOR[(modeOf(mode).degree + i) % 7] - d + 12) % 12)
}

/** How many of the seven notes two scales share. */
export const shared = (a: readonly number[], b: readonly number[]) => a.filter(n => b.includes(n)).length
