import { describe, expect, it } from 'vitest'
import { dominantGenre, factsLine, metaLine } from './musicMeta'

describe('track facts', () => {
  it('shows tempo, key and genre on one line, skipping what is missing', () => {
    expect(metaLine({ bpm: 174, camelot: '8A', genre: 'Liquid' })).toBe('174 · 8A · Liquid')
    expect(metaLine(undefined, 150)).toBe('150')
    expect(metaLine(undefined)).toBe('')
  })
  it('sums an album up as a tempo range and its commonest genre', () => {
    const list = [{ bpm: 172, genre: 'Liquid' }, { bpm: 175.2, genre: 'Liquid' }, { bpm: 174, genre: 'Neuro' }, undefined]
    expect(factsLine(list)).toBe('172–175 BPM · Liquid')
    expect(factsLine([undefined])).toBe('')
    expect(dominantGenre([{ genre: 'A' }])).toBe('A')
  })
})
