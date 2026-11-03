import { describe, expect, it } from 'vitest'
import { blendCurves } from './engine'
import { fmtBpm, fmtTime } from './format'

describe('blendCurves', () => {
  it('has 48 points that cross over from 1 to 0 and 0 to 1', () => {
    const { out, inn } = blendCurves()
    expect(out.length).toBe(48)
    expect([out[0], inn[0]]).toEqual([1, 0])
    expect(out[47]).toBeCloseTo(0)
    expect(inn[47]).toBeCloseTo(1)
  })
  it('keeps the power constant: out² + in² = 1 at every point', () => {
    const { out, inn } = blendCurves()
    for (let i = 0; i < 48; i++) expect(out[i] ** 2 + inn[i] ** 2).toBeCloseTo(1)
  })
  it('starts the outgoing curve from its current gain', () => {
    const { out } = blendCurves(0.5)
    expect(out[0]).toBeCloseTo(0.5)
  })
})

describe('format', () => {
  it('formats times and tempos', () => {
    expect(fmtTime(75.9)).toBe('1:15')
    expect(fmtTime(NaN)).toBe('0:00')
    expect(fmtBpm(174.02)).toBe('174')
    expect(fmtBpm(87.5)).toBe('87.5')
  })
})
