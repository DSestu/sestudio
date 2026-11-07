import { describe, expect, it } from 'vitest'
import { bridgePath, bridges, fitsAfter, join, type ProxTrack } from './proximity'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const STEPS: Record<string, [number[], number]> = {
  Aeolian: [[0, 2, 3, 5, 7, 8, 10], -2],
  Dorian: [[0, 2, 3, 5, 7, 9, 10], -1],
  Ionian: [[0, 2, 4, 5, 7, 9, 11], 2],
}

// Same fixtures as tests/test_music_proximity.py.
const trk = (id: string, tonic?: string, mode?: string, bpm = 174, genre = 'Drum & Bass', e = [50, 50, 50], camelot?: string): ProxTrack => ({
  id, bpm, genre, camelot,
  energyScale: { track: e[0], intro: e[1], outro: e[2] },
  harmony: tonic && mode ? { track: { tonic, mode, brightness: STEPS[mode][1], notes: STEPS[mode][0].map(s => NAMES[(NAMES.indexOf(tonic) + s) % 12]) } } : undefined,
})

describe('join', () => {
  const a = trk('a', 'A', 'Aeolian')
  it('names the move from the shared notes', () => {
    expect(join(a, trk('b', 'A', 'Aeolian')).kind).toBe('same-key')
    expect(join(a, trk('b', 'C', 'Ionian')).kind).toBe('pivot')
    const j = join(a, trk('b', 'A', 'Dorian'))
    expect([j.kind, j.shared, j.mood]).toEqual(['modal-shift', 6, 'brighter'])
    expect(join(a, trk('b', 'E', 'Aeolian')).kind).toBe('next-door')
    const c = join(a, trk('b', 'C#', 'Ionian'))
    expect([c.kind, c.safe]).toEqual(['clash', false])
  })
  it('falls back to Camelot without harmony', () => {
    const j = join(trk('a', undefined, undefined, 174, 'x', [], '8A'), trk('b', undefined, undefined, 174, 'x', [], '8B'))
    expect([j.kind, j.shared]).toEqual(['pivot', 7])
    expect(join(trk('a', undefined, undefined, 1, 'x', [], '8A'), trk('b', undefined, undefined, 1, 'x', [], '9A')).kind).toBe('next-door')
    expect(join(trk('a'), trk('b')).kind).toBeNull()
  })
  it('compares A\'s outro with B\'s intro', () => {
    expect(join(trk('a', undefined, undefined, 1, 'x', [50, 20, 80]), trk('b', undefined, undefined, 1, 'x', [50, 30, 90])).energy).toEqual({ step: 'eases off', delta: -50 })
    expect(join(trk('a', undefined, undefined, 1, 'x', [50, 0, 10]), trk('b', undefined, undefined, 1, 'x', [50, 30, 90])).energy.step).toBe('lifts')
  })
  it('allows a tempo jump only across a genre change', () => {
    const a1 = trk('a', undefined, undefined, 100)
    expect(join(a1, trk('b', undefined, undefined, 107)).tempoJump).toBe(true)
    expect(join(a1, trk('b', undefined, undefined, 107, 'Dubstep')).genreChange).toBe(true)
  })
})

describe('fitsAfter, bridges, bridgePath', () => {
  const a = trk('a', 'A', 'Aeolian')
  const pool = [
    a,
    trk('next', 'E', 'Aeolian'),
    trk('same', 'A', 'Aeolian'),
    trk('clash', 'C#', 'Ionian'),
    trk('fast', 'A', 'Aeolian', 200),
    trk('dub', 'A', 'Aeolian', 140, 'Dubstep', [90, 90, 90]),
  ]
  const ids = (f = {}) => fitsAfter(a, pool, f).map(r => r.id)
  it('ranks and filters like the server', () => {
    expect(ids()).toEqual(['same', 'dub', 'next'])
    expect(ids({ harmony: 'any' })).toContain('clash')
    expect(ids({ genre: 'Dubstep' })).toEqual(['dub'])
    expect(ids({ energy: 'lift' })).toEqual(['dub'])
  })
  it('bridges and chains', () => {
    const x = trk('x', 'A', 'Aeolian', 174, 'Drum & Bass', [10, 10, 10])
    const y = trk('y', 'D', 'Ionian', 174, 'Drum & Bass', [90, 90, 90])  // 5 notes shared, another mode: a clash
    const mid = trk('mid', 'E', 'Aeolian', 174, 'Drum & Bass', [50, 50, 50])
    expect(bridges(x, y, [x, y, mid, trk('other', 'G', 'Ionian', 174, 'Drum & Bass', [20, 20, 20])])[0].id).toBe('mid')
    expect(bridgePath(x, y, [x, y, mid])).toEqual(['mid'])
    expect(bridgePath(x, trk('c', 'A', 'Aeolian'), [mid])).toEqual([])
    expect(bridgePath(x, y, [x, y])).toBeNull()
  })
})

describe('transposition', () => {
  const a = trk('a', 'A', 'Aeolian')
  it('is the same scale moved: a good join with its distance, ranked with the 6-shared moves', () => {
    const j = join(a, trk('b', 'A#', 'Aeolian'))
    expect([j.kind, j.shared, j.safe, j.semitones, j.kindLabel]).toEqual(['transposed', 2, true, 1, 'Up 1'])
    expect(join(a, trk('b', 'G', 'Aeolian')).kindLabel).toBe('Down 2')
    expect(join(a, trk('b', 'D', 'Aeolian')).kind).toBe('next-door')
    expect(join(a, trk('b', 'A#', 'Ionian')).kind).toBe('clash')
  })
  it('falls back on Camelot: same letter, 2 to 6 steps', () => {
    const c = (x: string, y: string) => join(trk('a', undefined, undefined, 174, 'Drum & Bass', [50, 50, 50], x), trk('b', undefined, undefined, 174, 'Drum & Bass', [50, 50, 50], y))
    expect(c('8A', '3A').semitones).toBe(1)
    expect(c('8A', '10A').semitones).toBe(2)
    expect(c('8A', '3B').kind).toBe('clash')
  })
})
