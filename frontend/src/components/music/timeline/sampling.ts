// What the timeline draws from: the tracks' band envelopes, the queue's global
// time axis, and the one point list per band (SPEC-music-player §6.1 and §6.4,
// fixed grid only).

import type { Mapper } from './mapping'

export const FADE = 4
const PSP = 8 // pixels a sample window covers
const SMR = 2 // smoothing radius, in points

export interface RawAnalysis {
  bpm?: number | null
  /** The first beat and the first downbeat, seconds. */
  beat0?: number | null
  bar0?: number | null
  /** Loudness envelope, whole percents at 10 Hz. */
  loudness?: number[]
  /** 8 band envelopes, whole percents at 10 Hz. */
  bands?: number[][]
  /** Analysis v2: segments in bars from the first whole bar. */
  structure?: { label: string; start_bar: number; end_bar: number }[]
  energy?: number[]
  key?: string
  camelot?: string
  genre?: string
  genreConf?: number
  /** Still being analysed: `bands` are the part measured so far. */
  partial?: boolean
}

/** A structure segment (intro, buildup, drop, breakdown, outro) in the track's own seconds. */
export interface Seg {
  label: string
  a: number
  b: number
}

export interface Track {
  id: string
  dur: number
  /** 0 when the tempo is unknown. */
  bpm: number
  /** The first downbeat, seconds. */
  bar0: number
  /** Structure segments, empty when the track has none. */
  segs: Seg[]
  /** Cumulative band means per group (bass, mids, highs): cum[g][i + 1] = cum[g][i] + mean at i. */
  cum: [Float64Array, Float64Array, Float64Array]
  /** While the track is being analysed: how many seconds of it are measured so far. */
  front?: number
}

const GROUPS = [[0, 1], [2, 3, 4], [5, 6, 7]]

/** A track's envelopes as cumulative arrays; without analysis, a flat baseline. */
export function prepTrack(id: string, dur: number, raw?: RawAnalysis | null): Track {
  const bands = raw?.bands
  const ok = Array.isArray(bands) && bands.length === 8 && bands[0]?.length > 0
  const n = ok ? bands[0].length : 0
  const cum = GROUPS.map(ix => {
    const c = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (const k of ix) s += bands![k][i] / 100
      c[i + 1] = c[i] + s / ix.length
    }
    return c
  }) as Track['cum']
  const bpm = raw?.bpm && raw.bpm > 0 ? raw.bpm : 0
  const bar0 = normBar0(bpm, raw?.bar0)
  const bar = bpm ? 240 / bpm : 0
  const segs = bpm && raw?.structure ? raw.structure.map(g => ({ label: g.label, a: bar0 + g.start_bar * bar, b: bar0 + g.end_bar * bar })) : []
  return { id, dur, bpm, bar0, segs, cum, ...(raw?.partial ? { front: n / 10 } : {}) }
}

/** The first bar line, folded into the first bar (a hair before the next one counts as 0). */
export function normBar0(bpm: number, bar0?: number | null): number {
  if (!bpm) return 0
  const bar = 240 / bpm
  let b = (bar0 ?? 0) % bar
  if (b > bar - 0.06) b -= bar
  return Math.max(0, b)
}

// --- the global time axis -----------------------------------------------------------

/** How track a hands over to track b: it starts at a's `mixOut`, b enters at `startOff`. */
export interface Plan {
  mode: 'fade' | 'sync'
  mixOut: number
  len: number
  startOff: number
  rate: number
  bars?: number
  /** Beat sync only: bass swap, and the two tempos the phase lock counts beats with. */
  swap?: boolean
  bpmA?: number
  bpmB?: number
  /** Why a sync fell back to a fade. */
  why?: 'tempo' | 'short'
}

export const fadePlan = (a: Track): Plan => ({ mode: 'fade', mixOut: a.dur - FADE, len: FADE, startOff: 0, rate: 1 })

/** The audible part of a track in its own time (§6.1). */
export interface Span {
  i0: number
  il: number
  o0: number
  ol: number
}

export interface QueueLayout {
  /** Where each track starts on the global axis. */
  TS: number[]
  spans: Span[]
  /** plans[i] is the handover from track i to i + 1. */
  plans: Plan[]
}

export function layoutQueue(tracks: Track[], planOf: (a: Track, b: Track) => Plan = fadePlan): QueueLayout {
  const plans = tracks.slice(0, -1).map((a, i) => planOf(a, tracks[i + 1]))
  const TS: number[] = []
  let at = 0
  tracks.forEach((_, i) => {
    TS.push(at)
    if (plans[i]) at += plans[i].mixOut - plans[i].startOff
  })
  const spans = tracks.map((x, i): Span => {
    const pin = plans[i - 1]
    const pout = plans[i]
    return { i0: pin?.startOff ?? 0, il: pin?.len ?? FADE, o0: pout?.mixOut ?? x.dur - FADE, ol: pout?.len ?? FADE }
  })
  return { TS, spans, plans }
}

/** The last track that has started at the view position. */
export function trackAt(TS: number[], G: number): number {
  let k = 0
  for (let i = 0; i < TS.length; i++) if (TS[i] <= G) k = i
  return k
}

/** Equal-power weight of a track at a time in its own time. */
export function weight(o: number, S: Span): number {
  if (o < S.i0 || o > S.o0 + S.ol) return 0
  if (o < S.i0 + S.il) return Math.sin(((o - S.i0) / S.il) * (Math.PI / 2))
  if (o > S.o0) return Math.cos(((o - S.o0) / S.ol) * (Math.PI / 2))
  return 1
}

// --- sampling -----------------------------------------------------------------------

/** One queued track as drawn this frame. */
export interface DrawItem {
  track: Track
  span: Span
  /** Seconds from the view position to the track's start. */
  a: number
  /** Scale, 1 except while the queue morphs (§7.7). */
  sc: number
  /** Highlight, 0..1 (§6.11). */
  hl: number
  /** While analysed: the drawn front, in the track's time; nothing is drawn past it. */
  front?: number
}

/** Seconds of music behind the analysis front over which the curves rise from the horizon. */
export const RISE = 7

/** How much of a track's curve shows at time o, given the drawn analysis front. */
export function rise(o: number, front?: number): number {
  if (front === undefined) return 1
  const u = (front - o) / RISE
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u)
}

/** Mean of a band group over [a, b] of a track, from the interpolated cumulative array. */
export function meanF(c: Float64Array, a: number, b: number): number {
  const n = c.length - 1
  const at = (t: number) => {
    const u = Math.max(0, Math.min(n, t * 10))
    const i = Math.floor(u)
    return i >= n ? c[n] : c[i] + (c[i + 1] - c[i]) * (u - i)
  }
  const A = Math.max(0, Math.min(n, a * 10))
  const B = Math.max(0, Math.min(n, b * 10))
  return B - A < 1e-6 ? 0 : (at(b) - at(a)) / (B - A)
}

/** Crossfade-weighted sum of the three groups over the window [s0, s1] (screen-time). */
function cov(items: DrawItem[], s0: number, s1: number, out: Float64Array): void {
  out[0] = out[1] = out[2] = 0
  for (const j of items) {
    const o0 = Math.max(0, s0 - j.a)
    const o1 = Math.min(j.track.dur, s1 - j.a)
    if (o1 <= o0) continue
    const w = weight((o0 + o1) / 2, j.span)
    if (w === 0) continue
    const k = w * w * j.sc * rise((o0 + o1) / 2, j.front)
    const cum = j.track.cum
    out[0] += k * meanF(cum[0], o0, o1)
    out[1] += k * meanF(cum[1], o0, o1)
    out[2] += k * meanF(cum[2], o0, o1)
  }
}

/** Growable point columns: screen x, track time, the three raw values and the three smoothed ones. */
export class Points {
  n = 0
  x = new Float64Array(2048)
  tt = new Float64Array(2048)
  v: Float64Array[] = [0, 1, 2].map(() => new Float64Array(2048))
  s: Float64Array[] = [0, 1, 2].map(() => new Float64Array(2048))

  push(x: number, tt: number, a: number, b: number, c: number) {
    if (this.n === this.x.length) this.grow()
    const i = this.n++
    this.x[i] = x
    this.tt[i] = tt
    this.v[0][i] = a
    this.v[1][i] = b
    this.v[2][i] = c
  }

  private grow() {
    const g = (a: Float64Array) => {
      const b = new Float64Array(a.length * 2)
      b.set(a)
      return b
    }
    this.x = g(this.x)
    this.tt = g(this.tt)
    this.v = this.v.map(g)
    this.s = this.s.map(g)
  }

  /** Reorders by x. Only reached while tracks overlap during a queue morph. */
  private sort() {
    const idx = Array.from({ length: this.n }, (_, i) => i).sort((p, q) => this.x[p] - this.x[q])
    for (const col of [this.x, this.tt, ...this.v]) {
      const c = col.slice(0, this.n)
      idx.forEach((from, to) => { col[to] = c[from] })
    }
  }

  /** 5-tap triangular smoothing of each band into `s`. */
  smooth() {
    const { n } = this
    for (let g = 0; g < 3; g++) {
      const v = this.v[g]
      const o = this.s[g]
      for (let j = 0; j < n; j++) {
        let acc = 0
        let w = 0
        for (let d = -SMR; d <= SMR; d++) {
          const k = j + d
          if (k < 0 || k >= n) continue
          const ww = SMR + 1 - Math.abs(d)
          acc += v[k] * ww
          w += ww
        }
        o[j] = acc / w
      }
    }
  }

  finish() {
    for (let i = 1; i < this.n; i++) {
      if (this.x[i] < this.x[i - 1]) { this.sort(); break }
    }
    this.smooth()
  }
}

const acc = new Float64Array(3)
const visible: DrawItem[] = []

/** Fill `out` with the queue's points for this frame, from the items' `a` (the view position is 0). */
export function sample(items: DrawItem[], M: Mapper, out: Points): void {
  const { X, W } = M
  out.n = 0
  visible.length = 0
  for (const it of items) if (it.sc > 0.001) visible.push(it)
  // Items are already in queue order, which is also the order of their audible starts.
  for (let n = 0; n < visible.length; n++) {
    const it = visible[n]
    const { a, span: S, track } = it
    const s0 = S.i0
    const s1 = Math.min(track.dur, S.o0 + S.ol)
    const pv = visible[n - 1]
    const nx = visible[n + 1]
    const prevEnd = pv ? pv.a + Math.min(pv.track.dur, pv.span.o0 + pv.span.ol) : -1e9
    const nextStart = nx ? nx.a + nx.span.i0 : 1e9
    const lo = pv && prevEnd > a + s0 ? Math.min(s1, (a + s0 + prevEnd) / 2 - a) : s0
    const hi = nx && a + s1 > nextStart ? Math.max(lo, (nextStart + a + s1) / 2 - a) : s1
    if (X(a + hi) < -40 || X(a + lo) > W + 40) continue
    if (lo === s0) out.push(X(a + s0), s0, 0, 0, 0)

    const base = track.bpm ? 15 / track.bpm : 0.1
    const anc = track.bpm ? track.bar0 : 0
    const i0 = Math.ceil((lo - anc) / base - 1e-6)
    const i1 = Math.floor((hi - anc) / base + 1e-6)
    for (let i = i0; i <= i1; i++) {
      const tt = anc + i * base
      const x = X(a + tt)
      if (x > W + 40) break
      if (x < -40) continue
      const dens = Math.max(1e-3, Math.abs(X(a + tt + 0.25) - X(a + tt - 0.25)) * 2)
      const lvl = Math.max(0, Math.floor(Math.log2(1.5 / (base * dens))))
      // Kept on the 2^lvl grid, so a point never moves.
      if (lvl > 0 && ((i % (1 << lvl)) + (1 << lvl)) % (1 << lvl) !== 0) continue
      const wt = Math.max(base, (PSP / dens) * 1)
      cov(visible, a + tt - wt / 2, a + tt + wt / 2, acc)
      out.push(x, tt, acc[0], acc[1], acc[2])
    }
    if (hi === s1) out.push(X(a + s1), s1, 0, 0, 0)
  }
  out.finish()
}
