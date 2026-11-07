import { describe, expect, it } from 'vitest'
import { CLOSE_MS, cubic, FADE_MS, OPEN_MS, Presence, settle, speed, standard } from './presence'

describe('cubic', () => {
  it('matches the CSS curve at its ends and is monotonic', () => {
    expect(standard(0)).toBe(0)
    expect(standard(1)).toBe(1)
    let last = 0
    for (let x = 0.05; x < 1; x += 0.05) {
      const y = standard(x)
      expect(y).toBeGreaterThanOrEqual(last)
      last = y
    }
    expect(cubic(0, 0, 1, 1)(0.5)).toBeCloseTo(0.5, 3)
  })
})

describe('settle', () => {
  it('opens past 30 % of the way up, closes past 30 % of the way down', () => {
    expect(settle(0.29, 0, true)).toBe(false)
    expect(settle(0.31, 0, true)).toBe(true)
    expect(settle(0.71, 0, false)).toBe(true)
    expect(settle(0.69, 0, false)).toBe(false)
  })
  it('lets a flick win over the distance', () => {
    expect(settle(0.1, -0.6, true)).toBe(true)
    expect(settle(0.9, 0.6, false)).toBe(false)
    expect(settle(0.5, 0.6, true)).toBe(false)
  })
  it('does not take a twitch for a flick', () => {
    expect(settle(0.01, -0.9, true, -10)).toBe(false)
    expect(settle(0.03, -0.9, true, -24)).toBe(true)
  })
})

describe('speed', () => {
  it('only counts the last 100 ms', () => {
    expect(speed([[0, 0], [50, 50], [400, 60]], 400)).toBe(0)
    expect(speed([[300, 0], [350, 25], [400, 50]], 400)).toBe(0.5)
  })
})

describe('Presence', () => {
  it('opens in 380 ms and closes in 300 ms', () => {
    const p = new Presence(0)
    p.go(1, 0)
    expect(p.moving(OPEN_MS - 1)).toBe(true)
    expect(p.value(OPEN_MS)).toBe(1)
    p.go(0, 1000)
    expect(p.value(1000 + CLOSE_MS)).toBe(0)
  })
  it('turns around mid-motion and scales the time to the distance left', () => {
    const p = new Presence(0)
    p.go(1, 0)
    const mid = p.value(OPEN_MS / 2)
    p.go(0, OPEN_MS / 2)
    expect(p.value(OPEN_MS / 2)).toBeCloseTo(mid, 6)
    expect(p.value(OPEN_MS / 2 + CLOSE_MS * mid)).toBe(0)
  })
  it('holds under a drag, clamped, and bumps gen once per hold', () => {
    const p = new Presence(0)
    const g = p.gen
    p.hold(1.4)
    p.hold(-1)
    expect(p.value(0)).toBe(0)
    expect(p.gen).toBe(g + 1)
    p.hold(0.4)
    p.go(1, 0, true)
    expect(p.value(0)).toBeCloseTo(0.4, 6)
    expect(p.value(OPEN_MS * 0.6)).toBe(1)
  })
  it('fades in 150 ms under reduced motion', () => {
    const p = new Presence(0)
    p.go(1, 0, false, true)
    expect(p.fade).toBe(true)
    expect(p.value(FADE_MS)).toBe(1)
  })
})
