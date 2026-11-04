import { describe, expect, it } from 'vitest'
import { fish, life, Mapper, PH, PHE } from './mapping'
import { layoutQueue, meanF, Points, prepTrack, rise, RISE, sample, trackAt, weight, type DrawItem, type Track } from './sampling'

describe('mapping', () => {
  it('puts the playhead at 8 % and the horizon at the right edge, the past at the left', () => {
    const R = { x: 0, y: 0, w: 1280, h: 400 }
    const F = fish(R, 1500)
    expect(F.x(0)).toBeCloseTo(1280 * PH)
    expect(F.x(1500)).toBeCloseTo(1280 - 8)
    expect(F.x(-180)).toBeCloseTo(4)
  })

  it('inverts the fisheye (scrubbing)', () => {
    const F = fish({ x: 0, y: 0, w: 1280, h: 400 }, 1500)
    for (const s of [-170, -20, -1, 0, 3, 14, 200, 1400]) expect(F.s(F.x(s))).toBeCloseTo(s, 6)
  })

  it('is linear life size with the playhead at 13.6 %', () => {
    const L = life({ x: 128, y: 92, w: 752, h: 496 }, 70)
    expect(PHE).toBeCloseTo(0.136)
    expect(L.x(0)).toBeCloseTo(128 + 752 * 0.136)
    expect(L.x(70) - L.x(0)).toBeCloseTo(752)
  })

  it('has the spec layout numbers at 1280 x 800 and 390 x 844', () => {
    const d = new Mapper(1280, 800).at(0)
    expect([d.y0, d.amp].map(Math.round)).toEqual([642, 173])
    const e = new Mapper(1280, 800).at(1)
    expect([e.y0, e.amp].map(Math.round)).toEqual([429, 198])
    const pd = new Mapper(390, 844).at(0)
    expect([pd.y0, pd.amp].map(Math.round)).toEqual([251, 151])
    const pe = new Mapper(390, 844).at(1)
    expect([pe.y0, pe.amp].map(Math.round)).toEqual([179, 56])
  })

  it('interpolates between the two modes', () => {
    const M = new Mapper(1280, 800)
    const mid = M.at(0.5)
    expect(mid.X(10)).toBeCloseTo((M.F.x(10) + M.L.x(10)) / 2)
    expect(mid.px).toBeCloseTo((M.F.px + M.L.px) / 2)
  })
})

describe('queue layout', () => {
  const t = (id: string, dur: number) => prepTrack(id, dur)
  it('overlaps each pair by the 4 s fade', () => {
    const { TS, spans } = layoutQueue([t('a', 100), t('b', 80), t('c', 60)])
    expect(TS).toEqual([0, 96, 172])
    expect(spans[1]).toEqual({ i0: 0, il: 4, o0: 76, ol: 4 })
    expect(trackAt(TS, 100)).toBe(1)
    expect(trackAt(TS, 0)).toBe(0)
  })
  it('weights equal power through the fade', () => {
    const S = { i0: 0, il: 4, o0: 96, ol: 4 }
    expect(weight(2, S)).toBeCloseTo(Math.SQRT1_2)
    expect(weight(50, S)).toBe(1)
    expect(weight(101, S)).toBe(0)
    expect(weight(98, S) ** 2 + weight(2, { ...S, o0: 0 }) ** 2).toBeCloseTo(1)
  })
})

describe('prepTrack', () => {
  it('turns whole percents into cumulative group means', () => {
    const bands = Array.from({ length: 8 }, (_, k) => [50, 100].map(v => (k < 2 ? v : 0)))
    const tr = prepTrack('x', 0.2, { bands })
    expect(Array.from(tr.cum[0])).toEqual([0, 0.5, 1.5])
    expect(meanF(tr.cum[0], 0, 0.2)).toBeCloseTo(0.75)
    expect(meanF(tr.cum[1], 0, 0.2)).toBe(0)
  })
  it('is a flat baseline without analysis', () => {
    const tr = prepTrack('x', 120)
    expect(meanF(tr.cum[0], 0, 5)).toBe(0)
    expect(tr.bpm).toBe(0)
  })
  it('moves bar0 into the first bar', () => {
    expect(prepTrack('x', 100, { bpm: 120, bar0: 4.3 }).bar0).toBeCloseTo(0.3)
    expect(prepTrack('x', 100, { bpm: 120, bar0: 3.98 }).bar0).toBe(0)
  })
})

// A deterministic noisy track: the worst case for popping.
function noisy(id: string, dur: number, bpm: number, bar0: number, seed: number): Track {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const n = Math.round(dur * 10)
  const bands = Array.from({ length: 8 }, () => Array.from({ length: n }, () => Math.round(rnd() * 100)))
  return prepTrack(id, dur, { bpm, bar0, bands })
}

function scene() {
  const tracks = [noisy('a', 150, 174, 0.37, 1), noisy('b', 150, 128, 0.1, 2), prepTrack('c', 150)]
  const lay = layoutQueue(tracks)
  const items: DrawItem[] = tracks.map((track, i) => ({ track, span: lay.spans[i], a: 0, sc: 1, hl: i === 0 ? 1 : 0 }))
  return { tracks, lay, items }
}

describe('sampling grid', () => {
  it('has points only at 16th notes from bar0, on the 2^n grid', () => {
    const { items, lay } = scene()
    const M = new Mapper(1280, 800).at(0)
    const pts = new Points()
    for (const G of [10, 60.123, 140]) {
      items.forEach((it, i) => { it.a = lay.TS[i] - G })
      sample(items, M, pts)
      expect(pts.n).toBeGreaterThan(100)
      expect(pts.n).toBeLessThan(2500)
      for (let k = 0; k < pts.n; k++) {
        const owner = items.find(it => it.track.bpm && pts.tt[k] > it.span.i0 && pts.tt[k] < Math.min(it.track.dur, it.span.o0 + it.span.ol))
        if (!owner) continue
        const base = 15 / owner.track.bpm
        const i = (pts.tt[k] - owner.track.bar0) / base
        if (Math.abs(i - Math.round(i)) > 1e-6) continue // another track's point inside this one's span
        const dens = Math.max(1e-3, Math.abs(M.X(owner.a + pts.tt[k] + 0.25) - M.X(owner.a + pts.tt[k] - 0.25)) * 2)
        const lvl = Math.max(0, Math.floor(Math.log2(1.5 / (base * dens))))
        expect(((Math.round(i) % 2 ** lvl) + 2 ** lvl) % 2 ** lvl).toBe(0)
      }
    }
  })

  it('thins far points so none sit closer than about 1.5 px', () => {
    const { items, lay } = scene()
    const M = new Mapper(1280, 800).at(0)
    const pts = new Points()
    items.forEach((it, i) => { it.a = lay.TS[i] - 20 })
    sample(items, M, pts)
    let tight = 0
    for (let k = 1; k < pts.n; k++) if (pts.x[k] - pts.x[k - 1] < 0.75) tight++
    expect(tight).toBeLessThan(pts.n * 0.02)
  })
})

describe('no popping', () => {
  // The curve's height at fixed times of the music, frame after frame at 60 fps.
  function run(W: number, H: number, G0: number, seconds: number) {
    const { items, lay } = scene()
    const M = new Mapper(W, H).at(0)
    const pts = new Points()
    const probes = [[0, 30.05], [0, 80.4], [0, 130], [1, 20.3], [1, 60], [1, 90.7], [1, 140], [2, 30]]
    let prev: number[][] | null = null
    let worst = 0
    let peak = 0
    for (let f = 0; f <= seconds * 60; f++) {
      const G = G0 + f / 60
      items.forEach((it, i) => { it.a = lay.TS[i] - G })
      sample(items, M, pts)
      const cur = probes.map(([i, tt]) => {
        const x = M.X(items[i].a + tt)
        let k = 1
        while (k < pts.n - 1 && pts.x[k] < x) k++
        const u = (x - pts.x[k - 1]) / (pts.x[k] - pts.x[k - 1] || 1)
        return [0, 1, 2].map(g => pts.s[g][k - 1] + (pts.s[g][k] - pts.s[g][k - 1]) * u)
      })
      for (let g = 0; g < 3; g++) for (let k = 0; k < pts.n; k++) peak = Math.max(peak, pts.s[g][k])
      if (prev) for (let p = 0; p < cur.length; p++) for (let g = 0; g < 3; g++) worst = Math.max(worst, Math.abs(cur[p][g] - prev[p][g]))
      prev = cur
    }
    return worst / peak
  }

  it('moves a probe by under 2 % of the curve height per frame (desktop, across a fade)', () => {
    const r = run(1280, 800, 143, 2.5)
    console.log('desktop worst frame-to-frame change', (r * 100).toFixed(2), '%')
    expect(r).toBeLessThan(0.02)
  })
  it('does the same on a phone', () => {
    const r = run(390, 844, 60, 2.5)
    console.log('phone worst frame-to-frame change', (r * 100).toFixed(2), '%')
    expect(r).toBeLessThan(0.02)
  })
})

describe('a track being analysed', () => {
  it('knows how far its bands reach, and a finished one has no front', () => {
    const bands = Array.from({ length: 8 }, () => Array(40).fill(50))
    expect(prepTrack('a', 200, { bands, partial: true }).front).toBe(4)
    expect(prepTrack('a', 200, { partial: true }).front).toBe(0)
    expect(prepTrack('a', 4, { bands }).front).toBeUndefined()
  })

  it('rises from the horizon behind the front and shows nothing past it', () => {
    expect(rise(50)).toBe(1)
    expect(rise(50, 50)).toBe(0)
    expect(rise(60, 50)).toBe(0)
    expect(rise(50 - RISE / 2, 50)).toBeCloseTo(0.5)
    expect(rise(50 - RISE, 50)).toBe(1)
  })
})
