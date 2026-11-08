import { describe, expect, it } from 'vitest'
import cases from '../../tests/fixtures/blend.json'
import { blend, blendWord, type BlendOpts, type BlendTrack } from './blend'

// tests/test_music_blend.py reads the same cases: the server and the app give the same answer.
const CASES = cases as unknown as { name: string; a: BlendTrack; b: BlendTrack; opts: BlendOpts; expect: unknown }[]

describe('blend', () => {
  for (const c of CASES) it(c.name, () => expect(blend(c.a, c.b, c.opts)).toEqual(c.expect))

  it('names a score', () => {
    expect([0.9, 0.6, 0.3].map(blendWord)).toEqual(['well', 'fairly', 'roughly'])
  })
})
