import { describe, expect, it } from 'vitest'
import { dotOf, jitter, place } from './place'
import type { Summary } from '../../../musicMeta'

const sum = (tonic: string, mode: string, brightness: number | null, energy = 50): Summary => ({
  harmony: { track: { tonic, mode, notes: [], brightness } },
  energyScale: { track: energy },
})

describe('explore', () => {
  it('puts neighbours on the circle of fifths next to each other', () => {
    expect(dotOf('a', sum('C', 'Ionian', 2))!.set).toBe(0)
    expect(dotOf('b', sum('G', 'Ionian', 2))!.set).toBe(1)
    // A minor shares C major's notes.
    expect(dotOf('c', sum('A', 'Aeolian', -1))!.set).toBe(0)
  })

  it('skips tracks with no mood, no energy or an exotic mode', () => {
    expect(dotOf('a')).toBeUndefined()
    expect(dotOf('a', sum('C', 'Ionian', null))).toBeUndefined()
    expect(dotOf('a', { harmony: { track: { tonic: 'C', mode: 'Ionian', notes: [], brightness: 2 } } })).toBeUndefined()
    expect(dotOf('a', sum('C', 'Harmonic minor', null))).toBeUndefined()
  })

  it('places brighter right and more intense higher, steadily', () => {
    expect(jitter('x')).toBe(jitter('x'))
    const dark = place(dotOf('x', sum('A', 'Locrian', -3, 20))!, 'vibe', 600, 400)
    const bright = place(dotOf('x', sum('F', 'Lydian', 3, 90))!, 'vibe', 600, 400)
    expect(bright[0]).toBeGreaterThan(dark[0])
    expect(bright[1]).toBeLessThan(dark[1])
  })
})
