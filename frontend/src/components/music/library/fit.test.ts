import { describe, expect, it } from 'vitest'
import { fitDist, tempoDist } from './fit'

describe('fit distance', () => {
  it('double and half time are near', () => {
    expect(tempoDist(128, 128)).toBe(0)
    expect(tempoDist(87, 174)).toBe(0)
    expect(tempoDist(174, 87)).toBe(0)
    expect(tempoDist(undefined, 120)).toBe(40)
  })
  it('the same track is at 0, a far one at 1', () => {
    const a = { bpm: 128, brightness: 0, energy: 50 }
    expect(fitDist(a, a)).toBe(0)
    expect(fitDist({ bpm: 90, brightness: 3, energy: 100 }, { bpm: 174, brightness: -3, energy: 10 })).toBe(1)
    expect(fitDist({ bpm: 128, brightness: 1, energy: 50 }, a)).toBeCloseTo(0.45 / 4, 5)
  })
})
