import type { RawAnalysis } from './timeline/sampling'
import { PALETTES, TIMELINE_PALETTE, type Oklch } from './timeline/palette'

// The player bar's light (mockup .impeccable/mocks/eq-bars, B5): an aura that
// glows inward from the glass outline with the EQ's live bands, and over it
// the whole track's envelope on the top and bottom edges, lit up to "now".

const pct = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(q * (a.length - 1))] ?? 0
const clamp = (v: number) => Math.max(0, Math.min(1, v))

export interface Prepped {
  /** The whole track's envelope, 0..1, ENV points. */
  env: number[]
}

export const ENV = 240

export function prep(raw: RawAnalysis | null | undefined): Prepped | null {
  const bands = raw?.bands
  if (bands?.length !== 8 || !bands[0]?.length) return null
  const n = bands[0].length
  // Bass, mids, highs, each against its own loud end, then averaged.
  const groups = [[0, 1], [2, 3, 4], [5, 6, 7]].map(g => Array.from({ length: ENV }, (_, k) => {
    const i0 = Math.floor((k * n) / ENV), i1 = Math.max(i0 + 1, Math.floor(((k + 1) * n) / ENV))
    let a = 0
    for (let i = i0; i < i1; i++) for (const b of g) a += bands[b][i] ?? 0
    return a / ((i1 - i0) * g.length)
  }))
  const tops = groups.map(g => Math.max(1, pct(g, 0.98)))
  const mixed = Array.from({ length: ENV }, (_, k) => groups.reduce((a, g, j) => a + clamp(g[k] / tops[j]), 0) / 3)
  const env = mixed.map((_, k) => {
    let a = 0, c = 0
    for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < ENV) { a += mixed[j]; c++ }
    return a / c
  })
  return { env }
}

/** The envelope at u (0..1 of the track). */
export function envAt(p: Prepped, u: number) {
  const x = clamp(u) * (ENV - 1), k = Math.min(ENV - 2, Math.floor(x)), f = x - k
  return p.env[k] * (1 - f) + p.env[k + 1] * f
}

const PAL = PALETTES[TIMELINE_PALETTE]
const STOPS: Oklch[] = [PAL.lo, PAL.mi, PAL.hi]
/** The palette from bass (0) to highs (1). */
export function col(u: number, a: number) {
  const x = clamp(u) * 2, k = Math.min(1, Math.floor(x)), f = x - k, p = STOPS[k], q = STOPS[k + 1]
  return `oklch(${p[0] + (q[0] - p[0]) * f}% ${p[1] + (q[1] - p[1]) * f} ${p[2] + (q[2] - p[2]) * f} / ${a})`
}
const HEAD = (a: number) => `oklch(${PAL.edge[0]}% ${PAL.edge[1]} ${PAL.edge[2]} / ${a})`
const GHOST = (a: number) => `oklch(85% 0.03 200 / ${a})`

export interface Shape {
  w: number
  h: number
  /** Top and bottom corner radii. */
  rt: number
  rb: number
}

export function outlinePath(c: CanvasRenderingContext2D, { w, h, rt, rb }: Shape) {
  c.beginPath()
  c.moveTo(rt, 0)
  c.arcTo(w, 0, w, h, rt)
  c.arcTo(w, h, 0, h, rb)
  c.arcTo(0, h, 0, 0, rb)
  c.arcTo(0, 0, w, 0, rt)
  c.closePath()
}

/** The outline as ~3 px segments, clockwise from the top-left corner. */
export function perimeter({ w, h, rt, rb }: Shape): [number, number][] {
  const pts: [number, number][] = []
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3))
    for (let i = 1; i <= m; i++) pts.push([x0 + ((x1 - x0) * i) / m, y0 + ((y1 - y0) * i) / m])
  }
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    const m = Math.max(2, Math.ceil((r * Math.abs(a1 - a0)) / 3))
    for (let i = 1; i <= m; i++) { const a = a0 + ((a1 - a0) * i) / m; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) }
  }
  const PI = Math.PI
  pts.push([rt, 0])
  line(rt, 0, w - rt, 0); arc(w - rt, rt, rt, -PI / 2, 0); line(w, rt, w, h - rb); arc(w - rb, h - rb, rb, 0, PI / 2)
  line(w - rb, h, rb, h); arc(rb, h - rb, rb, PI / 2, PI); line(0, h - rb, 0, rt); arc(rt, rt, rt, PI, 1.5 * PI)
  return pts
}

export interface Frame {
  /** Band levels 0..1, bass first. */
  levels: ArrayLike<number>
  /** The beat-grid energy, 0..1. */
  energy: number
  /** How settled the aura is, 0 (reading the music) .. 1 (paused: a calm, even glow). */
  calm: number
  /** Where the track is, 0..1. */
  progress: number
  env: Prepped | null
}

/** Draws one frame; `off` is a scratch canvas of the same size for the glow. */
export function draw(c: CanvasRenderingContext2D, off: CanvasRenderingContext2D, s: Shape, pts: [number, number][], f: Frame) {
  const { w, h, rt } = s
  const nb = f.levels.length, e = f.energy * (1 - f.calm)
  const level = (u: number) => {
    const x = clamp(u) * (nb - 1), k = Math.min(nb - 2, Math.floor(x)), g = x - k
    return (f.levels[k] * (1 - g) + f.levels[k + 1] * g) * (1 - f.calm) + 0.22 * f.calm
  }
  // Bass at the middle, highs out at the corners.
  const mir = (x: number) => Math.abs(x / w - 0.5) * 2
  const seg = (i: number) => { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], u = mir((x0 + x1) / 2); return { x0, y0, x1, y1, u, v: level(u) } }
  off.clearRect(0, 0, w, h)
  off.lineCap = 'round'
  for (let i = 1; i < pts.length; i++) {
    const { x0, y0, x1, y1, u, v } = seg(i)
    off.strokeStyle = col(u, 0.2 + 0.8 * v)
    off.lineWidth = 4 + 26 * v * (0.35 + 0.65 * e)
    off.beginPath(); off.moveTo(x0, y0); off.lineTo(x1, y1); off.stroke()
  }
  c.clearRect(0, 0, w, h)
  c.save()
  outlinePath(c, s)
  c.clip()
  // The glow stays inside the glass.
  c.globalAlpha = 0.35 + 0.5 * e
  c.filter = `blur(${7 + 9 * e}px)`
  c.drawImage(off.canvas, 0, 0, w, h)
  c.filter = 'none'
  c.globalAlpha = 1
  c.lineWidth = 2
  for (let i = 1; i < pts.length; i++) {
    const { x0, y0, x1, y1, u, v } = seg(i)
    c.strokeStyle = col(u, 0.25 + 0.75 * v * (0.4 + 0.6 * e))
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke()
  }
  // The track: its envelope on both edges, lit where played; left is the start.
  const xp = f.progress * w
  if (f.env) for (let x = rt; x < w - rt; x += 1.5) {
    const taper = Math.min(1, (x - rt) / 10, (w - rt - x) / 10), t = envAt(f.env, x / w) ** 1.4 * 7 * taper
    if (t < 0.3) continue
    c.fillStyle = x <= xp ? HEAD(0.7) : GHOST(0.2)
    c.fillRect(x, 0, 1.6, t)
    c.fillRect(x, h - t, 1.6, t)
  }
  c.lineWidth = 1.25
  for (let i = 1; i < pts.length; i++) {
    const { x0, y0, x1, y1 } = seg(i)
    c.strokeStyle = (x0 + x1) / 2 <= xp ? HEAD(0.55) : GHOST(0.12)
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke()
  }
  // Now: a faint line edge to edge, with a point on each edge.
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, HEAD(0.6)); g.addColorStop(0.25, HEAD(0.08)); g.addColorStop(0.75, HEAD(0.08)); g.addColorStop(1, HEAD(0.6))
  c.fillStyle = g
  c.fillRect(xp - 0.5, 0, 1, h)
  for (const y of [0, h]) {
    const r = c.createRadialGradient(xp, y, 0, xp, y, 16 + 12 * e)
    r.addColorStop(0, HEAD(0.55)); r.addColorStop(1, HEAD(0))
    c.fillStyle = r
    c.fillRect(xp - 40, y - 40, 80, 80)
    c.fillStyle = HEAD(0.95)
    c.beginPath(); c.arc(xp, y, 2.6, 0, 7); c.fill()
  }
  c.restore()
}
