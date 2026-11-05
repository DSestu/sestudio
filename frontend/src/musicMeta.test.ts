import { describe, expect, it } from 'vitest'
import { dominantGenre, factsLine, genreColor, genreShort, metaLine, pending } from './musicMeta'

describe('pending', () => {
  it('is true until the harmony is read', () => {
    expect(pending(undefined)).toBe(true)
    expect(pending({ bpm: 120, key: 'F minor' })).toBe(true)
    expect(pending({ bpm: 120, harmony: { track: { tonic: 'F', mode: 'Aeolian', notes: [] } } })).toBe(false)
  })
})

describe('track facts', () => {
  it('shows tempo, key and genre on one line, skipping what is missing', () => {
    expect(metaLine({ bpm: 174, camelot: '8A', genre: 'Liquid' })).toBe('174 · 8A · Liquid')
    expect(metaLine({ bpm: 174, key: 'A minor', camelot: '8A' })).toBe('174 · A min (8A)')
    expect(metaLine(undefined, 150)).toBe('150')
    expect(metaLine(undefined)).toBe('')
  })
  it('shortens known genres for chips and colours each one, falling back to the name and a grey', () => {
    expect(genreShort('Drum & Bass')).toBe('DnB')
    expect(genreShort('Dubstep')).toBe('Dubstep')
    expect(genreShort('Polka')).toBe('Polka')
    expect(genreColor('Neurofunk')).toBe(genreColor('Drum & Bass'))
    expect(genreColor('Polka')).not.toBe(genreColor('Dubstep'))
    expect(metaLine({ bpm: 174, genre: 'Drum & Bass' })).toBe('174 · DnB')
  })
  it('sums an album up as a tempo range and its commonest genre', () => {
    const list = [{ bpm: 172, genre: 'Liquid' }, { bpm: 175.2, genre: 'Liquid' }, { bpm: 174, genre: 'Neuro' }, undefined]
    expect(factsLine(list)).toBe('172–175 BPM · Liquid')
    expect(factsLine([undefined])).toBe('')
    expect(dominantGenre([{ genre: 'A' }])).toBe('A')
  })
})
