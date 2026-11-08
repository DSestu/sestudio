import { describe, expect, it } from 'vitest'
import { DEFAULT_THEORY, EXOTIC, MOOD_LADDER, keyDisplay, moodOf } from './harmony'

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

describe('key label', () => {
  const s = { key: 'G minor', camelot: '6A', harmony: { track: { tonic: 'G', mode: 'Phrygian' } } }
  it('shows the mood word and its colour in Plain and Plain with theory on tap', () => {
    expect(keyDisplay({ level: 'plain', moodWords: true }, s)).toEqual({ text: 'Menacing', color: moodOf('Phrygian')!.color })
    expect(keyDisplay({ level: 'tap', moodWords: true }, s)?.text).toBe('Menacing')
  })
  it('shows the key name in Theory, or when mood words are off', () => {
    expect(keyDisplay({ level: 'theory', moodWords: true }, s)).toEqual({ text: 'G phrygian (6A)' })
    expect(keyDisplay({ level: 'plain', moodWords: false }, s)?.text).toBe('G phrygian (6A)')
  })
  it('falls back to the old key label before the mode is known, and to nothing', () => {
    expect(keyDisplay(DEFAULT_THEORY, { key: 'F minor', camelot: '4A' })?.text).toBe('F min (4A)')
    expect(keyDisplay(DEFAULT_THEORY, {})).toBeUndefined()
    expect(keyDisplay(DEFAULT_THEORY)).toBeUndefined()
  })
})
