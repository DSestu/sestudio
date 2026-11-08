import { describe, expect, it } from 'vitest'
import { enoughFor, readBack, scopeBody, thenFor, type Source } from './flowSources'

const lib: Source = { kind: 'library', value: 'dm', label: 'Deadmau5', rule: 'only' }
const ph: Source = { kind: 'genre', value: 'Progressive House', rule: 'lean' }
const rat: Source = { kind: 'album', value: 'Random Album Title', rule: 'only' }

describe('flow sources', () => {
  it('reads the rules back', () => {
    expect(readBack([lib, ph])).toBe('Only the Deadmau5 library, mostly Progressive House when it fits the shape')
    expect(readBack([ph])).toBe('Your whole library, mostly Progressive House when it fits the shape')
    expect(readBack([lib, rat])).toBe('Only the Deadmau5 library, within Random Album Title')
  })
  it('stops after an album, carries on otherwise', () => {
    expect(thenFor([rat])).toBe('stop')
    expect(thenFor([lib, ph])).toBe('similar')
    expect(scopeBody([])).toEqual({})
    expect(scopeBody([lib]).sources).toEqual([{ kind: 'library', value: 'dm', rule: 'only' }])
  })
  it('says how long', () => {
    expect(enoughFor(38 * 60)).toBe('enough for 38 min')
    expect(enoughFor(22 * 3600 + 600)).toBe('enough for 22 h')
  })
})
