import { describe, expect, it } from 'vitest'
import { joinNear } from './joins'
import { commits, swipeIntent } from './swipe'

describe('row swipe', () => {
  it('waits, then tells a sideways swipe from a scroll', () => {
    expect(swipeIntent(6, 2)).toBe('wait')
    expect(swipeIntent(14, 4)).toBe('swipe')
    expect(swipeIntent(-14, 4)).toBe('swipe')
    expect(swipeIntent(10, 12)).toBe('scroll')
  })
  it('commits past 30 % of the row', () => {
    expect(commits(100, 360)).toBe(false)
    expect(commits(108, 360)).toBe(true)
    expect(commits(-120, 360)).toBe(true)
  })
})

describe('timeline joins', () => {
  const list = [{ at: 3, x: 200 }, { at: 4, x: 420 }, { at: 5, x: 600 }]
  it('picks the nearest join within 90 px, inside the band', () => {
    expect(joinNear(list, [100, 300], 400, 200)?.at).toBe(4)
    expect(joinNear(list, [100, 300], 520, 200)?.at).toBe(5)
    expect(joinNear(list, [100, 300], 310, 200)).toBeNull()
    expect(joinNear(list, [100, 300], 420, 320)).toBeNull()
  })
})
