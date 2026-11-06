import { describe, expect, it } from 'vitest'
import { addBrick, fresh, fromFlow, pullEdge, remove, split, stretches, toFlow, total, type Lanes } from './lanes'
import type { Flow } from '../../../musicFlows'

const NIGHT: Lanes = {
  energy: [{ v: 'Build', len: 20 }, { v: 'High', len: 30 }, { v: 'Peak', len: 15 }, { v: 'Ease', len: 20 }, { v: 'Calm', len: 15 }],
  genre: [{ v: 'Drum & Bass', len: 50 }, { v: 'Dubstep', len: 15 }, { v: 'Any', len: 35 }],
  colour: [{ v: 'warm', len: 20 }, { v: 'dark', len: 45 }, { v: 'Any', len: 35 }],
}

describe('lanes', () => {
  it('save as one chunk and read back the same bricks', () => {
    const f = toFlow(NIGHT)
    expect(f.length).toBe('100')
    expect(f.chunks).toHaveLength(1)
    expect(f.chunks[0].layers.harmony).toEqual([]) // joins want a key match
    expect(fromFlow(f as Flow)).toEqual({ lanes: NIGHT, lossy: false })
  })
  it('read a chunked flow along its first path, flagged as lossy', () => {
    const flow = {
      length: '60',
      chunks: [
        { id: 'a', share: 1, next: ['b', 'c'], layers: { energy: [[0, 0.3], [1, 0.9]], genre: [{ from: 0, to: 1, genres: ['Jungle'] }] } },
        { id: 'b', share: 1, next: [], layers: { energy: [[0, 0.7], [1, 0.7]], harmony: [{ at: 0.5, kind: 'up' }] } },
        { id: 'c', share: 1, next: [], layers: {} },
      ],
    } as unknown as Flow
    const { lanes, lossy } = fromFlow(flow)
    expect(lossy).toBe(true)
    expect(lanes.energy).toEqual([{ v: 'Build', len: 30 }, { v: 'High', len: 30 }])
    expect(lanes.genre).toEqual([{ v: 'Jungle', len: 30 }, { v: 'Any', len: 30 }])
    expect(lanes.colour).toEqual([{ v: 'Any', len: 60 }])
  })
  it('add grows the flow, remove and split keep it', () => {
    const added = addBrick(fresh(), 'genre', 1, 'Liquid')
    expect(total(added)).toBe(75)
    expect(added.genre).toEqual([{ v: 'Any', len: 60 }, { v: 'Liquid', len: 15 }])
    expect(added.colour[0].len).toBe(75)
    expect(split(NIGHT, 'colour', 1).colour.map(b => b.len)).toEqual([20, 25, 20, 35])
    expect(remove(NIGHT, 'energy', 2).energy.map(b => b.len)).toEqual([20, 45, 20, 15])
  })
  it('pull a border inside a lane, or the last edge to stretch every lane', () => {
    expect(pullEdge(NIGHT, 'genre', 0, 12).genre.map(b => b.len)).toEqual([60, 5, 35])
    const longer = pullEdge(NIGHT, 'energy', 4, 10)
    expect(total(longer)).toBe(110)
    expect(longer.genre[2].len).toBe(45)
    expect(total(pullEdge(NIGHT, 'colour', 2, -100))).toBe(90) // stops when energy's last brick (15 min) reaches 5
  })
  it('cut stretches wherever a lane changes', () => {
    expect(stretches(NIGHT).map(s => [s.s, s.e, s.energy, s.genre, s.colour])).toEqual([
      [0, 20, 'Build', 'Drum & Bass', 'warm'],
      [20, 50, 'High', 'Drum & Bass', 'dark'],
      [50, 65, 'Peak', 'Dubstep', 'dark'],
      [65, 85, 'Ease', 'Any', 'Any'],
      [85, 100, 'Calm', 'Any', 'Any'],
    ])
  })
})
