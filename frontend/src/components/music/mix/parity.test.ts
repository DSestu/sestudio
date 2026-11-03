import { describe, expect, it } from 'vitest'
import type { MixSettings } from '../../../musicQueue'
import { prepTrack, type RawAnalysis, type Track } from '../timeline/sampling'
import { plan } from './plan'
// The server's port (src/sestudio/music/mixplan.py) reads the same file: the two stay identical.
import vectors from '../../../../../tests/fixtures/mixplan_vectors.json'

interface Case {
  a: { dur: number; raw: RawAnalysis }
  b: { dur: number; raw: RawAnalysis }
  settings: MixSettings
  tracks: { dur: number; bpm: number; bar0: number; segs: [string, number, number][] }[]
  plan: { mode: string; mixOut: number; len: number; startOff: number; rate: number; bars: number | null; swap: boolean | null; why: string | null }
}

const flat = (t: Track) => ({ dur: t.dur, bpm: t.bpm, bar0: t.bar0, segs: t.segs.map(g => [g.label, g.a, g.b]) })

describe('plan parity with the server', () => {
  it.each((vectors as Case[]).map((c, i) => [i, c] as const))('case %i', (_, c) => {
    const a = prepTrack('a', c.a.dur, c.a.raw)
    const b = prepTrack('b', c.b.dur, c.b.raw)
    expect([flat(a), flat(b)]).toEqual(c.tracks)
    const p = plan(a, b, c.settings)
    expect(p).toMatchObject({ mode: c.plan.mode, mixOut: c.plan.mixOut, len: c.plan.len, startOff: c.plan.startOff, rate: c.plan.rate })
    expect(p.why ?? null).toBe(c.plan.why)
    if (p.mode === 'sync') expect([p.bars, p.swap]).toEqual([c.plan.bars, c.plan.swap])
  })
})
