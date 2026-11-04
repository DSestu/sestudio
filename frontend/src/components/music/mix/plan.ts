import type { MixSettings } from '../../../musicQueue'
import { fadePlan, type Plan, type Seg, type Track } from '../timeline/sampling'

/** How many 4-bar phrases from the end the mix may start: 32 bars, under a minute at club tempos. */
const TAIL = 8

const overDrop = (segs: Seg[], from: number, to: number, slack: number) =>
  segs.some(g => g.label === 'drop' && g.a < to - slack && g.b > from + slack)

/** The last outro, else the last breakdown: where a track is best left. */
const exitZone = (segs: Seg[]) => segs.findLast(g => g.label === 'outro') ?? segs.findLast(g => g.label === 'breakdown')

/** How track a hands over to track b, SPEC-music-player §9.3. */
export function plan(a: Track, b: Track, s: MixSettings): Plan {
  const fade = fadePlan(a)
  if (s.mode !== 'sync' || !a.bpm || !b.bpm) return fade
  const r = a.bpm / b.bpm
  if (s.tempo && Math.abs(r - 1) > 0.08) return { ...fade, why: 'tempo' }
  const beat = 60 / a.bpm
  const bar = 4 * beat
  const rate = s.tempo ? r : 1
  let bars = s.bars
  // The blend must not run into the incoming track's first drop: fit it in its intro.
  const intro = b.segs[0]?.label === 'intro' ? b.segs[0] : undefined
  if (intro) bars = Math.max(4, Math.min(bars, Math.floor((intro.b - intro.a) / rate / bar)))
  const len = bars * bar
  // Whole 4-bar phrases of the outgoing track that fit before the mix must end.
  const n = Math.floor((a.dur - 0.3 - len - a.bar0) / (4 * bar))
  if (n < 0) return { ...fade, why: 'short' }
  let k = n
  if (a.segs.length) {
    // Only the last TAIL phrases are candidates: dodging a drop or seeking an outro must not cut a track minutes short.
    const k0 = Math.max(0, n - TAIL + 1)
    const ks = Array.from({ length: n - k0 + 1 }, (_, i) => k0 + i).filter(i => !overDrop(a.segs, a.bar0 + i * 4 * bar, a.bar0 + i * 4 * bar + len, beat))
    const zone = exitZone(a.segs)
    k = (zone && ks.findLast(i => a.bar0 + i * 4 * bar >= zone.a - beat)) ?? ks.at(-1) ?? n
  }
  return {
    mode: 'sync',
    mixOut: a.bar0 + k * 4 * bar,
    len,
    startOff: Math.max(0, b.bar0 + s.nudge / 1000),
    rate,
    bars,
    swap: s.swap,
    bpmA: a.bpm,
    bpmB: b.bpm,
  }
}
