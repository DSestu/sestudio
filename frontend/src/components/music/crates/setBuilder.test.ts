import { describe, expect, it } from 'vitest'
import type { Plan } from '../timeline/sampling'
import { autoOrder, bestReorders, countJoins, harmonic, keyDistance, keptKey, placement, transitionChips, type SetTrack } from './setBuilder'

const t = (id: string, bpm?: number, camelot?: string, energy?: number, genre?: string, duration = 200): SetTrack => ({ id, bpm, camelot, energy, genre, duration })

describe('harmonic', () => {
  it('accepts the same key, a neighbour on the wheel and the relative major or minor', () => {
    expect(harmonic('8A', '8A')).toBe(true)
    expect(harmonic('8A', '9A')).toBe(true)
    expect(harmonic('12B', '1B')).toBe(true)
    expect(harmonic('8A', '8B')).toBe(true)
  })
  it('rejects the rest, and unknown keys', () => {
    expect(harmonic('8A', '9B')).toBe(false)
    expect(harmonic('8A', '10A')).toBe(false)
    expect(harmonic('8A', undefined)).toBe(false)
    expect(keyDistance('1A', '12A')).toBe(1)
  })
})

describe('autoOrder', () => {
  const tracks = [t('a', 174), t('b', 140), t('c'), t('d', 160)]
  it('smooths the tempo upward and leaves tracks without one last', () => {
    expect(autoOrder(tracks, 'tempo')).toEqual(['b', 'd', 'a', 'c'])
  })
  it('keeps the first track, then chains the best next join', () => {
    const keyed = [t('a', 128, '8A'), t('b', 126, '3B'), t('c', 127, '9A'), t('d', 129, '4B')]
    expect(autoOrder(keyed, 'harmonic')).toEqual(['a', 'c', 'b', 'd'])
  })
  it('rises to the peak then falls', () => {
    const e = [t('a', 0, '', 0.2), t('b', 0, '', 0.9), t('c', 0, '', 0.5), t('d', 0, '', 0.1), t('e', 0, '', 0.7)]
    const order = autoOrder(e, 'energy')
    expect(order).toHaveLength(5)
    const levels = order.map(id => e.find(x => x.id === id)!.energy!)
    const peak = levels.indexOf(0.9)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(4)
    expect(levels.slice(0, peak + 1)).toEqual([...levels.slice(0, peak + 1)].sort((x, y) => x - y))
    expect(levels.slice(peak)).toEqual([...levels.slice(peak)].sort((x, y) => y - x))
  })
})

describe('transitionChips', () => {
  const sync: Plan = { mode: 'sync', mixOut: 0, len: 11, startOff: 0, rate: 1, bars: 8 }
  it('says synced', () => {
    expect(transitionChips(sync, t('a', 172, '8A'), t('b', 172, '9A'))).toEqual([
      { text: '8 bars · synced', tone: 'ok' },
    ])
  })
  it('warns when the tempos are too far apart, with the suggestion', () => {
    const fade: Plan = { mode: 'fade', mixOut: 0, len: 4, startOff: 0, rate: 1, why: 'tempo' }
    const [c] = transitionChips(fade, t('a', 174), t('b', 150), 'Move to Cool down?')
    expect(c).toEqual({ text: 'fade 4 s · 174 → 150 is too far to sync. Move to Cool down?', tone: 'warn' })
  })
})

describe('countJoins', () => {
  it('counts clashes and tempo jumps between neighbours', () => {
    expect(countJoins([t('a', 172, '8A'), t('b', 172, '9A'), t('c', 140, '3B')])).toEqual({ clashes: 1, jumps: 1 })
  })
  it('is quiet for a smooth set', () => {
    expect(countJoins([t('a', 172, '8A'), t('b', 173, '8B')])).toEqual({ clashes: 0, jumps: 0 })
  })
})

describe('kept joins and reorders', () => {
  const set = [t('a', 172, '8A'), t('b', 172, '3B'), t('c', 172, '9A')]
  it('does not count a kept clash', () => {
    expect(countJoins(set, new Set([keptKey(set[0], set[1])])).clashes).toBe(1)
  })
  it('finds a swap and a move that leave fewer clashes, and none when nothing helps', () => {
    const { swap, move } = bestReorders(set, 0)
    expect(swap).toMatchObject({ before: 2, after: 1 })
    expect(move).toMatchObject({ from: 0, to: 2, after: 1 })
    expect(bestReorders([t('a', 172, '8A'), t('b', 172, '8A')], 0)).toEqual({})
  })
  it('places an item by part and index without itself', () => {
    const groups = [{ id: 'p1', items: ['a', 'b'] }, { id: 'p2', items: ['c', 'd'] }]
    expect(placement(groups, 'a', 0)).toEqual({ part: 'p1', index: 0 })
    expect(placement(groups, 'a', 1)).toEqual({ part: 'p1', index: 1 })
    expect(placement(groups, 'a', 3)).toEqual({ part: 'p2', index: 2 })
    expect(placement(groups, 'd', 2)).toEqual({ part: 'p1', index: 2 })
  })
})
