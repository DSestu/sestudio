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

/** The server's tonic names (sharps) and its 9 scales as steps from the tonic (src/sestudio/music/modes.py). */
const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const STEPS: Record<string, number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
}

/** A reading as the server names it ("C# Dorian"): its home pitch class, the pitch classes of its notes, and its mood word. */
export function parseReading(label: string) {
  const [tonic, ...rest] = label.split(' ')
  const mode = rest.join(' ')
  const home = TONICS.indexOf(tonic)
  const steps = STEPS[mode.toLowerCase()]
  if (home < 0 || !steps) return undefined
  return {
    tonic,
    mode,
    home,
    notes: steps.map(s => (home + s) % 12),
    word: MODES.find(m => m.name === mode.toLowerCase())?.word ?? 'Exotic',
  }
}

/** How many of the seven notes two scales share. */
export const shared = (a: readonly number[], b: readonly number[]) => a.filter(n => b.includes(n)).length
