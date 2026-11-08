import { describe, expect, it } from 'vitest'
import { join, type ProxTrack } from './crates/proximity'
import { bestGap, gapBridges, isRough, roughLabel } from './gaps'

const trk = (id: string, camelot: string, bpm = 174, genre = 'Drum & Bass'): ProxTrack => ({ id, camelot, bpm, genre })

describe('isRough', () => {
  it('flags a clash and a tempo jump inside one genre', () => {
    expect(isRough(join(trk('a', '8A'), trk('b', '8A')))).toBe(false)
    const clash = join(trk('a', '8A'), trk('b', '2B'))  // 2A would be the same scale a tritone up: no clash
    expect([isRough(clash), roughLabel(clash)]).toEqual([true, 'Clash'])
    const jump = join(trk('a', '8A', 174), trk('b', '8A', 150))
    expect([isRough(jump), roughLabel(jump)]).toEqual([true, 'Tempo jump'])
    expect(isRough(join(trk('a', '8A', 174), trk('b', '8A', 140, 'Dubstep')))).toBe(false)
  })
})

describe('gapBridges', () => {
  const a = trk('a', '8A')
  const b = trk('b', '10A')
  it('puts the strict bridges first, then fills with the rest', () => {
    const pool = [trk('far', '3B'), trk('mid', '9A'), trk('half', '9A', 140)]
    // Both of the rest are rough; Blend weighs a clash at the same tempo against a 34 BPM jump in key.
    expect(gapBridges(a, b, pool, 3).map(r => r.id)).toEqual(['mid', 'far', 'half'])
  })
  it('is never empty while the pool has tracks', () => {
    expect(gapBridges(a, b, [trk('x', '2B')]).map(r => r.id)).toEqual(['x'])
    expect(gapBridges(a, b, [trk('x', '2B')], 5, ['x'])).toEqual([])
  })
})

describe('bestGap', () => {
  it('picks the gap the track fixes', () => {
    const list = [trk('p', '8A'), trk('q', '8A'), trk('r', '9B'), trk('s', '9B')]  // 8A → 9B clashes, 9A joins both
    expect(bestGap(trk('t', '9A'), list, 0)?.at).toBe(2)
    expect(bestGap(trk('t', '9A'), list, 0)!.gain).toBeGreaterThan(0)
  })
  it('skips played gaps and stops after the span', () => {
    const list = [trk('p', '8A'), trk('q', '2A'), trk('r', '2A'), trk('s', '2A')]
    expect(bestGap(trk('t', '2A'), list, 1)?.at).toBeGreaterThan(1)
    expect(bestGap(trk('t', '8A'), list, 0, 1)?.at).toBe(1)
  })
})
