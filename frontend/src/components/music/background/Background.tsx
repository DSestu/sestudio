import { useEffect, useRef } from 'react'
import { getQueue } from '../../../musicQueue'
import { engine } from '../engine'
import { rawOf } from '../mix/analysis'
import { probe } from '../timeline/render'
import type { RawAnalysis } from '../timeline/sampling'
import { lightLead, liveBands } from './bands'
import { fx } from './color'
import { canvasSize, History, paint } from './draw'
import { bend, Energy, grid, type Grid } from './energy'
import { bgPalette, getLook, useLook } from './settings'
import { frameLoop, wake } from '../idle'
import { Light } from './light'

// The blurred, live spectrum behind the timeline (SPEC-music-player §5.8).

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A film-grain tile: light and dark specks around zero, so it needs no blend mode (the background is its own
 *  stacking context, a soft-light grain would only see the transparent canvas and grey the frame). Moved every
 *  frame so it reads as grain, not dust. */
function grainTile() {
  const n = Object.assign(document.createElement('canvas'), { width: 256, height: 256 })
  const g = n.getContext('2d')!
  const img = g.createImageData(256, 256)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 2 - 1
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0 ? 255 : 0
    img.data[i + 3] = Math.abs(v) * 0.1 * 255
  }
  g.putImageData(img, 0, 0)
  return `url(${n.toDataURL()})`
}

/** `clip` narrows the light to the stage rectangle (expanded mode); the wrapper is clipped, not the zoomed canvas. */
export default function Background({ clip = null }: { clip?: Rect | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const grainEl = useRef<HTMLDivElement>(null)
  // Subscribing re-renders on a change; the frame loop reads the store itself.
  const lookNow = useLook()
  useEffect(wake, [lookNow])

  useEffect(() => {
    const cv = canvas.current!
    // Painted on a scratch canvas and blurred (in WebGL) into the visible one while it is still small: the
    // page scales it up smoothly, so nothing re-blurs a viewport-sized layer every frame.
    const scratch = document.createElement('canvas')
    const g = scratch.getContext('2d')!
    let light: Light | null = null
    try {
      light = new Light(cv, wake)
    } catch (err) {
      console.warn('The background needs WebGL2:', err)
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const hist = new History()
    const beat = { fr: 1, db: false }
    const energy = new Energy()
    const grain = grainEl.current!
    grain.style.backgroundImage = grainTile()
    let grids: { raw: RawAnalysis | null | undefined; g: Grid | null } = { raw: undefined, g: null }
    let track = ''
    let fq = new Uint8Array(0)
    let nb = 0
    let last = 0
    let lastSig = ''
    let spk = 0
    const step = (now: number): boolean => {
      const look = getLook()
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      // The playing track's energy on its beat grid (§5.8.7).
      const q = getQueue()
      const id = q.items[q.current]?.track_id ?? ''
      const raw = id ? rawOf(id) : null
      if (id !== track) { track = id; energy.reset() }
      if (raw !== grids.raw) grids = { raw, g: grid(raw) }
      const an = engine.analyser
      const ac = an?.context as AudioContext | undefined
      const out = ac ? (ac.outputLatency || 0) + (ac.baseLatency || 0) : 0
      // The speakers' latency is read once: the browser's figure drifts, and every move of the delay is heard.
      if (!spk) spk = out
      // The light reacts late; the sound waits that long, so the attack plays out before the hit and the peak lands on it.
      if (an) engine.setLead(lightLead(an, look.s, spk))
      // What is heard now: the media clock minus the delay and the output latency.
      const heard = engine.time - engine.lead - out
      energy.step(grids.g, heard, q.playing, dt, look.s)
      const { p, blurK } = bend({ ...look.s }, energy.I, grids.g?.bl ?? 0.5)
      if (p.nb !== nb) {
        nb = p.nb
        liveBands.reset()
      }
      let bins: Uint8Array | null = null
      if (an && q.playing && !still.matches) {
        if (Math.abs(an.smoothingTimeConstant - p.sm) > 0.005) an.smoothingTimeConstant = p.sm
        if (fq.length !== an.frequencyBinCount) fq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(fq)
        bins = fq
      }
      liveBands.update(bins, an?.context.sampleRate ?? 44100, dt, p)

      const W = cv.clientWidth, H = cv.clientHeight
      const { w, h } = canvasSize(p, W, H)
      if (scratch.width !== w || scratch.height !== h) {
        scratch.width = cv.width = w
        scratch.height = cv.height = h
      }
      // The accent follows the grid, scaled by the intensity and by how much bass is actually there.
      let bass = 0
      const nq = Math.ceil(p.nb / 4)
      for (let i = 0; i < nq; i++) bass += liveBands.SE[i]
      fx.acc = still.matches ? 0 : p.acc * energy.A * energy.I * Math.min(1, (bass / nq) * 1.5)
      fx.I = energy.I

      const s = cv.style
      s.transform = `scale(${p.zoom})`
      s.opacity = String(p.op)
      const PH = probe.H || innerHeight
      paint(g, hist, liveBands, p, look.style, bgPalette(look), {
        hy: probe.H ? probe.y0 / PH : 0.8,
        ha: probe.H ? probe.amp / PH : 0.2,
        halo: probe.glow,
        beat,
        now,
      })
      light?.frame(scratch, (look.blur[look.style] * blurK * w) / (W || w), p.sat, p.bloom)
      grain.style.opacity = String(Math.min(1, p.grain * 4))
      if (p.grain && !still.matches) grain.style.backgroundPosition = `${(Math.random() * 256) | 0}px ${(Math.random() * 256) | 0}px`
      // Still when the bands, the timeline and the settings are.
      let sum = 0
      for (let i = 0; i < nb; i++) sum += liveBands.SE[i]
      const sig = `${sum.toFixed(3)}|${probe.frame}|${probe.y0}|${probe.amp}|${look.preset}|${energy.I.toFixed(3)}`
      const moved = sig !== lastSig || (bins !== null && !still.matches)
      lastSig = sig
      return moved
    }
    // Every display frame: at 30 fps a 30 ms attack lands in one coarse step and the analyser misses
    // short hits, which flattens the dynamics. The small canvas is cheap.
    return frameLoop(step)
  }, [])

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-20 pointer-events-none"
      style={clip ? { clipPath: `inset(${clip.y}px calc(100% - ${clip.x + clip.w}px) calc(100% - ${clip.y + clip.h}px) ${clip.x}px)` } : undefined}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full transition-opacity duration-400" />
      <div ref={grainEl} className="absolute inset-0 opacity-0" />
    </div>
  )
}
