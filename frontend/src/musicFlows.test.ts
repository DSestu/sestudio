import { describe, expect, it } from 'vitest'
import { dialFlow, energyShape, eventDots, eventsLine, firstPath, futures, outline, type Chunk } from './musicFlows'

const chunk = (id: string, next: string[], layers: Chunk['layers'] = {}, share = 1): Chunk => ({ id, share, next, layers })
const NIGHT = {
  chunks: [
    chunk('warm-up', ['peak', 'deep'], { energy: [[0, 0.2], [1, 0.5]] }),
    chunk('peak', ['come-down'], { energy: [[0, 0.6], [1, 0.9]], harmony: [{ at: 0.5, kind: 'up' }] }, 2),
    chunk('deep', ['come-down'], { harmony: [{ at: 0.5, kind: 'mode-' }] }, 2),
    chunk('come-down', [], { energy: [[0, 0.6], [1, 0.1]], harmony: [{ at: 0, kind: 'break' }] }),
  ],
}

describe('flow cards', () => {
  it('follow the first path and count the futures', () => {
    expect(firstPath(NIGHT).map(c => c.id)).toEqual(['warm-up', 'peak', 'come-down'])
    expect(futures(NIGHT)).toBe(2)
    expect(futures({ chunks: [chunk('a', [])] })).toBe(1)
    expect(outline(NIGHT)).toBe('warm-up · peak or deep · come-down')
  })
  it('place the energy and the events on the whole flow', () => {
    const shape = energyShape(NIGHT)!
    expect(shape[0]).toEqual([0, 0.2])
    expect(shape[2]).toEqual([0.25, 0.6]) // peak starts a quarter in (shares 1, 2, 1)
    expect(shape.at(-1)).toEqual([1, 0.1])
    expect(eventDots(NIGHT)).toEqual([{ at: 0.5, kind: 'up' }, { at: 0.75, kind: 'break' }])
    expect(eventsLine(NIGHT)).toBe('Up a fifth, Break')
    expect(energyShape({ chunks: [chunk('a', [])] })).toBeNull()
  })
  it('the dial makes one chunk at its values', () => {
    const f = dialFlow(0.6, 172, 'endless')
    expect(f.chunks![0].layers).toEqual({ tempo: [[0, 172], [1, 172]], energy: [[0, 0.6], [1, 0.6]], harmony: [] })
    expect(f.length).toBe('endless')
  })
})
