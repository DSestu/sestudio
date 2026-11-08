import { describe, expect, it } from 'vitest'
import { fit, joinKind, rankByPull } from './flowFits'
import type { Reading } from './components/music/crates/proximity'

const SCALES: Record<string, number[]> = {
  Ionian: [0, 2, 4, 5, 7, 9, 11], Dorian: [0, 2, 3, 5, 7, 9, 10], Aeolian: [0, 2, 3, 5, 7, 8, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11],
}
const N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const r = (tonic: string, mode: string): Reading => ({ tonic, mode, notes: SCALES[mode].map(d => N[(N.indexOf(tonic) + d) % 12]) })
const F = r('F', 'Aeolian')

describe('joins, as the server reads them', () => {
  it('names every kind', () => {
    expect(joinKind(F, r('F', 'Aeolian'))).toBe('match')
    expect(joinKind(F, r('G#', 'Ionian'))).toBe('relative')
    expect(joinKind(F, r('C', 'Aeolian'))).toBe('up')
    expect(joinKind(F, r('A#', 'Aeolian'))).toBe('down')
    expect(joinKind(F, r('F', 'Dorian'))).toBe('mode+')
    expect(joinKind(F, r('F', 'Phrygian'))).toBe('mode-')
    expect(joinKind(F, r('F', 'Harmonic minor'))).toBe('mode+')
    expect(joinKind(F, r('B', 'Ionian'))).toBe('break')
    expect(joinKind(F, r('F#', 'Aeolian'))).toBe('lift')  // the same scale moved, as the server
    expect(joinKind(F, r('D#', 'Aeolian'))).toBe('lower')
    expect(joinKind(F, r('B', 'Aeolian'))).toBe('lift')
    expect(joinKind(F, undefined)).toBeNull()
  })
  it('fit is a score, not a gate', () => {
    expect([fit('match'), fit('relative'), fit('up'), fit('break'), fit(null)]).toEqual([1, 0.8, 0.6, 0, 0.4])
    expect([fit('up', 'up'), fit('match', 'up'), fit('break', 'break')]).toEqual([1, 0.5, 1])
  })
})

describe('rankByPull', () => {
  const anchor = { id: 'a', bpm: 172, energy: 0.5, reading: F }
  const pool = [
    { id: 'match-far-tempo', bpm: 150, energy: 0.5, reading: r('F', 'Aeolian') },
    { id: 'up-close', bpm: 172, energy: 0.5, reading: r('C', 'Aeolian') },
    { id: 'match-close', bpm: 173, energy: 0.55, reading: r('F', 'Aeolian') },
    { id: 'break-close', bpm: 172, energy: 0.5, reading: r('B', 'Ionian') },
  ]
  it('puts the harmonic neighbour first and keeps everything', () => {
    const ranked = rankByPull(anchor, pool, 'match', 2)
    expect(ranked[0].id).toBe('match-close')
    expect(ranked).toHaveLength(4)
    expect(ranked.at(-1)!.id).not.toBe('up-close')
  })
  it('looks for the wanted modulation', () => {
    expect(rankByPull(anchor, pool, 'up', 2)[0].id).toBe('up-close')
  })
  it('the Only pull makes harmony a Must: the key wins over tempo', () => {
    const only = rankByPull(anchor, pool, 'match', 6).map(x => x.id)
    expect(only.indexOf('match-far-tempo')).toBeLessThan(only.indexOf('break-close'))
  })
})
