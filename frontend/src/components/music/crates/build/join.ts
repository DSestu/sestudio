import type { Join } from '../proximity'

export interface Slot { id: string; join: Join | null }

export const LENGTHS = [30, 45, 60]

/** How a join reads: the key move, then only what changes (mood, energy, genre, tempo). */
export const joinText = (j: Join) =>
  [j.kindLabel, j.mood && j.mood !== 'same' ? j.mood : null, j.energy.step, j.genreChange ? 'genre change' : null, j.tempoJump ? 'tempo jump' : null]
    .filter(Boolean).join(' · ')
