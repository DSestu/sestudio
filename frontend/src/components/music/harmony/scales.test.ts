import { describe, expect, it } from 'vitest'
import { modeNotes, shared } from './scales'

describe('modeNotes', () => {
  it('C ionian is the white keys', () => {
    expect(modeNotes(0, 'ionian')).toEqual([0, 2, 4, 5, 7, 9, 11])
  })
  it('A aeolian shares all seven notes with C ionian', () => {
    expect(shared(modeNotes(0, 'ionian'), modeNotes(9, 'aeolian'))).toBe(7)
  })
  it('G phrygian starts on G and flattens the second', () => {
    const n = modeNotes(7, 'phrygian')
    expect(n[0]).toBe(7)
    expect(n[1]).toBe(8)
  })
  it('C and G major share six notes', () => {
    expect(shared(modeNotes(0, 'ionian'), modeNotes(7, 'ionian'))).toBe(6)
  })
})
