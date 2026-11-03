import { describe, expect, it } from 'vitest'
import type { Plan } from '../timeline/sampling'
import { autoOrder, harmonic, keyDistance, rankFill, transitionChips, type SetTrack } from './setBuilder'

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
  it('walks the Camelot wheel from the slowest track', () => {
    const keyed = [t('a', 128, '8A'), t('b', 126, '3B'), t('c', 127, '9A'), t('d', 129, '4B')]
    expect(autoOrder(keyed, 'harmonic')).toEqual(['b', 'd', 'a', 'c'])
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

describe('rankFill', () => {
  const pool = [t('a', 172, '8A', 0, 'Drum & Bass'), t('b', 170, '9A', 0, 'Drum & Bass'), t('c', 128, '8A', 0, 'House'), t('d', 175, '2B', 0, 'drum & bass'), t('e', 174, '8A', 0, 'Drum & Bass')]
  it('keeps the genre and tempo range, skips what is in the set, best fit first', () => {
    const got = rankFill(pool, { genres: ['Drum & Bass'], bpmMin: 168, bpmMax: 176, length: 10_000, after: t('x', 172, '8A') }, new Set(['e']))
    expect(got.map(x => x.id)).toEqual(['a', 'b', 'd'])
  })
  it('stops once the length is reached', () => {
    const got = rankFill(pool, { genres: [], length: 300, after: t('x', 172, '8A') }, new Set())
    expect(got).toHaveLength(2)
  })
})

describe('transitionChips', () => {
  const sync: Plan = { mode: 'sync', mixOut: 0, len: 11, startOff: 0, rate: 1, bars: 8 }
  it('says synced and harmonic', () => {
    expect(transitionChips(sync, t('a', 172, '8A'), t('b', 172, '9A'))).toEqual([
      { text: '8 bars · synced', tone: 'ok' },
      { text: '8A → 9A · harmonic', tone: 'ok' },
    ])
  })
  it('warns when the tempos are too far apart, with the suggestion', () => {
    const fade: Plan = { mode: 'fade', mixOut: 0, len: 4, startOff: 0, rate: 1, why: 'tempo' }
    const [c] = transitionChips(fade, t('a', 174), t('b', 150), 'Move to Cool down?')
    expect(c).toEqual({ text: 'fade 4 s · 174 → 150 is too far to sync. Move to Cool down?', tone: 'warn' })
  })
})
