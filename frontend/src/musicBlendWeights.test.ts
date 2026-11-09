import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORTANCE, DEFAULT_WELCOME, getBlendWeights, importanceName, IMPORTANCE_PRESETS, leadOf, setImportance, shares, welcomeName, WELCOME_PRESETS } from './musicBlendWeights'

describe('blend by', () => {
  it('reads the lead axis and the preset by shares', () => {
    expect(leadOf(DEFAULT_IMPORTANCE)).toBe('Harmony first')
    expect(leadOf({ harmony: 0.5, mood: 0.5, energy: 0.5, genre: 0.5 })).toBe('Balanced')
    expect(importanceName({ harmony: 0.35, mood: 0.35, energy: 0.35, genre: 0.35 })).toBe('Balanced')
    expect(importanceName(DEFAULT_IMPORTANCE)).toBe('Custom')
    expect(IMPORTANCE_PRESETS.map(([n]) => n)).toHaveLength(10)
    expect(Object.values(shares(DEFAULT_IMPORTANCE)).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
  it('defaults are the server default welcome; 9 move presets', () => {
    expect(welcomeName(DEFAULT_WELCOME)).toBe('Default')
    expect(WELCOME_PRESETS).toHaveLength(9)
    expect(welcomeName({ ...DEFAULT_WELCOME, clash: 0.3 })).toBe('Custom')
  })
  it('keeps importances between 0.02 and 1', () => {
    setImportance({ harmony: 2, mood: 0, energy: 0.5, genre: -1 })
    expect(getBlendWeights().importance).toEqual({ harmony: 1, mood: 0.02, energy: 0.5, genre: 0.02 })
  })
})

describe('Blend by in the Blend score', () => {
  it('defaults change nothing; a light axis counts less', async () => {
    const { blend } = await import('./blend')
    const a = { id: 'a', bpm: 128, genre: 'House', energyScale: { outro: 10 } }
    const b = { id: 'b', bpm: 128, genre: 'House', energyScale: { intro: 90 } }
    const base = blend(a, b).score
    expect(blend(a, b, { weights: DEFAULT_IMPORTANCE }).score).toBeCloseTo(base, 3)
    expect(blend(a, b, { weights: { energy: 0.02 } }).score).toBeGreaterThan(base)
  })
})
