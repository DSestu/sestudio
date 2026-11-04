import { describe, expect, it } from 'vitest'
import type { MixSettings } from '../../../musicQueue'
import { layoutQueue, prepTrack } from '../timeline/sampling'
import { mixOf } from './analysis'
import { lockPhase } from './lock'
import { plan } from './plan'

const track = (id: string, bpm: number, dur = 240, bar0 = 0.5) => prepTrack(id, dur, { bpm, bar0 })
const SYNC: MixSettings = { mode: 'sync', bars: 8, tempo: true, swap: true, nudge: 0 }

describe('plan', () => {
  it('fades 4 s at the end when the mode is fade or a tempo is missing', () => {
    const a = track('a', 172)
    expect(plan(a, track('b', 172), { ...SYNC, mode: 'fade' })).toMatchObject({ mode: 'fade', mixOut: 236, len: 4, startOff: 0, rate: 1 })
    expect(plan(a, track('b', 0), SYNC).mode).toBe('fade')
    expect(plan(track('a', 0), track('b', 172), SYNC).mode).toBe('fade')
  })
  it('falls back to a fade when the tempos are more than 8 % apart', () => {
    expect(plan(track('a', 172), track('b', 150), SYNC)).toMatchObject({ mode: 'fade', why: 'tempo', len: 4 })
    // With tempo match off the same pair still syncs, at its own tempo.
    expect(plan(track('a', 172), track('b', 150), { ...SYNC, tempo: false })).toMatchObject({ mode: 'sync', rate: 1 })
  })
  it('syncs 8 bars from a 4-bar phrase of the outgoing track, entering on the downbeat', () => {
    const a = track('a', 172)
    const b = track('b', 174, 200, 0.3)
    const p = plan(a, b, SYNC)
    const bar = 240 / 172
    expect(p.mode).toBe('sync')
    expect(p.len).toBeCloseTo(8 * bar)
    expect(((p.mixOut - a.bar0) / (4 * bar)) % 1).toBeCloseTo(0, 6)
    // The last whole phrase that leaves room for the mix before the end.
    expect(p.mixOut + p.len).toBeLessThanOrEqual(a.dur - 0.3)
    expect(p.mixOut + 4 * bar + p.len).toBeGreaterThan(a.dur - 0.3)
    expect(p.startOff).toBeCloseTo(b.bar0)
    expect(p.rate).toBeCloseTo(172 / 174)
  })
  it('shifts where the incoming enters by the nudge, never before 0', () => {
    const a = track('a', 172)
    const b = track('b', 172, 200, 0.3)
    expect(plan(a, b, { ...SYNC, nudge: 15 }).startOff).toBeCloseTo(0.315)
    expect(plan(a, b, { ...SYNC, nudge: -500 }).startOff).toBe(0)
  })
  it('fades when the track is too short for the length', () => {
    expect(plan(track('a', 172, 20), track('b', 172), { ...SYNC, bars: 32 })).toMatchObject({ mode: 'fade', why: 'short' })
  })
})

describe('plan with structure', () => {
  const seg = (label: string, a: number, b: number) => ({ label, a, b })
  const withSegs = (t: ReturnType<typeof track>, ...segs: ReturnType<typeof seg>[]) => ({ ...t, segs })
  const bar = 240 / 172
  const phrase = (p: ReturnType<typeof plan>, t: ReturnType<typeof track>) => ((p.mixOut - t.bar0) / (4 * bar)) % 1

  it('keeps today\'s rule when the track has no structure or ends on an outro', () => {
    const a = track('a', 172)
    const plain = plan(a, track('b', 172), SYNC)
    expect(plan(withSegs(a, seg('drop', 100, 150), seg('outro', 150, 240)), track('b', 172), SYNC).mixOut).toBeCloseTo(plain.mixOut)
  })
  it('never blends over a drop: a track that ends on one is left before it, on a phrase', () => {
    const a = track('a', 172)
    const p = plan(withSegs(a, seg('breakdown', 190, 220), seg('drop', 220, 240)), track('b', 172), SYNC)
    expect(p.mode).toBe('sync')
    expect(p.mixOut + p.len).toBeLessThanOrEqual(220 + 60 / 172)
    expect(p.mixOut).toBeGreaterThanOrEqual(190 - 60 / 172)
    expect(phrase(p, a)).toBeCloseTo(0, 6)
  })
  it('plays a track almost to its end even when its only breakdown is early and drops run to the end', () => {
    const a = track('a', 172, 330)
    const plain = plan(a, track('b', 172), SYNC)
    const p = plan(withSegs(a, seg('intro', 0, 30), seg('drop', 30, 60), seg('breakdown', 60, 90), seg('drop', 90, 330)), track('b', 172), SYNC)
    expect(p.mixOut).toBeGreaterThan(330 - 60)
    expect(p.mixOut).toBeCloseTo(plain.mixOut)
  })
  it('enters the incoming track within its intro, so the blend stops before its drop', () => {
    const b = withSegs(track('b', 172), seg('intro', 0, 6), seg('drop', 6, 100))
    const p = plan(track('a', 172), b, SYNC)
    expect(p.bars).toBe(4)
    expect(p.len).toBeCloseTo(4 * bar)
    expect(p.startOff).toBeCloseTo(b.bar0)
  })
})

describe('mixOf', () => {
  it('lays the pair over the default mode', () => {
    const q = { default_mix: 'fade', mix: { 'a>b': { ...SYNC, bars: 16 } } }
    expect(mixOf(q, 'x', 'y')).toMatchObject({ mode: 'fade', bars: 8 })
    expect(mixOf(q, 'a', 'b')).toMatchObject({ mode: 'sync', bars: 16 })
  })
})

describe('layout', () => {
  it('starts each track at the previous start plus its mix point minus the entry', () => {
    const tracks = [track('a', 172), track('b', 172, 200, 0.3), track('c', 90)]
    const { TS, plans, spans } = layoutQueue(tracks, (a, b) => plan(a, b, SYNC))
    expect(plans[0].mode).toBe('sync')
    expect(plans[1].mode).toBe('fade')
    expect(TS[1]).toBeCloseTo(plans[0].mixOut - plans[0].startOff)
    expect(TS[2]).toBeCloseTo(TS[1] + plans[1].mixOut)
    expect(spans[1]).toMatchObject({ i0: plans[0].startOff, il: plans[0].len, o0: plans[1].mixOut, ol: 4 })
  })
})

describe('lockPhase', () => {
  const a = track('a', 172)
  const b = track('b', 172, 200, 0.3)
  const p = plan(a, b, SYNC)

  /** The loop of the engine's 40 ms tick: bend the rate, advance both clocks. */
  function run(errMs: number, seconds: number) {
    let out = p.mixOut
    let inc = p.startOff + errMs / 1000
    const trace: number[] = []
    for (let t = 0; t < seconds; t += 0.04) {
      const l = lockPhase(inc, out, p)
      inc += l.jump
      out += 0.04
      inc += 0.04 * l.rate
      trace.push(lockPhase(inc, out, p).errMs)
    }
    return { trace }
  }

  it('is locked on the grid and reports the error in ms', () => {
    const l = lockPhase(p.startOff, p.mixOut, p)
    expect(l.errMs).toBeCloseTo(0)
    expect(l.locked).toBe(true)
    expect(lockPhase(p.startOff + 0.02, p.mixOut, p).errMs).toBeCloseTo(20)
  })
  it('converges from 20 ms off to under 2 ms', () => {
    const { trace } = run(20, 4)
    expect(Math.abs(trace[Math.round(2 / 0.04)])).toBeLessThan(5)
    expect(Math.abs(trace[trace.length - 1])).toBeLessThan(2)
    // Locked (under 12 ms) from the first second on.
    expect(trace.slice(Math.round(1 / 0.04)).every(e => Math.abs(e) < 12)).toBe(true)
  })
  it('bends the rate by at most 3 %', () => {
    expect(lockPhase(p.startOff + 0.05, p.mixOut, p).rate).toBeCloseTo(p.rate * 0.97)
    expect(lockPhase(p.startOff - 0.05, p.mixOut, p).rate).toBeCloseTo(p.rate * 1.03)
  })
  it('jumps when more than a quarter beat off', () => {
    const beat = 60 / 172
    const l = lockPhase(p.startOff + 0.4 * beat, p.mixOut, p)
    expect(l.jump).toBeCloseTo(-0.4 * beat)
    expect(l.locked).toBe(false)
    // 0.6 beat ahead is 0.4 beat behind the next one: the shortest way is forward.
    expect(lockPhase(p.startOff + 0.6 * beat, p.mixOut, p).jump).toBeCloseTo(0.4 * beat)
  })
})
