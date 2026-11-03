import { describe, expect, it } from 'vitest'
import { PALETTES } from '../timeline/palette'
import { Bands, tc } from './bands'
import { bandColour } from './color'
import { BLUR_DEFAULT, DEFAULT_LOOK, DEFAULTS, PRESETS, SPD, STYLES } from './settings'

const rollers = DEFAULT_LOOK.s

describe('bands', () => {
  it('has a frame-rate independent time constant', () => {
    // Two 1/120 s steps equal one 1/60 s step.
    const one = 1 - tc(1 / 60, 100)
    const two = (1 - tc(1 / 120, 100)) ** 2
    expect(one).toBeCloseTo(two, 10)
  })

  it('rises with the attack and falls with the release after a step at 60 fps', () => {
    const p = { ...rollers, nb: 8, lw: 0, crv: 1, gain: 1, rng: 6 }
    const b = new Bands()
    const loud = new Uint8Array(2048).fill(250)
    const quiet = new Uint8Array(2048).fill(10)
    // Learn the floor on silence, then a loud step.
    for (let i = 0; i < 120; i++) b.update(quiet, 48000, 1 / 60, p)
    expect(b.SE[0]).toBeLessThan(0.01)
    let t = 0
    while (b.SE[0] < 1 - 1 / Math.E && t < 120) {
      b.update(loud, 48000, 1 / 60, p)
      t++
    }
    // One attack time constant (30 ms) is ~2 frames; allow the auto-gain a few more.
    expect(t).toBeGreaterThanOrEqual(2)
    expect(t).toBeLessThan(10)
    for (let i = 0; i < 120; i++) b.update(loud, 48000, 1 / 60, p)
    expect(b.SE[0]).toBeGreaterThan(0.9)
    // Release: decays to 1/e of its value in rel ms (420 ms = 25 frames) once the input is gone.
    const start = b.SE[0]
    for (let i = 0; i < 25; i++) b.update(null, 48000, 1 / 60, p)
    expect(b.SE[0] / start).toBeCloseTo(Math.exp(-1), 1)
  })
})

describe('intensity colour', () => {
  const pal = PALETTES.abyss
  const flat = { ...rollers, swing: 0, lt: 0, hue: 0 }

  it('picks the palette low colour when quiet and the high colour when loud', () => {
    const lo = bandColour(0, 5, flat, pal)
    expect([lo.L, lo.hue]).toEqual([pal.lo[0], pal.lo[2]])
    const hi = bandColour(1.4, 5, flat, pal)
    expect(hi.L).toBeCloseTo(pal.hi[0])
    expect(hi.hue).toBeCloseTo(pal.hi[2])
    const mid = bandColour(0.5, 5, flat, pal)
    expect(mid.L).toBeCloseTo(pal.mi[0])
  })

  it('ignores the frequency when the colour follows intensity, and follows it otherwise', () => {
    expect(bandColour(0.3, 0, flat, pal)).toEqual(bandColour(0.3, 60, flat, pal))
    const byFreq = { ...flat, cmap: 0 }
    expect(bandColour(0.9, 0, byFreq, pal).hue).toBeCloseTo(pal.lo[2])
    expect(bandColour(0.9, 63, byFreq, pal).hue).toBeCloseTo(pal.hi[2])
  })

  it('is lighter, more saturated and more opaque when loud', () => {
    const q = bandColour(0.2, 0, rollers, pal)
    const l = bandColour(1, 0, rollers, pal)
    expect(l.L).toBeGreaterThan(q.L)
    expect(l.C).toBeGreaterThan(q.C)
    expect(l.alpha).toBeGreaterThan(q.alpha)
  })
})

describe('settings', () => {
  it('defaults to Rollers on the Abyss background', () => {
    expect(DEFAULT_LOOK.style).toBe('wash')
    expect(DEFAULT_LOOK.preset).toBe('roll')
    expect(DEFAULT_LOOK.bgPal).toBe('abyss')
    expect(rollers).toMatchObject({ nb: 64, lo: 49, hi: 18600, att: 30, rel: 420, anc: 1, ko: 0.85, kb: 3 })
    expect(DEFAULT_LOOK.blur.wash).toBe(10)
  })

  it('has the eight presets, each a known style with only known keys', () => {
    expect(PRESETS.map(p => p.id).sort()).toEqual(['ambient', 'drop', 'eq', 'liquid', 'neon', 'roll', 'smoke', 'sub'])
    const keys = new Set<string>(Object.keys(DEFAULTS))
    for (const p of PRESETS) {
      expect(STYLES).toContain(p.style)
      for (const k of Object.keys(p.s)) expect(keys.has(k)).toBe(true)
    }
    expect(new Set(PRESETS.map(p => p.style))).toEqual(new Set(STYLES))
  })

  it('has a default blur for every style and a default inside every slider range', () => {
    for (const s of STYLES) expect(BLUR_DEFAULT[s]).toBeGreaterThan(0)
    for (const d of SPD) {
      expect(d[5]).toBeGreaterThanOrEqual(d[2])
      expect(d[5]).toBeLessThanOrEqual(d[3])
    }
  })
})
