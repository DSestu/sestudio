import { describe, expect, it } from 'vitest'
import type { MusicTrack } from '../../../musicLibrary'
import { factsOf } from './facts'
import { matches, parseQuery } from './searchWords'

const t = (id: string, title: string, artist = 'deadmau5'): MusicTrack => ({ id, library: 'L', libraryLabel: 'L', title, artist, album: 'Vexillology', duration: 300, folder: '' })
const S: Record<string, { bpm: number; mode: string; genre: string }> = {
  a: { bpm: 128, mode: 'Aeolian', genre: 'Progressive House' },
  b: { bpm: 174, mode: 'Lydian', genre: 'Drum & Bass' },
}
const facts = (id: string) => factsOf({ bpm: S[id].bpm, genre: S[id].genre, harmony: { track: { tonic: 'F', mode: S[id].mode, notes: [] } } })

describe('search words', () => {
  it('splits mood words and a tempo from the names', () => {
    expect(parseQuery('Dark 128 deadmau5')).toEqual({ moods: ['Dark'], bpm: 128, terms: ['deadmau5'] })
    expect(parseQuery('4x4=12 1999')).toEqual({ moods: [], terms: ['4x4=12', '1999'] })
    expect(parseQuery('  ')).toEqual({ moods: [], terms: [] })
  })
  it('matches mood, tempo within 10 and every name word, genre included', () => {
    const A = t('a', 'Strobe'), B = t('b', 'Floatation')
    expect(matches(A, facts, parseQuery('dark 120'))).toBe(true)
    expect(matches(A, facts, parseQuery('dark 140'))).toBe(false)
    expect(matches(B, facts, parseQuery('floating drum'))).toBe(true)
    expect(matches(B, facts, parseQuery('floating strobe'))).toBe(false)
    expect(matches(A, facts, parseQuery('vexil deadmau5'))).toBe(true)
  })
})
