import { describe, expect, it } from 'vitest'
import { scaleSemitones } from './audio'
import { modeNotes } from './scales'

describe('scaleSemitones', () => {
  it('climbs from the home note to its octave', () => {
    expect(scaleSemitones(modeNotes(0, 'ionian'), 0)).toEqual([0, 2, 4, 5, 7, 9, 11, 12])
  })
  it('starts on the home note whatever the mode', () => {
    expect(scaleSemitones(modeNotes(7, 'phrygian'), 7)).toEqual([7, 8, 10, 12, 14, 15, 17, 19])
  })
})
