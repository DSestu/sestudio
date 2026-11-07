// Paints one timeline frame (SPEC-music-player §6.5 to §6.9), in WebGL. Layers back
// to front: minute grid, beat ticks, then the curves as one group (glow, bass, mids,
// highs, edge; left of the playhead at 42 %), then joins and the playhead; ticks and
// labels go on their own 2D canvas.

import { fmtTime } from '../format'
import { isPhone, isShort, Mapper } from './mapping'
import { oklch, type Palette } from './palette'
import { TV } from '../tv'
import { FADE, Points, sample, type DrawItem, type Plan } from './sampling'
import { Gl, pm, rgb, Tris, type Curves, type RGBA } from './gl'
import { wake } from '../idle'
import type { Reading } from '../crates/proximity'
import { alpha, drawJoin, moodColor, PANEL_W, VERDICT_AT, FOLD_AT, type Phase } from '../harmonyListen'
import { moodOf } from '../../../harmony'

// The blurs are made by drawing small and scaling up, not with a full-size Canvas `filter: blur`:
// as soft, at a fraction of the work (measured 19 to 48 fps on the station's software renderer).
const GQ = 0.125 // glow layer resolution
/** The glow's blur radii follow its resolution. */
const GB = 0.5
/** Shape and look numbers; the lab Look panel overwrites them (SPEC-music-player Appendix). */
export const tlook = { klo: 0.7, kmi: 0.9, khi: 0.42, alo: 0.9, ami: 0.5, ahi: 0.82, edge: 1, glow: 0.75 }

/** What the spectral background reads from the last frame: horizon, amplitude and the blurred glow layer. */
export const probe = { y0: 0, amp: 0, W: 0, H: 0, glow: null as HTMLCanvasElement | null, /** Counts the frames drawn, so the background knows when the glow changed. */ frame: 0 }
const SIGNAL = 'oklch(72% .16 230'
const WHITE = [1, 1, 1] as const
const NONE: RGBA = [0, 0, 0, 0]
/** Pixels of curve behind the analysis front that the rim light covers. */
const RIM = 46

/** The curve through the points: a cubic per gap, its handles a sixth of the neighbours' span (Catmull-Rom). */
function spline(c: Path2D, xs: Float64Array, ys: Float64Array, N: number) {
  c.lineTo(xs[0], ys[0])
  for (let j = 0; j < N - 1; j++) {
    const p = Math.max(0, j - 1)
    const q = Math.min(N - 1, j + 2)
    c.bezierCurveTo(xs[j] + (xs[j + 1] - xs[p]) / 6, ys[j] + (ys[j + 1] - ys[p]) / 6, xs[j + 1] - (xs[q] - xs[j]) / 6, ys[j + 1] - (ys[q] - ys[j]) / 6, xs[j + 1], ys[j + 1])
  }
}

/** A polyline, growable. */
class Line {
  x = new Float64Array(8192)
  y = new Float64Array(8192)
  n = 0
  push(x: number, y: number) {
    if (this.n === this.x.length) {
      const g = (a: Float64Array) => { const b = new Float64Array(a.length * 2); b.set(a); return b }
      this.x = g(this.x)
      this.y = g(this.y)
    }
    this.x[this.n] = x
    this.y[this.n++] = y
  }
}

/** The same curve as `spline`, flattened: each cubic cut into steps of about 3 px. */
function tess(out: Line, xs: Float64Array, ys: Float64Array, N: number) {
  out.n = 0
  out.push(xs[0], ys[0])
  for (let j = 0; j < N - 1; j++) {
    const p = Math.max(0, j - 1)
    const q = Math.min(N - 1, j + 2)
    const ax = xs[j], ay = ys[j], dx = xs[j + 1], dy = ys[j + 1]
    const bx = ax + (dx - xs[p]) / 6, by = ay + (dy - ys[p]) / 6
    const cx = dx - (xs[q] - ax) / 6, cy = dy - (ys[q] - ay) / 6
    const S = Math.max(1, Math.min(32, Math.ceil((Math.abs(dx - ax) + Math.abs(dy - ay)) / 3)))
    for (let k = 1; k <= S; k++) {
      const t = k / S, u = 1 - t
      const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
      out.push(w0 * ax + w1 * bx + w2 * cx + w3 * dx, w0 * ay + w1 * by + w2 * cy + w3 * dy)
    }
  }
}

/** The line's height at each device column's centre (device px) into channel `ch` of `cols`; where it
 *  folds back over a column, the point farthest from the horizon wins (the 2D fill covered them all). */
function columns(l: Line, cols: Float32Array, ch: number, Y: number, dpr: number) {
  const n = cols.length / 4
  for (let i = 0; i < l.n - 1; i++) {
    let xa = l.x[i], ya = l.y[i], xb = l.x[i + 1], yb = l.y[i + 1]
    if (xb < xa) [xa, xb, ya, yb] = [xb, xa, yb, ya]
    const c0 = Math.max(0, Math.ceil(xa * dpr - 0.5)), c1 = Math.min(n - 1, Math.ceil(xb * dpr - 0.5) - 1)
    for (let c = c0; c <= c1; c++) {
      const y = (ya + ((yb - ya) * ((c + 0.5) / dpr - xa)) / (xb - xa)) * dpr
      const j = c * 4 + ch
      if (Math.abs(y - Y) > Math.abs(cols[j] - Y)) cols[j] = y
      if (cols[c * 4 + 3] < 0) cols[c * 4 + 3] = 0
    }
  }
}

export interface LabelItem extends DrawItem {
  title: string
  /** The handover into this track. */
  plan?: Plan
  /** CSS colour of that join's kind (green flows, blue next door, amber clash); the signal blue when unknown. */
  tone?: string
  /** Seconds since this track's tempo arrived, while that plays out (count-in, dock, lock). */
  lock?: number
  /** This track's key and mode, and the outgoing track's, once known. */
  reading?: Reading
  prevReading?: Reading
  /** What the join into this track is (its kind and colour), once both keys are known. */
  verdict?: { label: string; color: string } | null
  /** The harmony step while it plays out (harmonyListen). */
  harm?: Phase | null
  /** The join's panel opened by a tap on its diamond. */
  open?: boolean
  /** Seconds since the join's panel last opened (the join came near, or a tap): its slide plays from then. */
  near?: number
}

// When a track's tempo arrives: its ticks are laid by a front (count-in), ghosts show where its
// blend's bars will land, the queue docks there, then each bar settles into blue. Seconds.
export const COUNT_IN = 1.6
export const SEEN = 1
export const DOCK = 1.1
const STAGGER = 0.05
const SETTLE = 0.22
const GLOW = 0.5
/** When the whole sequence is over. */
export const LOCK_END = COUNT_IN + SEEN + DOCK + 7 * STAGGER + GLOW
/** Ease in and out, strongly (quintic): the docking slide. */
export const quint = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2)
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

export interface Frame {
  items: LabelItem[]
  /** The view position on the global axis. */
  G: number
  /** Mode progress, 0 default, 1 expanded. */
  t: number
  /** Playhead dot level, 0..1. */
  level: number
  palette: Palette
  /** Where the queue sheet is, so labels stay clear of it. */
  avoid: { left: number; right: number; top: number; bottom: number } | null
  /** Layout index of the label under the pointer. */
  hover?: number
  /** A library row held over a join: the outgoing key, the held track's, and seconds since it got there. */
  drop?: { x: number; a: Reading; b: Reading; verdict: { label: string; color: string } | null; t: number } | null
}

export function mixLabel(p?: Plan): string {
  if (!p || p.mode !== 'sync') return `${FADE} s blend`
  const d = Math.abs(p.rate - 1) > 0.0005 ? `${p.rate > 1 ? '+' : '−'}${Math.abs((p.rate - 1) * 100).toFixed(1)} %` : 'synced'
  return `${p.bars} bars · ${d}`
}

const layer = (): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } => {
  const c = document.createElement('canvas')
  return { c, x: c.getContext('2d')! }
}

export class TimelineRenderer {
  /** Null where WebGL2 is missing: the timeline then shows its labels only. */
  private gl: Gl | null
  private tris = new Tris()
  private line = new Line()
  private cols = new Float32Array(0)
  /** The WebGL canvas covers only the curves' band: its CSS height, and the page y of its top. */
  private bandH = 0
  private oy = -1
  private g1 = layer() // curves for the glow (quarter resolution)
  private g2 = layer() // blurred glow (quarter resolution)
  private pts = new Points()
  private ys = new Float64Array(2048)
  private widths = new Map<string, number>()
  private W = 0
  private H = 0
  private dpr = 1
  private cy = 0
  private ch = 0
  M = new Mapper(1, 1)

  private canvas: HTMLCanvasElement
  /** Labels and ticks, on their own canvas at the full device density: text upscaled from the capped one blurs. */
  private text: CanvasRenderingContext2D
  private tdpr = 1

  constructor(canvas: HTMLCanvasElement, text: HTMLCanvasElement) {
    this.canvas = canvas
    this.text = text.getContext('2d')!
    let gl: Gl | null = null
    try {
      gl = new Gl(canvas, wake)
    } catch (err) {
      console.warn('The timeline needs WebGL2:', err)
    }
    this.gl = gl
  }

  /** Lowered by the caller when frames run long. */
  maxDpr = 2

  /** DPR is capped at 2, and at 1.5 on a phone. */
  resize(W: number, H: number, deviceRatio: number) {
    this.W = W
    this.H = H
    this.dpr = Math.min(deviceRatio || 1, isPhone(W) ? 1.5 : 2, this.maxDpr)
    const dw = Math.round(W * this.dpr)
    // The tallest the band gets through the switch between the modes.
    this.M = new Mapper(W, H)
    let tall = 0
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { y0, amp } = this.M.at(t)
      const by = Math.max(0, y0 - amp * 1.5)
      tall = Math.max(tall, Math.min(H, Math.min(H, y0 + amp * 1.05) + 64) - Math.max(0, by - 64))
    }
    this.M.at(0)
    this.bandH = Math.min(H, Math.ceil(tall) + 2)
    const bd = Math.round(this.bandH * this.dpr)
    this.canvas.width = dw
    this.canvas.height = bd
    this.canvas.style.height = `${this.bandH}px`
    this.oy = -1
    this.cols = new Float32Array(dw * 4)
    this.gl?.size(dw, bd, W, this.dpr)
    this.g1.c.width = this.g2.c.width = Math.ceil(W * GQ)
    this.g1.c.height = this.g2.c.height = Math.ceil(H * GQ)
    this.tdpr = Math.min(deviceRatio || 1, 3)
    this.text.canvas.width = Math.round(W * this.tdpr)
    this.text.canvas.height = Math.round(H * this.tdpr)
  }

  /** The labels drawn last frame, for hit tests: the join they open (index of the incoming item) and their box. */
  private hits: { i: number; x0: number; x1: number; ty: number; b: number }[] = []
  /** The joins' diamonds drawn last frame: a tap opens the join's notes. */
  private joinHits: { i: number; x: number; y: number }[] = []

  /** The join whose diamond is under a point (within 12 px), by the incoming item's index. */
  joinAt(x: number, y: number): number | null {
    for (const h of this.joinHits) if (Math.abs(x - h.x) <= 12 && Math.abs(y - h.y) <= 12) return h.i
    return null
  }

  /** The label under a point of the canvas, and whether it is the second line (the transition). */
  labelAt(x: number, y: number): { i: number; x0: number; ty: number; second: boolean } | null {
    for (const h of this.hits) {
      if (x >= h.x0 && x <= h.x1 && y >= h.ty - 14 && y <= h.ty + h.b) return { i: h.i, x0: h.x0, ty: h.ty, second: y > h.ty + 3 }
    }
    return null
  }

  draw(f: Frame) {
    const { W, H, M, text: t2, gl } = this
    this.hits.length = 0
    this.joinHits.length = 0
    if (!W) return
    const { X } = M.at(f.t)
    const { R, px, y0, amp } = M
    probe.y0 = y0
    probe.amp = amp
    probe.W = W
    probe.H = H
    probe.glow = this.g2.c
    probe.frame++
    const e = f.t
    const items = f.items

    // The light: the whole page (only the left column when short), narrowing to the stage when expanded.
    const { e: stage, d } = M
    const lx = stage.x * e
    const ly = stage.y * e
    const r0 = isShort(W, H) ? W - d.x - d.w : 0
    const rx = W - (r0 + (W - stage.x - stage.w - r0) * e)
    const lh = H - ly - (H - stage.y - stage.h) * e
    // Everything is drawn in the curves' band and the halo around it (see curves()): of the text canvas,
    // only that band and last frame's are cleared, with a margin.
    const c0 = Math.max(0, Math.min(y0 - amp * 1.5 - 80, this.cy - 16))
    const c1 = Math.min(H, Math.max(y0 + amp * 1.05 + 80, this.cy + this.ch + 16))
    t2.setTransform(this.tdpr, 0, 0, this.tdpr, 0, 0)
    t2.clearRect(0, c0, W, c1 - c0)
    t2.save()
    t2.beginPath()
    t2.rect(lx, ly, rx - lx, lh)
    t2.clip()

    const T = this.tris
    T.clear()
    const sig = rgb(`${SIGNAL})`)
    // Minute grid, on whole minutes of the timeline's own clock.
    {
      const gy = y0 - amp * 1.1
      const gh = amp * 2.05
      for (let m = Math.ceil((f.G - 200) / 60); m * 60 <= f.G + 1600; m++) {
        const sm = m * 60 - f.G
        const x = X(sm)
        if (x < R.x || x > R.x + R.w) continue
        const sp = Math.abs(X(sm + 60) - x)
        const a = 0.09 * Math.max(0, Math.min(1, (sp - 8) / 30)) * (x < px ? 0.6 : 1)
        if (a <= 0.003) continue
        T.vgrad(x - 1.5, gy, 3, gh, [[0, NONE], [0.5, pm(WHITE, a * 0.4)], [1, NONE]])
        T.vgrad(x - 0.5, gy, 1, gh, [[0, NONE], [0.5, pm(WHITE, a)], [1, NONE]])
      }
    }

    const under = T.n

    // Beat ticks, on the horizon over the curves, where beats are at least 5 px apart (downbeats alone
    // where tighter). A synced blend's downbeats on the incoming track are blue: they lock to the outgoing one's.
    const edge = rgb(oklch(f.palette.edge))
    items.forEach((it, i) => {
      const { track, span: S, a, plan: P, lock } = it
      if (!track.bpm) return
      const bt = 60 / track.bpm
      const lo = Math.max(S.i0, -200 - a)
      const hi = Math.min(S.o0 + S.ol, 1600 - a)
      if (hi <= lo) return
      // The count-in: a front runs from the track's start to the edge and lays the ticks behind it.
      const counting = lock !== undefined && lock < COUNT_IN
      const fx = counting ? X(a + S.i0) + (R.x + R.w + 30 - X(a + S.i0)) * (1 - (1 - lock! / COUNT_IN) ** 3) : Infinity
      if (counting) {
        T.hgrad(fx - RIM, y0 - 2, RIM, 4, [[0, NONE], [1, pm(edge, 0.3)]])
        T.hgrad(fx - RIM, y0 - 0.75, RIM, 1.5, [[0, NONE], [1, pm(edge, 0.95)]])
      }
      const sync = P?.mode === 'sync' && P.bars ? P.bars : 0
      // Seconds since bar j of the blend locked (Infinity: long locked).
      const since = (j: number) => (lock === undefined ? Infinity : lock - COUNT_IN - SEEN - DOCK - j * STAGGER)
      const near = Math.min(hi, Math.max(lo, -a))
      const n0 = Math.round((near - track.bar0) / bt)
      for (const dir of [1, -1]) {
        for (let n = dir > 0 ? n0 : n0 - 1, c = 0; c < 900; c++, n += dir) {
          const o = track.bar0 + n * bt
          if (o < lo || o > hi) break
          const isBar = ((n % 4) + 4) % 4 === 0
          const gap = Math.abs(X(a + o + bt) - X(a + o))
          if (gap < 5 && !(isBar && gap * 4 >= 6)) continue
          if (gap * 4 < 6) break
          const x = X(a + o)
          if (x < R.x || x > R.x + R.w) continue
          const k = (x < px ? 0.6 : 1) * (counting ? smooth((fx - x) / 30) : 1)
          const h = isBar ? 9 : 4
          const j = n / 4
          const s = isBar && j >= 0 && j < sync ? since(j) : -1
          if (s < 0) { T.rect(x - 0.5, y0 - h, 1, h * 2, pm(WHITE, (isBar ? 0.42 : 0.22) * k)); continue }
          // Settles into blue: wider and taller, a glow under it that fades.
          const e = smooth(s / SETTLE)
          if (s < GLOW) T.vgrad(x - 3, y0 - 12, 6, 24, [[0, NONE], [0.5, pm(sig, 0.45 * (1 - s / GLOW))], [1, NONE]])
          const w = 1 + 0.8 * e
          const bh = h * (1 + 0.3 * e)
          if (e < 1) T.rect(x - w / 2, y0 - bh, w, bh * 2, pm(WHITE, 0.42 * (1 - e) * k))
          T.rect(x - w / 2, y0 - bh, w, bh * 2, pm(sig, 0.95 * e * k))
        }
      }
      // The ghosts: where the blend's bars will land on the outgoing track, from the count-in's end until each locks.
      const prev = items[i - 1]
      if (!sync || lock === undefined || lock < COUNT_IN || !prev?.track.bpm) return
      const ga = smooth((lock - COUNT_IN) / 0.35)
      const bar = 240 / prev.track.bpm
      for (let j = 0; j < sync; j++) {
        if (since(j) >= 0) continue
        const x = X(prev.a + P!.mixOut + j * bar)
        for (let y = -12; y < 12; y += 4) T.rect(x - 0.7, y0 + y, 1.4, 2, pm(sig, 0.85 * ga))
      }
      const x0 = X(prev.a + P!.mixOut)
      const x1 = X(prev.a + P!.mixOut + sync * bar)
      const ba = ga * (1 - smooth((since(sync - 1) + 0.3) / 0.3))
      if (ba > 0.01) {
        T.rect(x0, y0 - 17, x1 - x0, 1, pm(sig, 0.55 * ba))
        T.rect(x0, y0 - 17, 1, 4, pm(sig, 0.55 * ba))
        T.rect(x1 - 1, y0 - 17, 1, 4, pm(sig, 0.55 * ba))
        t2.font = '500 10px ui-sans-serif,system-ui'
        t2.fillStyle = `${SIGNAL} / ${(0.9 * ba).toFixed(3)})`
        t2.fillText(`${sync} bars`, x0 + 3, y0 - 21)
      }
    })

    // Joins: a hairline at the middle of each overlap, from under the label, with a small diamond on the horizon.
    items.forEach((it, i) => {
      if (!it.plan) return
      const x = X(it.a + it.span.i0 + it.span.il / 2)
      if (x < R.x || x > R.x + R.w) return
      this.joinHits.push({ i, x, y: y0 })
      const k = x < px ? 0.6 : 1
      // When the key just arrived, the join stays blue until the notes are compared, then settles into its kind's colour.
      const to = it.tone ? rgb(it.tone) : sig
      const vt = it.harm ? it.harm.t - VERDICT_AT : Infinity
      const e = vt === Infinity ? 1 : Math.max(0, Math.min(1, vt / 0.22))
      const c = [0, 1, 2].map(j => sig[j] + (to[j] - sig[j]) * e) as unknown as typeof sig
      if (vt > 0 && vt < 0.5) T.vgrad(x - 3, y0 - amp * 0.6, 6, amp * 1.2, [[0, NONE], [0.5, pm(to, 0.35 * (1 - vt / 0.5))], [1, NONE]])
      const top = y0 - amp * 0.98
      const h = amp * 1.88
      if (it.reading?.unsure || it.prevReading?.unsure) {
        // Dashed: one of the two keys is unsure.
        const at = (f: number) => (f < 0.35 ? f / 0.35 : f > 0.62 ? (1 - f) / 0.38 : 1)
        for (let y = 0; y < h; y += 6) T.rect(x - 0.5, top + y, 1, Math.min(3, h - y), pm(c, 0.85 * k * at((y + 1.5) / h)))
      } else T.vgrad(x - 0.5, top, 1, h, [[0, NONE], [0.35, pm(c, 0.85 * k)], [0.62, pm(c, 0.85 * k)], [1, NONE]])
      T.diamond(x, y0, 4, pm(c, 0.95 * k))
    })

    // The rest of a track being analysed: a dotted horizon from its front to its end (2 px on, 5 off).
    for (const it of items) {
      if (it.front === undefined) continue
      const x0 = Math.max(px, X(it.a + it.front))
      const x1 = Math.min(W, X(it.a + it.track.dur))
      for (let x = x0; x < x1; x += 7) T.rect(x, y0 - 0.5, Math.min(2, x1 - x), 1, pm(WHITE, 0.25))
    }

    // Playhead and its dot.
    T.vgrad(px - 1, y0 - amp * 1.35, 2, amp * 2.2, [[0, NONE], [0.65, pm(WHITE, 0.9)], [1, NONE]])
    T.disc(px, y0, 5 + f.level * 9, pm(WHITE, 0.35 + f.level * 0.5))
    const over = T.n
    // A short strip ends at the queue: its last 28 px fade out (the stage's hard edge takes over when expanded).
    if (r0 && e < 1) T.hgrad(rx - 28, 0, 28, H, [[0, NONE], [1, [0, 0, 0, 1 - e]]])
    const fade = T.n

    // Under the curves, the curves (left of the playhead at 42 %), over them.
    const cv = this.curves(f, y0, amp, px)
    if (gl && !gl.gl.isContextLost()) {
      // The canvas follows the band, on whole device pixels.
      const oy = Math.max(0, Math.min(H - this.bandH, Math.floor(this.cy * this.dpr) / this.dpr))
      if (oy !== this.oy) {
        this.oy = oy
        this.canvas.style.transform = `translateY(${oy}px)`
      }
      gl.oy = oy
      gl.begin(lx, ly, rx - lx, lh)
      gl.blend('over')
      gl.load(T)
      gl.draw(0, under)
      if (cv) gl.curves(cv)
      gl.load(T)
      gl.draw(under, over)
      gl.blend('erase')
      gl.draw(over, fade)
    }

    this.labels(f, y0, amp)

    // A join's notes: while a key lands (then folding into the diamond), and on the next join
    // (or its diamond is tapped) until the mix is over, the slide playing each time it opens.
    const s = isPhone(W) ? 0.9 : 1.15
    items.forEach((it, i) => {
      const prev = items[i - 1]
      if (!it.plan || !it.prevReading || !prev) return
      const near = it.near !== undefined && it.reading ? { heard: [], land: 1, t: it.near } : null
      const ph = it.harm ?? near
      const show = it.harm ? (it.harm.t < FOLD_AT || near ? 1 : Math.max(0, 1 - (it.harm.t - FOLD_AT) / 0.35)) : near ? smooth(near.t / 0.3) : it.open ? 1 : 0
      if (show <= 0) return
      const jx = X(it.a + it.span.i0 + it.span.il / 2)
      const pw = PANEL_W * s
      const x0 = Math.max(R.x + 12, Math.min(jx - pw / 2, R.x + R.w - pw - 4))
      t2.save()
      t2.globalAlpha = show
      drawJoin(t2, x0, y0 + amp * 0.42, s, it.prevReading, ph && ph.land <= 0 ? undefined : it.reading, ph, it.verdict ?? null, false)
      t2.restore()
    })
    // A library row held over a join: how its key would follow the outgoing track's, over that join's own panel.
    const hd = f.drop
    if (hd) {
      const pw = PANEL_W * s
      // Beside the drop slot (36 px wide, DOM, over the canvas): right of it, or left near the right edge.
      const x0 = hd.x + 26 + pw <= R.x + R.w ? hd.x + 26 : hd.x - 26 - pw + 16 * s
      const y = y0 + amp * 0.42
      t2.save()
      t2.globalAlpha = smooth(hd.t / 0.2)
      t2.fillStyle = 'rgba(7,11,16,.9)'
      // Opaque under it, so the join's own panel (nearness) doesn't show through.
      t2.beginPath()
      t2.roundRect(x0 - 8 * s, y - 8 * s, pw, 50 * s, 8 * s)
      t2.fill()
      drawJoin(t2, x0, y, s, hd.a, hd.b, { heard: [], land: 1, t: hd.t }, hd.verdict, false)
      t2.restore()
    }

    // Axis ticks fade through the switch.
    t2.font = '500 11px ui-sans-serif,system-ui'
    t2.fillStyle = 'oklch(92% .01 240 / .5)'
    const ticks =
      e < 0.5
        ? [[-60, '−1 min'], [60, '+1 min'], [300, '+5'], [600, '+10'], [1200, '+20 min']]
        : [[-20, '−20 s'], [-10, '−10 s'], [20, '+20 s'], [40, '+40 s'], [60, '+60 s']]
    t2.globalAlpha = Math.abs(e - 0.5) * 2
    // A TV crops the picture's edges (overscan): there they sit inside the safe area.
    const below = e < 0.5 ? (TV ? 0.06 * H : 8) : 16
    for (const [s, l] of ticks) {
      const x = X(s as number)
      if (x > R.x + 16 && x < R.x + R.w - 40 && Math.abs(x - px) > 36) t2.fillText(l as string, x, R.y + R.h - below)
    }
    t2.globalAlpha = 1
    t2.restore()
  }

  /** The glow (2D, small: the background reads it) and the curves' heights per device column, for WebGL. */
  private curves(f: Frame, y0: number, amp: number, px: number): Curves | null {
    const { W, H, M, pts, dpr, cols } = this
    const by = Math.max(0, y0 - amp * 1.5)
    const bh = Math.min(H, y0 + amp * 1.05) - by
    // The halo reaches about 60 px past the curves; nothing is composited beyond that.
    const cy = Math.max(0, by - 64)
    const ch = Math.min(H, by + bh + 64) - cy
    this.cy = cy
    this.ch = ch
    const { g1, g2 } = this
    g1.x.setTransform(1, 0, 0, 1, 0, 0)
    g1.x.clearRect(0, 0, g1.c.width, g1.c.height)
    g1.x.setTransform(GQ, 0, 0, GQ, 0, 0)
    g1.x.globalCompositeOperation = 'lighter'

    const Y = y0 * dpr
    for (let j = 0; j < cols.length; j += 4) {
      cols[j] = cols[j + 1] = cols[j + 2] = Y
      cols[j + 3] = -1
    }
    sample(f.items, M, pts)
    const N = pts.n
    if (N > 1) {
      if (this.ys.length < N) this.ys = new Float64Array(N * 2)
      const xs = pts.x
      const ys = this.ys
      const { palette: pal } = f
      // Where a track is still being analysed, the curves' outlines get a rim light behind its front.
      const lit = f.items.filter(it => it.front !== undefined && it.front < it.track.dur)
      const outlines: Path2D[] = []
      const shapes = [
        [0, tlook.klo, true, pal.lo, 1, tlook.alo],
        [1, tlook.kmi, false, pal.mi, 0.8, tlook.ami],
        [2, tlook.khi, false, pal.hi, 0.7, tlook.ahi],
      ] as const
      for (const [g, k, down, col, glowA] of shapes) {
        const v = pts.s[g]
        for (let j = 0; j < N; j++) ys[j] = down ? y0 + v[j] * k * amp : y0 - v[j] * k * amp
        const P = new Path2D()
        P.moveTo(xs[0], y0)
        spline(P, xs, ys, N)
        P.lineTo(xs[N - 1], y0)
        P.closePath()
        g1.x.fillStyle = oklch(col)
        g1.x.globalAlpha = glowA
        g1.x.fill(P)
        g1.x.globalAlpha = 1
        if (lit.length) {
          const O = new Path2D()
          spline(O, xs, ys, N)
          outlines.unshift(O)
        }
        tess(this.line, xs, ys, N)
        columns(this.line, cols, g, Y, dpr)
      }
      // The rim, brightest at the front: on the glow layer a wider outline (it gets blurred), in the
      // columns its strength for the WebGL pass.
      const n = cols.length / 4
      for (const it of lit) {
        const xf = M.X(it.a + it.front!)
        if (xf < 0 || xf > W + RIM) continue
        const gr = g1.x.createLinearGradient(xf - RIM, 0, xf, 0)
        gr.addColorStop(0, oklch(pal.edge, 0))
        gr.addColorStop(1, oklch(pal.edge, 1))
        g1.x.save()
        g1.x.beginPath()
        g1.x.rect(xf - RIM, -1e4, RIM, 2e4)
        g1.x.clip()
        g1.x.strokeStyle = gr
        g1.x.lineWidth = 4
        for (const O of outlines) g1.x.stroke(O)
        g1.x.restore()
        for (let c = Math.max(0, Math.ceil((xf - RIM) * dpr - 0.5)), c1 = Math.min(n - 1, Math.ceil(xf * dpr - 0.5) - 1); c <= c1; c++) {
          const j = c * 4 + 3
          if (cols[j] >= 0) cols[j] = Math.max(cols[j], ((c + 0.5) / dpr - (xf - RIM)) / RIM)
        }
      }
    }
    g1.x.globalCompositeOperation = 'source-over'

    // The glow: the curves blurred at quarter resolution (14 px there is a 56 px halo), under the curves.
    const q = g2.x
    q.setTransform(1, 0, 0, 1, 0, 0)
    q.clearRect(0, 0, g2.c.width, g2.c.height)
    q.globalCompositeOperation = 'lighter'
    q.globalAlpha = 1
    q.filter = `blur(${14 * GB}px)`
    q.drawImage(g1.c, 0, 0)
    q.globalAlpha = 0.45
    q.filter = `blur(${7 * GB}px)`
    q.drawImage(g1.c, 0, 0)
    q.filter = 'none'

    const { palette: pal } = f
    return {
      cols, by, bh, cy, ch, y0, px, hw: tlook.edge / 2,
      lo: pm(rgb(oklch(pal.lo)), tlook.alo),
      mi: pm(rgb(oklch(pal.mi)), tlook.ami),
      hi: pm(rgb(oklch(pal.hi)), tlook.ahi),
      edge: tlook.edge > 0 ? pm(rgb(oklch(pal.edge)), 1) : NONE,
      rim: pm(rgb(oklch(pal.edge)), 1),
      // The light falls off ahead of the playhead, not by track, over three quarters of the strip.
      fall: M.R.w * 0.25,
      glow: g2.c,
      ga: tlook.glow * 0.5,
      gscale: [(W * GQ) / g2.c.width / W, GQ / g2.c.height],
    }
  }

  private labels(f: Frame, y0: number, amp: number) {
    const { text: g2, M, W } = this
    const { X, px, R } = M
    const { avoid } = f
    const right = Math.min(W, R.x + R.w)
    g2.textBaseline = 'alphabetic'
    let last = -1e9
    for (let i = 1; i < f.items.length; i++) {
      const it = f.items[i]
      if (!it.plan) continue
      const a = it.a + it.span.i0
      if (X(a) > right - 40) continue
      g2.font = '600 12px ui-sans-serif,system-ui'
      const r = it.reading
      const land = !r ? 0 : it.harm ? it.harm.land : 1
      const ty = y0 - amp * 1.02 - 22 - (r || it.harm ? 14 : 0)
      let tw = this.widths.get(it.title)
      if (tw === undefined) this.widths.set(it.title, (tw = g2.measureText(it.title).width))
      const box = Math.max(tw, 120) + 12
      // Near the right edge the label slides left to fit rather than vanish.
      const x0 = Math.min(X(a), right - box)
      if (x0 < px + 30 || x0 - last < 200) continue
      if (avoid && x0 + box > avoid.left && x0 < avoid.right && ty - 14 < avoid.bottom && ty + 18 > avoid.top) continue
      last = x0
      this.hits.push({ i, x0, x1: x0 + box, ty, b: r ? 32 : 18 })
      if (f.hover === i) {
        g2.fillStyle = 'oklch(72% .16 230 / .16)'
        g2.beginPath()
        g2.roundRect(x0, ty - 14, box, r ? 60 : 46, 8)
        g2.fill()
      }
      g2.fillStyle = f.hover === i ? 'oklch(98% .01 240)' : 'oklch(92% .01 240 / .92)'
      g2.fillText(it.title, x0 + 6, ty)
      g2.font = '500 11px ui-sans-serif,system-ui'
      g2.fillStyle = `${SIGNAL})`
      const fr = it.track.front
      const pct = Math.round((Math.min(fr ?? 0, it.track.dur) / it.track.dur) * 100)
      // The bands come first; tempo and key are measured after them, over the whole track.
      const bpm = `${Math.round(it.track.bpm)} BPM`
      const l = it.lock ?? Infinity
      const syncs = it.plan.mode === 'sync'
      const second =
        l < COUNT_IN ? `${bpm} · finding key…`
        : syncs && l < COUNT_IN + SEEN ? `${bpm} · syncing…`
        : syncs && l < COUNT_IN + SEEN + DOCK ? `${bpm} · docking…`
        : fr === undefined ? mixLabel(it.plan)
        : it.track.bpm ? `${mixLabel(it.plan)} · finding key…`
        : pct >= 100 ? 'Finding tempo and key…' : fr > 0 ? `Analysing · ${pct} %` : 'Analysing…'
      g2.fillText(`${a < 600 ? `in ${fmtTime(a)}` : 'later'} · ${second}`, x0 + 6, ty + 14)
      if (r && land > 0) {
        // The mood, in its colour ("Dark?" when unsure), then the key and the other reading worth hearing.
        const word = `${moodOf(r.mode)?.word ?? r.mode}${r.unsure ? '?' : ''}`
        g2.font = '600 11px ui-sans-serif,system-ui'
        g2.fillStyle = alpha(moodColor(r), land)
        g2.fillText(word, x0 + 6, ty + 28)
        const short = (m: string) => (m === 'Aeolian' ? 'min' : m === 'Ionian' ? 'maj' : m)
        const [at, am] = (r.alt ?? '').split(' ')
        const alt = r.unsure && am ? ` · or ${at === r.tonic ? short(am) : `${at} ${short(am)}`}` : ''
        g2.font = '500 11px ui-sans-serif,system-ui'
        g2.fillStyle = `oklch(92% .01 240 / ${(0.8 * land).toFixed(3)})`
        g2.fillText(` · ${r.tonic} ${short(r.mode)}${alt}`, x0 + 6 + g2.measureText(word).width, ty + 28)
      }
    }
  }
}
