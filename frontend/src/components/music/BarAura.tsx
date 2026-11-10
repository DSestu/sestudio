import { useEffect, useRef, type RefObject } from 'react'
import { clockSkew, positionNow, type QueueState } from '../../musicQueue'
import { draw, perimeter, prep, type Prepped, type Shape } from './barAuraDraw'
import { Bands, lightLead, tc } from './background/bands'
import { bend, Energy, grid, type Grid } from './background/energy'
import { getLook } from './background/settings'
import { engine } from './engine'
import { rawOf, useAnalyses } from './mix/analysis'

const RADIUS = 16
/** The phone dock, which the bar joins into one glass object (the desktop rail's nav has the same label but no size there). */
const dock = () => [...document.querySelectorAll<HTMLElement>('nav[aria-label="Primary"]')].map(n => n.getBoundingClientRect()).find(r => r.width > 0)

/**
 * The player bar's light, drawn over the bar (and the phone dock under it) and
 * clipped to their outline: blends as light only and never takes a tap.
 */
export default function BarAura({ bar, q, duration }: { bar: RefObject<HTMLElement | null>; q: QueueState; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const id = q.items[q.current]?.track_id ?? ''
  const [tick] = useAnalyses(id ? [id] : [])
  // The loop reads the newest props without restarting.
  const live = useRef({ q, duration, id, tick })
  useEffect(() => { live.current = { q, duration, id, tick } })

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const c = cv.getContext('2d')!, off = document.createElement('canvas').getContext('2d')!
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    // The EQ's own chain (Background.tsx): the live analyser through the Look's bands, bent by the track's energy.
    const bands = new Bands(), energy = new Energy()
    let fq = new Uint8Array(0), nb = 0, calm = 0, last = 0, raf = 0
    let track = '', p: Prepped | null = null, g: Grid | null = null, seen = -1
    let shape: Shape = { w: 0, h: 0, rt: 0, rb: 0 }, pts: [number, number][] = [], key = ''
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      last = now
      const el = bar.current
      if (!el) return
      const { q, duration, id, tick } = live.current
      if (id !== track || tick !== seen) {
        if (id !== track) { bands.reset(); energy.reset() }
        track = id; seen = tick
        const raw = rawOf(id)
        p = prep(raw); g = grid(raw)
      }
      // The bar alone, or with the dock it sits on (phone, while the dock is up).
      const r = el.getBoundingClientRect(), d = dock()
      const joined = !!d && d.width > 0 && d.top < window.innerHeight && Math.abs(d.top - r.bottom) < 3
      const x = r.left, y = r.top, w = r.width, h = (joined ? d.bottom : r.bottom) - r.top
      const dpr = window.devicePixelRatio || 1
      const k = `${x},${y},${w},${h},${dpr}`
      if (k !== key) {
        key = k
        Object.assign(cv.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
        cv.width = off.canvas.width = Math.round(w * dpr)
        cv.height = off.canvas.height = Math.round(h * dpr)
        shape = { w, h, rt: RADIUS, rb: RADIUS }
        pts = perimeter(shape)
      }
      // Track time as heard: the sound trails the queue clock by the engine's lookahead.
      const t = Math.max(0, positionNow(q, clockSkew(), Date.now(), duration || Infinity) - engine.lag)
      const playing = q.playing && !still.matches
      calm += ((playing ? 0 : 1) - calm) * (still.matches ? 1 : tc(dt, 1000))
      const look = getLook(), an = engine.analyser
      if (an) engine.setLead(lightLead(an, look.s, engine.spk))
      energy.step(g, t, q.playing, dt, look.s)
      const { p: s } = bend({ ...look.s }, energy.I, g?.bl ?? 0.5)
      if (s.nb !== nb) { nb = s.nb; bands.reset() }
      let bins: Uint8Array | null = null
      if (an && playing) {
        if (Math.abs(an.smoothingTimeConstant - s.sm) > 0.005) an.smoothingTimeConstant = s.sm
        if (fq.length !== an.frequencyBinCount) fq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(fq)
        bins = fq
      }
      bands.update(bins, an?.context.sampleRate ?? 44100, dt, s)
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      off.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(c, off, shape, pts, { levels: bands.SE.subarray(0, nb), energy: energy.I, calm, progress: duration ? Math.min(1, t / duration) : 0, env: p })
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [bar])

  return <canvas ref={ref} aria-hidden="true" className="fixed pointer-events-none z-[41] mix-blend-screen" />
}
