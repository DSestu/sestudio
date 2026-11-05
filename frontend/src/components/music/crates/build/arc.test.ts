import { describe, expect, it } from 'vitest'
import { addChange, moveChange, removeBlock, resample } from './arc'

const segs = [{ g: 'Drum & Bass', x1: 0.4 }, { g: 'Dubstep', x1: 0.7 }, { g: 'Drum & Bass', x1: 1 }]

describe('resample', () => {
  it('keeps the ends and interpolates between', () => {
    expect(resample([0, 1], 3)).toEqual([0, 0.5, 1])
    expect(resample([0, 1, 0], 2)).toEqual([0, 0])
  })
})

describe('genre blocks', () => {
  it('a change bar stops short of its neighbours', () => {
    expect(moveChange(segs, 0, 0.9)[0].x1).toBeCloseTo(0.65)
    expect(moveChange(segs, 1, 0.1)[1].x1).toBeCloseTo(0.45)
  })
  it('adding a change splits the widest block', () => {
    const out = addChange(segs)
    expect(out).toHaveLength(4)
    expect(out[0].x1).toBeCloseTo(0.2)
    expect(out.at(-1)!.x1).toBe(1)
  })
  it('removing a block lets a neighbour take its place', () => {
    expect(removeBlock(segs, 1)).toEqual([segs[0], segs[2]])
    expect(removeBlock(segs, 2)).toEqual([segs[0], { g: 'Dubstep', x1: 1 }])
    expect(removeBlock([segs[2]], 0)).toEqual([segs[2]])
  })
})
