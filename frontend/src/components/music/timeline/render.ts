// Paints one timeline frame (SPEC-music-player §6.5 to §6.9). Layers back to
// front: joins, minute grid, beat ticks, then the curves on an offscreen canvas
// (glow, bass, mids, highs, edge) composited twice (left of the playhead at 42 %),
// then ticks, labels and the playhead.

import { fmtTime } from '../format'
import { isPhone, Mapper } from './mapping'
import { oklch, type Palette } from './palette'
import { FADE, Points, sample, type DrawItem, type Plan } from './sampling'

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

export interface LabelItem extends DrawItem {
  title: string
  /** The handover into this track. */
  plan?: Plan
}

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
  private page: CanvasRenderingContext2D
  private off = layer()
  private top = layer() // bass, mids, highs, edge (device resolution)
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
    this.page = canvas.getContext('2d')!
    this.text = text.getContext('2d')!
  }

  /** Lowered by the caller when frames run long. */
  maxDpr = 2

  /** DPR is capped at 2, and at 1.5 on a phone. */
  resize(W: number, H: number, deviceRatio: number) {
    this.W = W
    this.H = H
    this.dpr = Math.min(deviceRatio || 1, isPhone(W) ? 1.5 : 2, this.maxDpr)
    const dw = Math.round(W * this.dpr)
    const dh = Math.round(H * this.dpr)
    this.canvas.width = this.off.c.width = this.top.c.width = dw
    this.canvas.height = this.off.c.height = this.top.c.height = dh
    this.g1.c.width = this.g2.c.width = Math.ceil(W * GQ)
    this.g1.c.height = this.g2.c.height = Math.ceil(H * GQ)
    this.tdpr = Math.min(deviceRatio || 1, 3)
    this.text.canvas.width = Math.round(W * this.tdpr)
    this.text.canvas.height = Math.round(H * this.tdpr)
    this.M = new Mapper(W, H)
  }

  /** The labels drawn last frame, for hit tests: the join they open (index of the incoming item) and their box. */
  private hits: { i: number; x0: number; x1: number; ty: number }[] = []

  /** The label under a point of the canvas, and whether it is the second line (the transition). */
  labelAt(x: number, y: number): { i: number; x0: number; ty: number; second: boolean } | null {
    for (const h of this.hits) {
      if (x >= h.x0 && x <= h.x1 && y >= h.ty - 14 && y <= h.ty + 18) return { i: h.i, x0: h.x0, ty: h.ty, second: y > h.ty + 3 }
    }
    return null
  }

  draw(f: Frame) {
    const { W, H, dpr, page: g2, off, M, text: t2 } = this
    this.hits.length = 0
    if (!W) return
    const o2 = off.x
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

    g2.setTransform(dpr, 0, 0, dpr, 0, 0)
    g2.clearRect(0, 0, W, H)
    o2.setTransform(dpr, 0, 0, dpr, 0, 0)
    o2.clearRect(0, 0, W, H)

    // The light: the whole page, narrowing to the stage when expanded.
    const { e: stage } = M
    const lx = stage.x * e
    const ly = stage.y * e
    t2.setTransform(this.tdpr, 0, 0, this.tdpr, 0, 0)
    t2.clearRect(0, 0, W, H)
    for (const c of [g2, t2]) {
      c.save()
      c.beginPath()
      c.rect(lx, ly, W - lx - (W - stage.x - stage.w) * e, H - ly - (H - stage.y - stage.h) * e)
      c.clip()
    }

    // Joins.
    for (const it of items) {
      if (!it.plan) continue
      const a = it.a + it.span.i0
      const x0 = X(a)
      const x1 = X(a + it.span.il)
      if (x1 < 0 || x0 > W) continue
      const gr = g2.createLinearGradient(x0, 0, x1, 0)
      gr.addColorStop(0, `${SIGNAL} / 0)`)
      gr.addColorStop(0.5, `${SIGNAL} / .22)`)
      gr.addColorStop(1, `${SIGNAL} / 0)`)
      g2.fillStyle = gr
      g2.fillRect(x0, y0 - amp * 1.2, x1 - x0, amp * 2.1)
    }

    // Minute grid, on whole minutes of the timeline's own clock.
    {
      const gy = y0 - amp * 1.1
      const gh = amp * 2.05
      const vg = g2.createLinearGradient(0, gy, 0, gy + gh)
      vg.addColorStop(0, 'rgba(255,255,255,0)')
      vg.addColorStop(0.5, 'rgba(255,255,255,1)')
      vg.addColorStop(1, 'rgba(255,255,255,0)')
      g2.fillStyle = vg
      for (let m = Math.ceil((f.G - 200) / 60); m * 60 <= f.G + 1600; m++) {
        const sm = m * 60 - f.G
        const x = X(sm)
        if (x < R.x || x > R.x + R.w) continue
        const sp = Math.abs(X(sm + 60) - x)
        const a = 0.09 * Math.max(0, Math.min(1, (sp - 8) / 30)) * (x < px ? 0.6 : 1)
        if (a <= 0.003) continue
        g2.globalAlpha = a * 0.4
        g2.fillRect(x - 1.5, gy, 3, gh)
        g2.globalAlpha = a
        g2.fillRect(x - 0.5, gy, 1, gh)
      }
      g2.globalAlpha = 1
    }

    // Beat ticks, on the horizon, where beats are at least 5 px apart (downbeats alone where tighter).
    g2.fillStyle = '#fff'
    for (const it of items) {
      const { track, span: S, a } = it
      if (!track.bpm) continue
      const bt = 60 / track.bpm
      const lo = Math.max(S.i0, -200 - a)
      const hi = Math.min(S.o0 + S.ol, 1600 - a)
      if (hi <= lo) continue
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
          const h = isBar ? 9 : 4
          g2.globalAlpha = (isBar ? 0.42 : 0.22) * (x < px ? 0.6 : 1)
          g2.fillRect(x - 0.5, y0 - h, 1, h * 2)
        }
      }
    }
    g2.globalAlpha = 1

    this.curves(f, y0, amp)

    // The played part at 42 %.
    g2.save()
    g2.beginPath()
    g2.rect(0, 0, px, H)
    g2.clip()
    g2.globalAlpha = 0.42
    g2.drawImage(off.c, 0, this.cy * dpr, W * dpr, this.ch * dpr, 0, this.cy, W, this.ch)
    g2.restore()
    g2.save()
    g2.beginPath()
    g2.rect(px, 0, W, H)
    g2.clip()
    g2.drawImage(off.c, 0, this.cy * dpr, W * dpr, this.ch * dpr, 0, this.cy, W, this.ch)
    g2.restore()

    this.labels(f, y0, amp)

    // Axis ticks fade through the switch.
    t2.font = '500 11px ui-sans-serif,system-ui'
    t2.fillStyle = 'oklch(92% .01 240 / .5)'
    const ticks =
      e < 0.5
        ? [[-60, '−1 min'], [60, '+1 min'], [300, '+5'], [600, '+10'], [1200, '+20 min']]
        : [[-20, '−20 s'], [-10, '−10 s'], [20, '+20 s'], [40, '+40 s'], [60, '+60 s']]
    t2.globalAlpha = Math.abs(e - 0.5) * 2
    for (const [s, l] of ticks) {
      const x = X(s as number)
      if (x > R.x + 16 && x < R.x + R.w - 40 && Math.abs(x - px) > 36) t2.fillText(l as string, x, e < 0.5 ? R.y + R.h - 8 : R.y + R.h - 16)
    }
    t2.globalAlpha = 1
    t2.restore()

    // Playhead and its dot.
    const ph = g2.createLinearGradient(0, y0 - amp * 1.35, 0, y0 + amp * 0.85)
    ph.addColorStop(0, 'rgba(255,255,255,0)')
    ph.addColorStop(0.65, 'rgba(255,255,255,.9)')
    ph.addColorStop(1, 'rgba(255,255,255,0)')
    g2.fillStyle = ph
    g2.fillRect(px - 1, y0 - amp * 1.35, 2, amp * 2.2)
    g2.beginPath()
    g2.arc(px, y0, 5 + f.level * 9, 0, Math.PI * 2)
    g2.fillStyle = `rgba(255,255,255,${0.35 + f.level * 0.5})`
    g2.fill()
    g2.restore()
  }

  private curves(f: Frame, y0: number, amp: number) {
    const { W, H, dpr, off, M, pts } = this
    const o2 = off.x
    const bx = 0
    const by = Math.max(0, y0 - amp * 1.5)
    const bh = Math.min(H, y0 + amp * 1.05) - by
    // The halo reaches about 60 px past the curves; nothing is composited beyond that.
    const cy = Math.max(0, by - 64)
    const ch = Math.min(H, by + bh + 64) - cy
    this.cy = cy
    this.ch = ch
    const { top, g1, g2 } = this
    top.x.setTransform(dpr, 0, 0, dpr, 0, 0)
    top.x.clearRect(bx, by, W, bh)
    g1.x.setTransform(1, 0, 0, 1, 0, 0)
    g1.x.clearRect(0, 0, g1.c.width, g1.c.height)
    g1.x.setTransform(GQ, 0, 0, GQ, 0, 0)
    g1.x.globalCompositeOperation = 'lighter'

    sample(f.items, M, pts)
    const N = pts.n
    if (N > 1) {
      if (this.ys.length < N) this.ys = new Float64Array(N * 2)
      const xs = pts.x
      const ys = this.ys
      const spline = (c: Path2D, cont: boolean) => {
        if (cont) c.lineTo(xs[0], ys[0])
        else c.moveTo(xs[0], ys[0])
        for (let j = 0; j < N - 1; j++) {
          const p = Math.max(0, j - 1)
          const q = Math.min(N - 1, j + 2)
          c.bezierCurveTo(xs[j] + (xs[j + 1] - xs[p]) / 6, ys[j] + (ys[j + 1] - ys[p]) / 6, xs[j + 1] - (xs[q] - xs[j]) / 6, ys[j + 1] - (ys[q] - ys[j]) / 6, xs[j + 1], ys[j + 1])
        }
      }
      const shape = (g: number, k: number, down: boolean, stroke = false) => {
        const v = pts.s[g]
        for (let j = 0; j < N; j++) ys[j] = down ? y0 + v[j] * k * amp : y0 - v[j] * k * amp
        const P = new Path2D()
        if (stroke) {
          spline(P, false)
          return P
        }
        P.moveTo(xs[0], y0)
        spline(P, true)
        P.lineTo(xs[N - 1], y0)
        P.closePath()
        return P
      }
      const pLo = shape(0, tlook.klo, true)
      const pMi = shape(1, tlook.kmi, false)
      const pHi = shape(2, tlook.khi, false)
      const sHi = shape(2, tlook.khi, false, true)
      const { palette: pal } = f
      // One shape, painted once per brightness region.
      const paint = (c: CanvasRenderingContext2D, P: Path2D, alpha: number, stroke = false) => {
        for (let r = 0; r < pts.nregions; r++) {
          const g = pts.regions[r]
          c.save()
          c.beginPath()
          c.rect(g.x0, -1e4, g.x1 - g.x0, 2e4)
          c.clip()
          c.globalAlpha = alpha * g.hm
          if (stroke) c.stroke(P)
          else c.fill(P)
          c.restore()
        }
      }
      g1.x.fillStyle = oklch(pal.lo)
      paint(g1.x, pLo, 1)
      g1.x.fillStyle = oklch(pal.mi)
      paint(g1.x, pMi, 0.8)
      g1.x.fillStyle = oklch(pal.hi)
      paint(g1.x, pHi, 0.7)
      top.x.fillStyle = oklch(pal.lo)
      paint(top.x, pLo, tlook.alo)
      top.x.fillStyle = oklch(pal.mi)
      paint(top.x, pMi, tlook.ami)
      top.x.fillStyle = oklch(pal.hi)
      paint(top.x, pHi, tlook.ahi)
      top.x.strokeStyle = oklch(pal.edge)
      top.x.lineWidth = tlook.edge
      if (tlook.edge > 0) paint(top.x, sHi, 1, true)
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
    o2.save()
    o2.globalCompositeOperation = 'lighter'
    o2.globalAlpha = Math.min(1, tlook.glow * 0.5)
    o2.imageSmoothingEnabled = true
    o2.drawImage(g2.c, 0, cy * GQ, g2.c.width, ch * GQ, 0, cy, W, ch)
    if (tlook.glow * 0.5 > 1) {
      o2.globalAlpha = tlook.glow * 0.5 - 1
      o2.drawImage(g2.c, 0, cy * GQ, g2.c.width, ch * GQ, 0, cy, W, ch)
    }
    o2.restore()
    o2.globalCompositeOperation = 'source-over'
    o2.drawImage(top.c, bx * dpr, by * dpr, W * dpr, bh * dpr, bx, by, W, bh)
  }

  private labels(f: Frame, y0: number, amp: number) {
    const { text: g2, M, W } = this
    const { X, px } = M
    const { avoid } = f
    g2.textBaseline = 'alphabetic'
    let last = -1e9
    for (let i = 1; i < f.items.length; i++) {
      const it = f.items[i]
      if (!it.plan) continue
      const a = it.a + it.span.i0
      const x0 = X(a)
      if (x0 < px + 30 || x0 > W - 100 || x0 - last < 200) continue
      g2.font = '600 12px ui-sans-serif,system-ui'
      const ty = y0 - amp * 1.02 - 22
      let tw = this.widths.get(it.title)
      if (tw === undefined) this.widths.set(it.title, (tw = g2.measureText(it.title).width))
      const box = Math.max(tw, 120) + 12
      if (avoid && x0 + box > avoid.left && x0 < avoid.right && ty - 14 < avoid.bottom && ty + 18 > avoid.top) continue
      last = x0
      this.hits.push({ i, x0, x1: x0 + box, ty })
      if (f.hover === i) {
        g2.fillStyle = 'oklch(72% .16 230 / .16)'
        g2.beginPath()
        g2.roundRect(x0, ty - 14, box, 46, 8)
        g2.fill()
      }
      g2.fillStyle = f.hover === i ? 'oklch(98% .01 240)' : 'oklch(92% .01 240 / .92)'
      g2.fillText(it.title, x0 + 6, ty)
      g2.font = '500 11px ui-sans-serif,system-ui'
      g2.fillStyle = `${SIGNAL})`
      g2.fillText(`${a < 600 ? `in ${fmtTime(a)}` : 'later'} · ${mixLabel(it.plan)}`, x0 + 6, y0 - amp * 1.02 - 8)
    }
  }
}
