import type { RawAnalysis } from '../timeline/sampling'
import { tc } from './bands'
import type { Params } from './settings'

// SPEC-music-player §5.8.7: the track's energy on its beat grid, eased into an intensity that bends the knobs.

export interface Grid {
  /** Beat length, seconds. */
  bl: number
  b0: number
  bar0: number
  /** Index of the first beat (negative before beat0). */
  first: number
  /** Energy per beat, 0..1, against the track's own 10th and 85th percentiles. */
  beats: number[]
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** One energy value per beat from the analysis (loudness and bass, 10 per second); null without tempo or envelopes. */
export function grid(raw: RawAnalysis | null | undefined): Grid | null {
  const env = raw?.loudness, bands = raw?.bands
  if (!raw?.bpm || raw.bar0 == null || !env?.length || bands?.length !== 8) return null
  const bl = 60 / raw.bpm, b0 = raw.beat0 ?? raw.bar0, bar0 = raw.bar0, n = Math.min(env.length, bands[0].length)
  const at = (i: number) => (0.5 * env[i] + 0.5 * Math.max(bands[0][i], bands[1][i])) / 100
  const first = Math.floor(-b0 / bl), last = Math.ceil((n / 10 - b0) / bl)
  const beats: number[] = []
  for (let k = first; k < last; k++) {
    const s = Math.max(0, Math.round((b0 + k * bl) * 10)), e = Math.min(n, Math.round((b0 + (k + 1) * bl) * 10))
    let a = 0
    for (let i = s; i < e; i++) a += at(i)
    beats.push(e > s ? a / (e - s) : 0)
  }
  const srt = [...beats].sort((a, b) => a - b), lo = srt[Math.floor(srt.length * 0.1)], hi = srt[Math.floor(srt.length * 0.85)]
  return { bl, b0, bar0, first, beats: beats.map(x => clamp((x - lo) / Math.max(1e-6, hi - lo), 0, 1)) }
}

const beatAt = (g: Grid, t: number) => Math.floor((t - g.b0) / g.bl)
const barAt = (g: Grid, t: number) => Math.floor((t - g.bar0) / (4 * g.bl))
/** The first beat of bar b. */
const barBeat = (g: Grid, b: number) => Math.round((g.bar0 + b * 4 * g.bl - g.b0) / g.bl)
function mean(g: Grid, k: number, n: number) {
  let a = 0, c = 0
  for (let j = k; j < k + n; j++) {
    const v = g.beats[j - g.first]
    if (v !== undefined) { a += v; c++ }
  }
  return c ? a / c : 0
}

/** Energy at t, held per beat (q 1), bar (2) or 4 bars (3) so changes land on the grid; q 0 glides between beats. */
export function energyAt(g: Grid, t: number, q: number) {
  if (q === 0) {
    const x = (t - g.b0) / g.bl - 0.5, k = Math.floor(x)
    return lerp(mean(g, k, 1), mean(g, k + 1, 1), x - k)
  }
  if (q === 1) return mean(g, beatAt(g, t), 1)
  const b = barAt(g, t)
  return q === 2 ? mean(g, barBeat(g, b), 4) : mean(g, barBeat(g, Math.floor(b / 4) * 4), 16)
}

/** The intensity (I, 0..1) and the beat accent (A), stepped every frame. Without a grid, I stays at 1: the full-energy look. */
export class Energy {
  I = 1
  A = 0
  private e: number | null = null
  private held = 0
  private beat: number | null = null

  reset() {
    this.I = 1
    this.e = null
    this.beat = null
  }

  step(g: Grid | null, t: number, playing: boolean, dt: number, p: Params) {
    if (!g) {
      this.I = 1
      this.A = 0
      return
    }
    const bms = g.bl * 1000
    const e = energyAt(g, t, Math.round(p.eq))
    // Smoothed over a few beats, then a deadband so small wobbles inside a drop are ignored.
    if (this.e === null) this.e = this.held = e
    this.e += (e - this.e) * (p.esm ? tc(dt, p.esm * bms) : 1)
    if (Math.abs(this.e - this.held) > p.dead) this.held += this.e - this.held - Math.sign(this.e - this.held) * p.dead
    const target = p.efloor + (1 - p.efloor) * Math.pow(clamp(this.held, 0, 1), p.ecrv)
    const ms = (target > this.I ? p.erise : p.efall) * bms
    this.I += (target - this.I) * (ms ? tc(dt, ms) : 1)
    // The accent: on each beat of the grid, stronger on the one, decaying over a 16th note.
    const k = beatAt(g, t)
    if (this.beat !== null && k !== this.beat && playing) this.A = (k - barBeat(g, 0)) % 4 === 0 ? 1 + p.accDb : 1
    this.beat = k
    this.A *= Math.exp((-dt * 1000) / (bms / 4))
  }
}

/** The knobs as the intensity bends them: each dynamics knob is its full-energy value, eased to its "when quiet" value as I drops. Follow energy 0 changes nothing. */
export function bend(p: Params, I: number, bl: number): { p: Params; blurK: number } {
  if (!p.en) return { p, blurK: 1 }
  const q = { ...p }, bms = bl * 1000, kd = p.eSh * p.en
  q.op = p.op * lerp(1, I, p.eOp * p.en)
  q.alpha = p.alpha * lerp(1, 0.4 + 0.6 * I, p.eOp * p.en)
  q.ht = p.ht * lerp(1, 0.5 + 0.5 * I, p.eHt * p.en)
  q.t1 = p.t1 * lerp(1, 0.45 + 0.55 * I, p.eCol * p.en)
  q.ch = p.ch * lerp(1, 0.55 + 0.45 * I, p.eCol * p.en)
  q.swing = p.swing * lerp(1, 0.5 + 0.5 * I, p.eCol * p.en)
  q.wd = p.wd * lerp(1, lerp(1, p.wdHi, I), p.en)
  // Geometric between the two note lengths: near full energy it is close to the short one.
  q.rel = lerp(p.rel, p.relHi * Math.pow(p.relLo / p.relHi, I) * bms, kd)
  q.att = p.att * lerp(1, lerp(1.8, 0.6, I), kd)
  for (const [k, quiet] of [['crv', 'crvQ'], ['sm', 'smQ'], ['pk', 'pkQ'], ['lw', 'lwQ'], ['gate', 'gateQ'], ['abLo', 'abLoQ'], ['abHi', 'abHiQ']] as const)
    q[k] = lerp(p[k], lerp(p[quiet], p[k], I), kd)
  return { p: q, blurK: lerp(1, lerp(1, p.blurHi, I), p.en) }
}
