import { describe, expect, it } from 'vitest'
import { PALETTES } from '../timeline/palette'
import { Bands, softCeil, tc } from './bands'
import { bandColour } from './color'
import { bend, Energy, energyAt, grid } from './energy'
import { applyPreset, BLUR_DEFAULT, DEFAULT_LOOK, DEFAULTS, PRESETS, SPD, STYLES } from './settings'

const rollers = applyPreset(DEFAULT_LOOK, 'roll').s
const drive = DEFAULT_LOOK.s

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
  it('defaults to Drive on the Abyss background, Rollers still a preset', () => {
    expect(DEFAULT_LOOK.style).toBe('wash')
    expect(DEFAULT_LOOK.preset).toBe('drive')
    expect(DEFAULT_LOOK.bgPal).toBe('abyss')
    expect(drive).toMatchObject({ nb: 48, xmap: 1, en: 1, agc: 1, gate: 0.41, alpha: 1.5, res: 192, asp: 1, tilt: 0 })
    expect(DEFAULT_LOOK.blur.wash).toBe(4)
    expect(rollers).toMatchObject({ nb: 64, lo: 49, hi: 18600, att: 30, rel: 420, anc: 1, ko: 0.85, kb: 3 })
  })

  it('has the nine presets, each a known style with only known keys', () => {
    expect(PRESETS.map(p => p.id).sort()).toEqual(['ambient', 'drive', 'drop', 'eq', 'liquid', 'neon', 'roll', 'smoke', 'sub'])
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

describe('auto level', () => {
  it('rounds off above the knee and never reaches past 1', () => {
    expect(softCeil(0.5, 0.75)).toBe(0.5)
    expect(softCeil(0.9, 0.75)).toBeGreaterThan(0.75)
    expect(softCeil(0.9, 0.75)).toBeLessThan(0.9)
    expect(softCeil(10, 0.75)).toBeLessThanOrEqual(1)
  })

  it('brings hot bands down and never past 1, where without it they run up to 1.5', () => {
    const p = { ...drive, en: 0, gate: 0, nb: 16 }
    const run = (agc: number) => {
      const b = new Bands()
      const fq = new Uint8Array(2048)
      let sum = 0, max = 0
      // Every band jumps between quiet and loud each 1/4 s, so the auto-gain stretches them to full.
      for (let f = 0; f < 600; f++) {
        fq.fill(Math.floor(f / 15) % 2 ? 250 : 120)
        b.update(fq, 48000, 1 / 60, { ...p, agc })
        if (f >= 300) for (const v of b.SE.subarray(0, 16)) { sum += v; max = Math.max(max, v) }
      }
      return { mean: sum / (300 * 16), max }
    }
    const off = run(0), on = run(1)
    expect(off.max).toBeGreaterThan(1.2)
    expect(on.max).toBeLessThanOrEqual(1)
    expect(on.mean).toBeLessThan(off.mean * 0.8)
  })
})

describe('energy', () => {
  // 120 BPM from 0 s: 16 quiet bars, then 16 loud ones (10 values a second).
  const n = 640
  const raw = {
    bpm: 120, beat0: 0, bar0: 0,
    loudness: Array.from({ length: n }, (_, i) => (i < 320 ? 10 : 90)),
    bands: Array.from({ length: 8 }, () => Array.from({ length: n }, (_, i) => (i < 320 ? 10 : 90))),
  }
  const g = grid(raw)!

  it('needs a tempo, a downbeat and the envelopes', () => {
    expect(grid({ ...raw, bpm: null })).toBeNull()
    expect(grid({ ...raw, loudness: undefined })).toBeNull()
  })

  it('reads low in the quiet half, high in the loud half, and holds per bar', () => {
    expect(energyAt(g, 10, 2)).toBe(0)
    expect(energyAt(g, 50, 2)).toBe(1)
    // A bar is 2 s: the same value anywhere inside it.
    expect(energyAt(g, 40.1, 2)).toBe(energyAt(g, 41.9, 2))
  })

  it('lands on the downbeat of the loud section with no rise time, and stays at full without a grid', () => {
    const p = { ...drive, esm: 0, dead: 0, erise: 0, efall: 0 }
    const e = new Energy()
    e.step(g, 30, true, 1 / 60, p)
    expect(e.I).toBeCloseTo(p.efloor)
    e.step(g, 32.01, true, 1 / 60, p)
    expect(e.I).toBeCloseTo(1)
    e.step(null, 0, true, 1 / 60, p)
    expect(e.I).toBe(1)
  })

  it('changes nothing when not followed, and gives the full-energy knobs at full intensity', () => {
    expect(bend({ ...drive, en: 0 }, 0.3, 0.5).p).toEqual({ ...drive, en: 0 })
    const full = bend(drive, 1, 0.5)
    expect(full.p.crv).toBeCloseTo(drive.crv)
    expect(full.p.gate).toBeCloseTo(drive.gate)
    expect(full.p.rel).toBeCloseTo(drive.relLo * 500)
    expect(full.blurK).toBeCloseTo(drive.blurHi)
    const quiet = bend(drive, 0, 0.5).p
    expect(quiet.crv).toBeCloseTo(drive.crvQ)
    expect(quiet.rel).toBeCloseTo(drive.relHi * 500)
  })
})
