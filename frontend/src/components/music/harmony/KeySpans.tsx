import { useEffect, useRef } from 'react'
import type { Reading } from '../crates/proximity'
import { drawJoin, drawPair, PAIR_SLOTS, PANEL_W, VERDICT_AT } from '../harmonyListen'

/** Seconds a slide takes to settle (shared notes lit, verdict shown). */
const SETTLE = VERDICT_AT + 0.5

/** A canvas that runs `paint(t)` from 0 to SETTLE seconds each time `run` changes, then paints the rest state; at rest with `still` or while `run` is 0. */
function useSlide(paint: (x: CanvasRenderingContext2D, t: number, w: number) => void, run: unknown, still: boolean) {
  const cv = useRef<HTMLCanvasElement>(null)
  const draw = useRef(paint)
  useEffect(() => { draw.current = paint })
  useEffect(() => {
    const frame = (t: number) => {
      const c = cv.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      const x = c.getContext('2d')
      if (!x) return
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      x.clearRect(0, 0, w, h)
      draw.current(x, t, w)
    }
    if (still || run === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) { frame(Infinity); return }
    const t0 = performance.now()
    let id = 0
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      frame(t >= SETTLE ? Infinity : t)
      if (t < SETTLE) id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [run, still])
  return cv
}

/** The join panel with note names, at `s` times the timeline's: the outgoing key's notes over the incoming ones sliding
 *  into place, the shared notes, the verdict. Plays its slide when it mounts; as wide as its container (the verdict runs past the cells). */
export function JoinSpans({ a, b, verdict, s = 1.4 }: { a: Reading; b: Reading; verdict: { label: string; color: string } | null; s?: number }) {
  const cv = useSlide((x, t) => drawJoin(x, 8 * s, 16 * s, s, a, b, { heard: [], land: 1, t }, verdict, true, false), `${a.tonic} ${a.mode}>${b.tonic} ${b.mode}`, false)
  return <canvas ref={cv} role="img" aria-label={`${a.tonic} ${a.mode} into ${b.tonic} ${b.mode}: the notes they share`} style={{ minWidth: PANEL_W * s, height: 54 * s }} className="block w-full" />
}

/** A small pair of runs (cell `cw` px): how far the incoming key moves from the outgoing one. Slides when it mounts and each time
 *  `replay` changes; a `replay` of 0 shows it at rest. */
export function PairSpans({ a, b, cw = 3, replay, still = false }: { a: Reading; b: Reading; cw?: number; replay?: unknown; still?: boolean }) {
  const rh = Math.max(3, cw)
  const cv = useSlide((x, t) => drawPair(x, 0, 0.5, cw, rh, 3, a, b, t), replay, still)
  return <canvas ref={cv} aria-hidden="true" style={{ width: PAIR_SLOTS * cw, height: 2 * rh + 4 }} className="block shrink-0" />
}
