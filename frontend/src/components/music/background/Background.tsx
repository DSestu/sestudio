import { useEffect, useRef } from 'react'
import { getQueue } from '../../../musicQueue'
import { engine } from '../engine'
import { probe } from '../timeline/render'
import { liveBands } from './bands'
import { CH, CW, History, paint } from './draw'
import { bgPalette, getLook, useLook } from './settings'
import { TV } from '../tv'

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
  useLook()

  useEffect(() => {
    const cv = canvas.current!
    // The TV page paints on a scratch canvas and blurs it into the visible one while it is still tiny.
    const scratch = TV ? Object.assign(document.createElement('canvas'), { width: CW, height: CH }) : null
    const g = (scratch ?? cv).getContext('2d')!
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const hist = new History()
    const beat = { fr: 1, db: false }
    let fq = new Uint8Array(0)
    let nb = 0
    let last = 0
    let id = 0
    const frame = (now: number) => {
      id = requestAnimationFrame(frame)
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
      if (!TV) s.filter = `blur(${look.blur[look.style]}px) saturate(${p.sat})`
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
      if (scratch) {
        const v = cv.getContext('2d')!
        v.filter = `blur(${look.blur[look.style] * CW / (cv.clientWidth || CW)}px) saturate(${p.sat})`
        v.clearRect(0, 0, CW, CH)
        v.drawImage(scratch, 0, 0)
      }
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
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
