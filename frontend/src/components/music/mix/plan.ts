import type { MixSettings } from '../../../musicQueue'
import { fadePlan, type Plan, type Track } from '../timeline/sampling'

/** How track a hands over to track b, SPEC-music-player §9.3. */
export function plan(a: Track, b: Track, s: MixSettings): Plan {
  const fade = fadePlan(a)
  if (s.mode !== 'sync' || !a.bpm || !b.bpm) return fade
  const r = a.bpm / b.bpm
  if (s.tempo && Math.abs(r - 1) > 0.08) return { ...fade, why: 'tempo' }
  const beat = 60 / a.bpm
  const bar = 4 * beat
  const len = s.bars * bar
  // Whole 4-bar phrases of the outgoing track that fit before the mix must end.
  const n = Math.floor((a.dur - 0.3 - len - a.bar0) / (4 * bar))
  if (n < 0) return { ...fade, why: 'short' }
  return {
    mode: 'sync',
    mixOut: a.bar0 + n * 4 * bar,
    len,
    startOff: Math.max(0, b.bar0 + s.nudge / 1000),
    rate: s.tempo ? r : 1,
    bars: s.bars,
    swap: s.swap,
    bpmA: a.bpm,
    bpmB: b.bpm,
  }
}
