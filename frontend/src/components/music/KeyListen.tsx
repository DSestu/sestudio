import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { Reading } from './crates/proximity'
import { drawStrip, phaseOf, snapshot, subscribe } from './harmonyListen'

/** A queue row's notes while its key is measured, then the key's run; `fallback` (the meter) the rest of the time. */
export default function KeyListen({ id, reading, fallback }: { id: string; reading?: Reading; fallback?: ReactNode }) {
  useSyncExternalStore(subscribe, snapshot)
  const cv = useRef<HTMLCanvasElement>(null)
  const live = phaseOf(id, reading) !== null
  const read = useRef(reading)
  useEffect(() => { read.current = reading }, [reading])
  useEffect(() => {
    if (!live) return
    // A few seconds of drawing, 12 cells: a small 2D canvas, stopped as soon as the step is over.
    let raf = 0
    const draw = () => {
      const c = cv.current
      const ph = phaseOf(id, read.current)
      if (!c || !ph) return
      const dpr = window.devicePixelRatio || 1
      const W = c.clientWidth
      const H = c.clientHeight
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
      }
      const x = c.getContext('2d')!
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      x.clearRect(0, 0, W, H)
      drawStrip(x, 2, H - 6, 1, ph, ph.land > 0 ? read.current : undefined)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [id, live])
  if (!live) return fallback ?? null
  return <canvas ref={cv} aria-hidden="true" className="relative shrink-0 w-[76px] h-[30px]" />
}
