import type { Palette } from '../timeline/palette'
import type { Bands } from './bands'
import { bandCss } from './color'
import type { Params, Style } from './settings'

// SPEC-music-player §5.8.4 to §5.8.6: one frame of the spectral background in the small canvas.

export const CW = 96
export const CH = 54

/** Spectrogram history for the Fall style. */
export class History {
  c = document.createElement('canvas')
  t = 0
  constructor() {
    this.c.width = CW
    this.c.height = CH
  }
}

export interface Scene {
  /** The timeline's horizon, 0..1 of the viewport height. */
  hy: number
  /** The timeline's amplitude, as a fraction of the viewport height. */
  ha: number
  /** The timeline's blurred glow layer (covers the viewport), or null. */
  halo: HTMLCanvasElement | null
  /** Beat position for Pulse: fraction since the last beat, and whether it was a downbeat. */
  beat: { fr: number; db: boolean }
  now: number
}

export function paint(g: CanvasRenderingContext2D, hist: History, bands: Bands, p: Params, style: Style, pal: Palette, sc: Scene) {
  const w = CW
  const h = CH
  const nb = p.nb
  const SE = bands.SE
  const Y = sc.hy * h
  const bw = w / nb
  g.globalCompositeOperation = 'source-over'
  g.clearRect(0, 0, w, h)
  g.globalCompositeOperation = p.add ? 'lighter' : 'source-over'
  const col = (i: number, a: number) => bandCss(SE[i], i, a, p, pal)

  for (let i = 0; i < nb; i++) {
    const e = SE[i]
    const x = (i + 0.5) * bw
    const eg = p.rx ? p.rfix : e
    if (e < 0.01) continue
    if (style === 'wash') {
      if (p.anc) {
        // Centred on the timeline: each band grows up and down from the horizon.
        const r = Math.min(1, eg * 0.95 * p.ht) * sc.ha * h * 2.1
        const gr = g.createLinearGradient(0, Y - r, 0, Y + r)
        gr.addColorStop(0, col(i, 0))
        gr.addColorStop(0.5, col(i, 0.55 * e))
        gr.addColorStop(1, col(i, 0))
        g.fillStyle = gr
        g.fillRect(x - bw * 0.9 * p.wd, Y - r, bw * 1.8 * p.wd, 2 * r)
      } else {
        const top = h - Math.min(1, eg * 0.95 * p.ht) * h
        const gr = g.createLinearGradient(0, h, 0, top)
        gr.addColorStop(0, col(i, 0.55 * e))
        gr.addColorStop(1, col(i, 0))
        g.fillStyle = gr
        g.fillRect(x - bw * 0.9 * p.wd, top, bw * 1.8 * p.wd, h - top)
      }
    } else if (style === 'bloom') {
      const r = h * (0.12 + 0.5 * eg) * p.ht
      const gr = g.createRadialGradient(x, Y, 0, x, Y, r)
      gr.addColorStop(0, col(i, 0.6 * e))
      gr.addColorStop(1, col(i, 0))
      g.fillStyle = gr
      g.fillRect(x - r * p.wd, Y - r, 2 * r * p.wd, 2 * r)
    } else if (style === 'field') {
      g.fillStyle = col(i, 0.42 * e)
      g.fillRect(x - bw * 0.8 * p.wd, 0, bw * 1.6 * p.wd, h)
    } else if (style === 'mirror') {
      const hh = eg * h * 0.42 * p.ht
      g.fillStyle = col(i, 0.5 * (p.rx ? e : 1))
      g.fillRect(x - bw * 0.32 * p.wd, Y - hh, bw * 0.64 * p.wd, hh * 2)
    } else if (style === 'aurora') {
      const dx = Math.sin((sc.now / 2600) * p.spd + i * 0.7) * bw * 0.7
      const bot = Math.min(h, eg * h * 0.85 * p.ht)
      const gr = g.createLinearGradient(0, 0, 0, bot)
      gr.addColorStop(0, col(i, 0.5 * e))
      gr.addColorStop(1, col(i, 0))
      g.fillStyle = gr
      g.fillRect(x + dx - bw * 0.7 * p.wd, 0, bw * 1.4 * p.wd, bot)
    } else if (style === 'pulse') {
      const k = Math.pow(1 - sc.beat.fr, 2) * (sc.beat.db ? 1 : 0.6) * p.beat
      const bass = 1 - i / (nb - 1)
      g.fillStyle = col(i, 0.3 * e * (1 - bass * 0.6) + 0.55 * e * bass * k)
      g.fillRect(x - bw * 0.8 * p.wd, 0, bw * 1.6 * p.wd, h)
    }
  }

  if (style === 'field') {
    g.globalCompositeOperation = 'destination-in'
    const gr = g.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, 'rgba(0,0,0,.25)')
    gr.addColorStop(Math.min(1, Math.max(0, sc.hy)), 'rgba(0,0,0,1)')
    gr.addColorStop(1, 'rgba(0,0,0,.55)')
    g.fillStyle = gr
    g.fillRect(0, 0, w, h)
  }
  if (style === 'ridge') ridge(g, bands, p, bw, Y, col)
  if (style === 'fall') fall(g, hist, bands, p, bw, Y, col, sc.now)
  halo(g, p, sc.halo)
}

/** One smooth spectrum curve on the horizon, filled down with the band colours. */
function ridge(g: CanvasRenderingContext2D, bands: Bands, p: Params, bw: number, Y: number, col: (i: number, a: number) => string) {
  const nb = p.nb
  const SE = bands.SE
  const yy = (i: number) => Y - Math.min(1.4, p.rx ? p.rfix : SE[i]) * CH * 0.45 * p.ht
  const pts: [number, number][] = [[0, yy(0)]]
  for (let i = 0; i < nb; i++) pts.push([(i + 0.5) * bw, yy(i)])
  pts.push([CW, yy(nb - 1)])
  g.globalCompositeOperation = 'source-over'
  g.beginPath()
  g.moveTo(0, CH)
  g.lineTo(...pts[0])
  for (let j = 1; j < pts.length - 1; j++) g.quadraticCurveTo(pts[j][0], pts[j][1], (pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2)
  g.lineTo(...pts[pts.length - 1])
  g.lineTo(CW, CH)
  g.closePath()
  const gr = g.createLinearGradient(0, 0, CW, 0)
  for (let i = 0; i < nb; i++) gr.addColorStop(i / (nb - 1), col(i, 0.6 * (p.rx ? Math.min(1, SE[i]) : 1)))
  g.fillStyle = gr
  g.fill()
  g.globalCompositeOperation = 'destination-in'
  const v = g.createLinearGradient(0, Y - CH * 0.45 * p.ht, 0, CH)
  v.addColorStop(0, 'rgba(0,0,0,1)')
  v.addColorStop(1, 'rgba(0,0,0,.15)')
  g.fillStyle = v
  g.fillRect(0, 0, CW, CH)
}

/** A spectrogram history: newest row at the horizon, older rows drift up and fade. */
function fall(g: CanvasRenderingContext2D, hist: History, bands: Bands, p: Params, bw: number, Y: number, col: (i: number, a: number) => string, now: number) {
  const hc = hist.c.getContext('2d')!
  const step = 55 / Math.max(0.05, p.spd)
  const n = p.spd ? Math.min(6, Math.floor((now - hist.t) / step)) : 0
  if (!p.spd) hist.t = now
  if (n > 0) {
    hist.t += n * step
    if (now - hist.t > 500) hist.t = now
    hc.globalCompositeOperation = 'copy'
    hc.drawImage(hist.c, 0, -n)
    hc.globalCompositeOperation = 'source-over'
    for (let r = 0; r < n; r++)
      for (let i = 0; i < p.nb; i++) {
        hc.fillStyle = col(i, 0.7 * bands.SE[i])
        hc.fillRect(i * bw, CH - 1 - r, bw + 0.5, 1)
      }
  }
  g.globalCompositeOperation = 'source-over'
  const hk = Math.max(1, Math.round(CH * p.ht))
  g.drawImage(hist.c, 0, CH - hk, CW, hk, 0, Y - hk, CW, hk)
  g.globalCompositeOperation = 'destination-in'
  const v = g.createLinearGradient(0, 0, 0, Y)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,1)')
  g.fillStyle = v
  g.fillRect(0, 0, CW, CH)
}

/** The dark halo: the timeline's blurred glow knocks the background out around the curves (§5.8.5). */
function halo(g: CanvasRenderingContext2D, p: Params, glow: HTMLCanvasElement | null) {
  if (!p.ko || !glow || !glow.width) return
  // The viewport sits inside the zoomed canvas.
  const z = p.zoom
  const dx = CW * (0.5 - 0.5 / z)
  const dy = CH * (0.5 - 0.5 / z)
  g.save()
  g.globalCompositeOperation = 'destination-out'
  g.filter = p.kb ? `blur(${p.kb}px)` : 'none'
  g.globalAlpha = p.ko
  for (let j = 0; j < 4; j++) g.drawImage(glow, dx, dy, CW / z, CH / z)
  g.restore()
}
