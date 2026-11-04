import { describe, expect, it } from 'vitest'
import { bez } from './interact'
import { frameAt, getMode, MODE_MS, ModeMotion, pull, readMode, setMode } from './mode'
import { rects } from './timeline/mapping'

describe('ModeMotion', () => {
  it('runs 620 ms on the shared easing', () => {
    const m = new ModeMotion(0)
    m.go(1, 1000)
    expect(m.value(1000)).toBe(0)
    expect(m.value(1000 + MODE_MS / 2)).toBeCloseTo(bez(0.5), 6)
    expect(m.value(1000 + MODE_MS)).toBe(1)
    expect(m.moving(1000 + MODE_MS)).toBe(false)
  })

  it('retargets from the current progress mid-motion, without a restart', () => {
    const m = new ModeMotion(0)
    m.go(1, 0)
    const mid = m.value(200)
    expect(mid).toBeGreaterThan(0.3)
    m.go(0, 200)
    expect(m.value(200)).toBeCloseTo(mid, 9)
    expect(m.value(300)).toBeLessThan(mid)
    expect(m.value(200 + MODE_MS)).toBe(0)
  })

  it('jumps when the duration is 0, and follows a held gesture', () => {
    const m = new ModeMotion(0)
    m.ms = 0
    m.go(1, 5)
    expect(m.value(5)).toBe(1)
    m.hold(0.8)
    expect(m.value(9999)).toBe(0.8)
    m.ms = MODE_MS
    m.go(1, 10)
    expect(m.value(10)).toBeCloseTo(0.8, 9)
  })
})

describe('frameAt', () => {
  it('lands on the default layout at 0 and the stage at 1', () => {
    const W = 1280
    const H = 800
    const { e } = rects(W, H)
    const f0 = frameAt(W, H, 0)
    expect(f0.clip).toEqual({ x: 0, y: 0, w: W, h: H, r: 0 })
    expect(f0.queue).toEqual({ x: 910, y: 72, w: 350, h: 430, r: 16 })
    const f1 = frameAt(W, H, 1)
    expect(f1.clip).toEqual({ x: e.x, y: e.y, w: e.w, h: e.h, r: 12 })
    expect(f1.title).toEqual({ x: 154, y: 116, scale: 0.73 })
    expect(f1.transport.y).toBe(e.y + e.h + 14)
    expect(f1.queue).toEqual({ x: 900, y: 92, w: 360, h: 688, r: 8 })
  })

  it('interpolates halfway, and uses the phone numbers on a phone', () => {
    const half = frameAt(1280, 800, 0.5)
    expect(half.queue.x).toBe(905)
    expect(half.title.scale).toBeCloseTo(0.865, 6)
    expect(frameAt(390, 844, 1).title.scale).toBe(0.7)
  })

  it('stacks a phone on its side into a left column beside the queue, in both modes', () => {
    const W = 800
    const H = 360
    const { d, e } = rects(W, H)
    for (const t of [0, 1]) {
      const f = frameAt(W, H, t)
      const strip = t ? e : d
      expect(f.queue.y + f.queue.h).toBeLessThanOrEqual(H)
      expect(strip.x + strip.w).toBeLessThan(f.queue.x)
      expect(f.transport.x + f.transport.w).toBeLessThan(f.queue.x)
      expect(strip.y + strip.h).toBeLessThan(f.transport.y)
      expect(f.transport.y + 48).toBeLessThanOrEqual(H - 16)
    }
  })
})

describe('pull', () => {
  it('follows the finger and arms at 120 px', () => {
    expect(pull(0)).toEqual({ t: 1, bar: 36, armed: false })
    expect(pull(60).t).toBeCloseTo(1 - 0.35 * 0.75, 9)
    expect(pull(120)).toEqual({ t: 0.65, bar: 66, armed: true })
    expect(pull(500).t).toBe(0.65)
  })
})

describe('the persisted mode', () => {
  const at = (v: string | null) => ({ getItem: (k: string) => (k === 'sestudio.music.mode' ? v : null) })

  it('reads its own key and defaults to default', () => {
    expect(readMode(at(null))).toBe('default')
    expect(readMode(at('expanded'))).toBe('expanded')
    expect(readMode(at('junk'))).toBe('default')
  })

  it('setMode updates the shared state even without storage', () => {
    expect(getMode()).toBe('default')
    setMode('expanded')
    expect(getMode()).toBe('expanded')
    setMode('default')
  })
})
