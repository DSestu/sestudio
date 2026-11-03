import { describe, expect, it } from 'vitest'
import {
  bez, clampView, crossed, dropIndex, fitHeight, flash, flipOffsets, glidePos, grabbed, inertiaStep, isMove,
  morphOffsets, rowDragIntent, stepHl, velocity,
} from './interact'

describe('glide', () => {
  it('eases from 0 to 1, fast at first', () => {
    expect(bez(0)).toBeCloseTo(0)
    expect(bez(1)).toBeCloseTo(1)
    expect(bez(0.2)).toBeGreaterThan(0.5)
  })

  it('ends on the target, which moves on with the clock while playing', () => {
    expect(glidePos(10, 100, 0, true)).toBeCloseTo(10)
    expect(glidePos(10, 100, 700, false)).toBeCloseTo(100)
    expect(glidePos(10, 100, 700, true)).toBeCloseTo(100.7)
  })
})

describe('scrub', () => {
  it('keeps the grabbed time under the pointer, inside the queue', () => {
    expect(grabbed(50, 70, 60, 300)).toBe(60)
    expect(grabbed(5, 0, 40, 300)).toBe(0)
    expect(grabbed(290, 0, -40, 300)).toBe(300)
    expect(clampView(-1, 300)).toBe(0)
  })

  it('measures the release velocity in seconds per ms', () => {
    expect(velocity(12, 1100, 10, 1000)).toBeCloseTo(0.02)
    expect(velocity(12, 1000, 10, 1000)).toBeCloseTo(2) // a zero interval counts as 1 ms
  })

  it('decays by .9 per 16 ms frame whatever the frame rate', () => {
    const one = inertiaStep(100, 1, 16, 1e6)
    expect(one.v).toBeCloseTo(0.9)
    expect(one.g).toBeCloseTo(101)
    let a = { g: 100, v: 1, done: false }
    for (let i = 0; i < 4; i++) a = inertiaStep(a.g, a.v, 8, 1e6)
    const b = inertiaStep(100, 1, 32, 1e6)
    expect(a.g).toBeCloseTo(b.g)
    expect(a.v).toBeCloseTo(b.v)
  })

  it('stops under .01 and at the ends', () => {
    let s = { g: 100, v: 1, done: false }
    let frames = 0
    while (!s.done && frames < 500) { s = inertiaStep(s.g, s.v, 16, 1e6); frames++ }
    expect(frames).toBe(44)
    const wall = inertiaStep(298, 5, 16, 300)
    expect(wall).toMatchObject({ g: 300, v: 0, done: true })
  })
})

describe('highlight', () => {
  it('follows a 120 ms time constant', () => {
    expect(stepHl(0, 1, 0.12)).toBeCloseTo(1 - Math.exp(-1))
    expect(stepHl(1, 0, 10)).toBeCloseTo(0, 3)
  })

  const TS = [0, 100, 200, 300]
  it('lists every track a jump crossed, either way', () => {
    expect(crossed(TS, 10, 250)).toEqual([0, 1, 2])
    expect(crossed(TS, 250, 10)).toEqual([0, 1, 2])
    expect(crossed(TS, 250, 250.5)).toEqual([])
  })

  it('lifts them to at least .75 and leaves the higher ones', () => {
    const items = [0, 0.9, 0.2, 0].map(hl => ({ hl }))
    flash(items, crossed(TS, 10, 250))
    expect(items.map(i => i.hl)).toEqual([0.75, 0.9, 0.75, 0])
  })
})

describe('row drag', () => {
  it('a mouse lifts after 5 px', () => {
    expect(rowDragIntent(false, 5, 0)).toBe('wait')
    expect(rowDragIntent(false, 5.1, 0)).toBe('lift')
  })

  it('a touch lifts after the 300 ms hold, or scrolls when it moves 8 px first', () => {
    expect(rowDragIntent(true, 3, 100)).toBe('wait')
    expect(rowDragIntent(true, 9, 100)).toBe('cancel')
    expect(rowDragIntent(true, 3, 300)).toBe('lift')
  })

  it('drops on the nearest boundary, never above the playing row (library rows: the one after)', () => {
    const mids = [10, 30, 50, 70]
    expect(dropIndex(mids, 45, 3, 0)).toBe(2)
    expect(dropIndex(mids, 99, 0, 0)).toBe(4)
    expect(dropIndex(mids, 5, 3, 1)).toBe(1)
    expect(dropIndex(mids, 5, null, 1)).toBe(2)
    expect(dropIndex(mids, 5, 1, 1)).toBe(0) // the playing row itself goes anywhere
  })

  it('never moves a row onto its own place or the next', () => {
    expect(isMove(2, 2)).toBe(false)
    expect(isMove(2, 3)).toBe(false)
    expect(isMove(2, 1)).toBe(true)
    expect(isMove(2, 4)).toBe(true)
  })
})

describe('queue animations', () => {
  it('FLIP: each row slides from where it was, the moved one from the drop', () => {
    const before = new Map([['a', 0], ['b', 40], ['c', 80]])
    const after = new Map([['b', 0], ['c', 40], ['a', 80]])
    const off = flipOffsets(before, after, 'a', 120)
    expect(off.get('a')).toBe(40) // dropped at 120, settles at 80
    expect(off.get('b')).toBe(40)
    expect(off.get('c')).toBe(40)
    expect(flipOffsets(before, before).size).toBe(0)
    expect(flipOffsets(before, after, 'a').get('a')).toBe(-80) // no drop position (SSE): from its old place
  })

  it('the timeline lags by old minus new time-to-playing', () => {
    const off = morphOffsets(new Map([['a', 0], ['b', 100]]), new Map([['a', 0], ['x', 100], ['b', 250]]))
    expect(off.get('b')).toBe(-150)
    expect(off.has('x')).toBe(false)
  })
})

describe('add panel', () => {
  it('fits its content, within 140 px and the room', () => {
    expect(fitHeight(60, 800)).toBe(140)
    expect(fitHeight(300, 800)).toBe(310)
    expect(fitHeight(900, 650)).toBe(650)
  })
})
