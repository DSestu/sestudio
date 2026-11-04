import { describe, expect, it } from 'vitest'
import { bandAt, ENV, envAt, perimeter, prep } from './barAura'

// 20 s at 10 Hz: quiet for 10 s, then loud.
const raw = { bands: Array.from({ length: 8 }, () => Array.from({ length: 200 }, (_, i) => (i < 100 ? 10 : 90))) }

describe('bar aura', () => {
  it('needs the 8 band envelopes', () => {
    expect(prep(null)).toBeNull()
    expect(prep({ bands: [[1, 2]] })).toBeNull()
  })

  it('reads each band against its own range, so the quiet half is low and the loud half high', () => {
    const p = prep(raw)!
    expect(bandAt(p, 0, 2)).toBe(0)
    expect(bandAt(p, 0, 15)).toBe(1)
    // Past the end it holds the last value.
    expect(bandAt(p, 3, 999)).toBe(1)
  })

  it('wraps the whole track into a 0..1 envelope, rising where the track gets loud', () => {
    const p = prep(raw)!
    expect(p.env).toHaveLength(ENV)
    expect(envAt(p, 0.1)).toBeLessThan(0.2)
    expect(envAt(p, 0.9)).toBeCloseTo(1, 5)
  })

  it('walks the outline in small steps and comes back to the start', () => {
    const pts = perimeter({ w: 300, h: 64, rt: 16, rb: 16 })
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThan(3.1)
    const [x, y] = pts[pts.length - 1]
    expect(Math.hypot(x - 16, y)).toBeLessThan(0.01)
  })
})
