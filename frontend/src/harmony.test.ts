import { describe, expect, it } from 'vitest'
import { EXOTIC, MOOD_LADDER, moodOf } from './harmony'

describe('mood words', () => {
  it('reads each church mode as its word, brightest to darkest', () => {
    expect(MOOD_LADDER.map(m => m.word)).toEqual(['Floating', 'Bright', 'Warm', 'Smooth', 'Dark', 'Menacing', 'Unstable'])
    expect(moodOf('Dorian')?.word).toBe('Smooth')
    expect(moodOf('lydian')?.word).toBe('Floating')
  })
  it('calls both harmonic-minor modes Exotic and has nothing for an unknown mode', () => {
    expect(moodOf('Harmonic minor')).toBe(EXOTIC)
    expect(moodOf('Phrygian dominant')).toBe(EXOTIC)
    expect(moodOf(undefined)).toBeUndefined()
    expect(moodOf('Blues')).toBeUndefined()
  })
  it('gives every word its own colour', () => {
    expect(new Set([...MOOD_LADDER, EXOTIC].map(m => m.color)).size).toBe(8)
  })
})
