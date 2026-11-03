import { useEffect, useRef } from 'react'
import { getQueue } from '../../../musicQueue'
import { engine } from '../engine'
import { probe } from '../timeline/render'
import { liveBands } from './bands'
import { CH, CW, History, paint } from './draw'
import { bgPalette, getLook, useLook } from './settings'
import { frameLoop, wake } from '../idle'

// The blurred, live spectrum behind the timeline (SPEC-music-player §5.8).

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** `clip` narrows the light to the stage rectangle (expanded mode); the wrapper is clipped, not the zoomed canvas. */
export default function Background({ clip = null }: { clip?: Rect | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Subscribing re-renders on a change; the frame loop reads the store itself.
  const lookNow = useLook()
  useEffect(wake, [lookNow])

  useEffect(() => {
    const cv = canvas.current!
    // Painted on a scratch canvas and blurred into the visible one while it is still tiny: the page scales
    // it up smoothly, so no CSS blur re-blurs a viewport-sized layer every frame.
    const scratch = Object.assign(document.createElement('canvas'), { width: CW, height: CH })
    const g = scratch.getContext('2d')!
    const v = cv.getContext('2d')!
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const hist = new History()
    const beat = { fr: 1, db: false }
    let fq = new Uint8Array(0)
    let nb = 0
    let last = 0
    let lastSig = ''
    const step = (now: number): boolean => {
      const look = getLook()
      const p = { ...look.s }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      if (p.nb !== nb) {
        nb = p.nb
        liveBands.reset()
      }
      const an = engine.analyser
      let bins: Uint8Array | null = null
      if (an && getQueue().playing && !still.matches) {
        if (an.smoothingTimeConstant !== p.sm) an.smoothingTimeConstant = p.sm
        if (fq.length !== an.frequencyBinCount) fq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(fq)
        bins = fq
      }
      liveBands.update(bins, an?.context.sampleRate ?? 44100, dt, p)

      const s = cv.style
      s.transform = `scale(${p.zoom})`
      s.opacity = String(p.op)
      const H = probe.H || innerHeight
      paint(g, hist, liveBands, p, look.style, bgPalette(look), {
        hy: probe.H ? probe.y0 / H : 0.8,
        ha: probe.H ? probe.amp / H : 0.2,
        halo: probe.glow,
        beat,
        now,
      })
      v.filter = `blur(${(look.blur[look.style] * CW) / (cv.clientWidth || CW)}px) saturate(${p.sat})`
      v.clearRect(0, 0, CW, CH)
      v.drawImage(scratch, 0, 0)
      // Still when the bands, the timeline and the settings are.
      let sum = 0
      for (let i = 0; i < nb; i++) sum += liveBands.SE[i]
      const sig = `${sum.toFixed(3)}|${probe.frame}|${probe.y0}|${probe.amp}|${look.preset}`
      const moved = sig !== lastSig || (bins !== null && !still.matches)
      lastSig = sig
      return moved
    }
    // Half the display rate is plenty for a blur this soft.
    return frameLoop(step, () => (getQueue().playing ? 30 : 0))
  }, [])

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-20 pointer-events-none"
      style={clip ? { clipPath: `inset(${clip.y}px calc(100% - ${clip.x + clip.w}px) calc(100% - ${clip.y + clip.h}px) ${clip.x}px)` } : undefined}
    >
      <canvas ref={canvas} width={CW} height={CH} className="absolute inset-0 size-full transition-opacity duration-400" />
    </div>
  )
}
