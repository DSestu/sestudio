import { describe, expect, it } from 'vitest'
import { colourOf, runsOf } from './setRuns'
import type { SetTrack } from './setBuilder'

const t = (id: string, genre: string, brightness: number | null | undefined, duration = 60): SetTrack => ({
  id, genre, duration,
  harmony: brightness === undefined ? undefined : { track: { tonic: 'F', mode: 'x', notes: [], brightness } },
})

describe('colourOf', () => {
  it('reads the mode brightness as flows.py does', () => {
    expect(colourOf(t('a', 'x', 3))).toBe('bright')
    expect(colourOf(t('a', 'x', 0))).toBe('warm')
    expect(colourOf(t('a', 'x', -1))).toBe('dark')
    expect(colourOf(t('a', 'x', null))).toBe('exotic')
    expect(colourOf(t('a', 'x', undefined))).toBeUndefined()
  })
})

describe('runsOf', () => {
  const set = [t('a', 'DnB', -1), t('b', 'DnB', -1, 30), t('c', 'Dubstep', -1), t('d', 'DnB', -1)]
  it('merges back-to-back tracks with the same value', () => {
    expect(runsOf(set, x => x.genre).map(r => [r.v, r.from, r.to, r.s, r.d])).toEqual([
      ['DnB', 0, 2, 0, 90], ['Dubstep', 2, 3, 90, 60], ['DnB', 3, 4, 150, 60],
    ])
  })
  it('starts a new run at a cut even when the value matches', () => {
    const r = runsOf(set, colourOf, i => i === 2)
    expect(r.map(x => [x.from, x.to, x.cut])).toEqual([[0, 2, false], [2, 4, true]])
  })
})
