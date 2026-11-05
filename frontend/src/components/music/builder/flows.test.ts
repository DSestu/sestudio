import { describe, expect, it } from 'vitest'
import { flowStats, inserted, type FlowRef, type Row } from './flows'

const ref = (id: string): FlowRef => ({ library: 'l', track_id: id })
const ids = (l: FlowRef[]) => l.map(r => r.track_id).join('')

describe('inserted', () => {
  it('appends by default and puts a track at a place', () => {
    expect(ids(inserted([ref('a'), ref('b')], ref('c')))).toBe('abc')
    expect(ids(inserted([ref('a'), ref('b')], ref('c'), 1))).toBe('acb')
  })
  it('moves a track already there instead of doubling it', () => {
    expect(ids(inserted([ref('a'), ref('b'), ref('c')], ref('a')))).toBe('bca')
    // Dropped at boundary 3 (after c) from index 0: the gap closes before it lands.
    expect(ids(inserted([ref('a'), ref('b'), ref('c')], ref('a'), 3))).toBe('bca')
    expect(ids(inserted([ref('a'), ref('b'), ref('c')], ref('c'), 0))).toBe('cab')
  })
})

const row = (id: string, camelot: string, bpm = 174): Row => ({
  ref: ref(id), title: id, artist: '', duration: 100, prox: { id, camelot, bpm, genre: 'x' }, missing: false,
})

describe('flowStats', () => {
  it('counts tracks, time, clashes and tempo jumps', () => {
    const s = flowStats([row('a', '8A'), row('b', '8A'), row('c', '3B', 120)])
    expect(s).toEqual({ count: 3, duration: 300, clashes: 1, tempoJumps: 1 })
  })
  it('checks the first track against the fork', () => {
    expect(flowStats([row('b', '3B')], row('a', '8A')).clashes).toBe(1)
    expect(flowStats([row('b', '3B')]).clashes).toBe(0)
  })
})
