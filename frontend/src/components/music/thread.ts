import { useEffect, useRef } from 'react'
import { rawOf } from './mix/analysis'
import type { RawAnalysis } from './timeline/sampling'

// The energy thread: a colour per bar from the track's energy, against the rest of the
// queue, with a gap where its sections change and a height by section kind.

// The timeline's Reef palette (timeline/palette.ts): lo, mi, hi, edge.
const REEF: [number, number, number, number][] = [[0, 44, 0.11, 215], [0.5, 74, 0.13, 188], [0.9, 90, 0.13, 155], [1, 97, 0.07, 155]]
const HEIGHT: Record<string, number> = { intro: 0.45, outro: 0.45, breakdown: 0.45, buildup: 0.7, drop: 1 }
const GAP = 1.5

export function reef(v: number, a = 1) {
  v = Math.max(0, Math.min(1, v))
  let i = 0
  while (i < REEF.length - 2 && v > REEF[i + 1][0]) i++
  const [p0, l0, c0, h0] = REEF[i], [p1, l1, c1, h1] = REEF[i + 1], f = (v - p0) / (p1 - p0)
  return `oklch(${l0 + (l1 - l0) * f}% ${c0 + (c1 - c0) * f} ${h0 + (h1 - h0) * f} / ${a})`
}

export interface Range { lo: number; hi: number }

let memo: { key: string; range: Range | null } = { key: '', range: null }
/** The queue's own scale, its bars' 5th and 95th percentiles: a colour compares a track with this set. */
export function rangeOf(ids: string[]): Range | null {
  const raws = ids.map(rawOf)
  const key = ids.join(',') + raws.filter(Boolean).length
  if (key === memo.key) return memo.range
  const all = raws.flatMap(r => r?.energy ?? []).sort((a, b) => a - b)
  const range = all.length ? { lo: all[Math.floor(all.length * 0.05)], hi: all[Math.floor(all.length * 0.95)] } : null
  memo = { key, range }
  return range
}

/** Energy per bar over five bars, so the thread reads as phrases rather than flicker. */
const smooth = (e: number[]) => e.map((_, i) => {
  let a = 0, n = 0
  for (let j = i - 2; j <= i + 2; j++) if (e[j] != null) { a += e[j]; n++ }
  return a / n
})

/** Draw the first `dur` seconds of a track between x0 and x0 + w; bars after `lit` seconds are dimmed. False without the analysis. */
export function drawThread(g: CanvasRenderingContext2D, raw: RawAnalysis | null | undefined, dur: number, r: Range, x0: number, w: number, h: number, lit?: number, dim = 0.3) {
  const en = raw?.energy
  if (!raw?.bpm || !en?.length || !dur) return false
  const e = smooth(en), bl = 240 / raw.bpm, bar0 = raw.bar0 ?? 0, px = w / dur
  const segs = raw.structure?.length ? raw.structure : [{ label: '', start_bar: 0, end_bar: e.length }]
  for (const s of segs) {
    const hh = h * (HEIGHT[s.label] ?? 0.6)
    for (let j = s.start_bar; j < Math.min(s.end_bar, e.length); j++) {
      const t0 = bar0 + j * bl
      if (t0 >= dur) return true
      const gap = j === s.start_bar && j > 0 ? GAP : 0
      const v = (e[j] - r.lo) / Math.max(1, r.hi - r.lo)
      g.fillStyle = reef(v, lit === undefined || t0 < lit ? 1 : dim)
      g.fillRect(x0 + t0 * px + gap, h - hh, Math.min(bl, dur - t0) * px - gap + 0.4, hh)
    }
  }
  return true
}

/** A canvas as wide as its box, redrawn by `draw` whenever `deps` change or the box resizes. */
export function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const run = () => {
      const { width: w, height: h } = c.getBoundingClientRect(), dpr = devicePixelRatio || 1
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      draw(g, w, h)
    }
    run()
    const ro = new ResizeObserver(run)
    ro.observe(c)
    return () => ro.disconnect()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}
