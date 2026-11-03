import { useEffect, useMemo, useRef, useState } from 'react'
import { clockSkew, getQueue, positionNow, type QueueState, type TrackInfo } from '../../../musicQueue'
import { engine } from '../engine'
import { PALETTES, TIMELINE_PALETTE, type PaletteName } from './palette'
import { TimelineRenderer, type LabelItem } from './render'
import { layoutQueue, prepTrack, trackAt, type RawAnalysis, type Track } from './sampling'

// The whole queue as one bass, mids and highs timeline (SPEC-music-player §6).

const URL = '/api/music/tracks/analysis'
/** Tracks the server had no analysis for are asked again after this long. */
const RETRY_MS = 15_000
const CHUNK = 40

// Shared by every mount: id -> the server's analysis, or null while there is none.
const cache = new Map<string, { raw: RawAnalysis | null; at: number }>()

async function load(ids: string[]): Promise<boolean> {
  const now = Date.now()
  const want = ids.filter(id => {
    const c = cache.get(id)
    return !c || (!c.raw && now - c.at > RETRY_MS)
  })
  for (const id of want) cache.set(id, { raw: cache.get(id)?.raw ?? null, at: now })
  let changed = false
  for (let i = 0; i < want.length; i += CHUNK) {
    const chunk = want.slice(i, i + CHUNK)
    try {
      const res = await fetch(`${URL}?ids=${encodeURIComponent(chunk.join(','))}`)
      if (!res.ok) continue
      const found: Record<string, RawAnalysis> = await res.json()
      for (const id of chunk) if (found[id]) { cache.set(id, { raw: found[id], at: now }); changed = true }
    } catch {
      // Offline or restarting: the retry picks it up.
    }
  }
  return changed
}

interface Model {
  q: QueueState
  items: LabelItem[]
  TS: number[]
  /** Layout index of the playing track, -1 when none. */
  cur: number
}

function buildModel(q: QueueState, info: (id: string) => TrackInfo | undefined): Model {
  const tracks: Track[] = []
  const rows: number[] = []
  q.items.forEach((it, i) => {
    const raw = cache.get(it.track_id)?.raw
    const dur = info(it.track_id)?.duration || (raw?.bands?.[0]?.length ?? 0) / 10
    if (dur <= 0) return
    tracks.push(prepTrack(it.track_id, dur, raw))
    rows.push(i)
  })
  const { TS, spans, plans } = layoutQueue(tracks)
  const items = tracks.map((track, i): LabelItem => ({
    track, span: spans[i], a: 0, sc: 1, hl: 0, title: info(track.id)?.title ?? '', plan: plans[i - 1],
  }))
  return { q, items, TS, cur: rows.indexOf(q.current) }
}

export default function Timeline({ q, info, progress = 0, palette = TIMELINE_PALETTE }: {
  q: QueueState
  info: (id: string) => TrackInfo | undefined
  /** Mode progress, 0 default, 1 expanded. */
  progress?: number
  palette?: PaletteName
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [version, setVersion] = useState(0)
  const ids = q.items.map(i => i.track_id).join(',')

  useEffect(() => {
    const run = () => { void load(ids.split(',').filter(Boolean)).then(c => c && setVersion(v => v + 1)) }
    run()
    const id = window.setInterval(run, RETRY_MS)
    return () => window.clearInterval(id)
  }, [ids])

  // Titles arrive later than the queue, so they count too.
  const titles = q.items.map(i => info(i.track_id)?.title ?? '').join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildModel(q, info), [q.rev, ids, titles, version])
  const live = useRef({ model, progress, palette })
  useEffect(() => { live.current = { model, progress, palette } })

  useEffect(() => {
    const cv = canvas.current!
    const r = new TimelineRenderer(cv)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    let bins = new Uint8Array(0)
    let level = 0
    let hid = 0
    let last = performance.now()
    let avoid: DOMRect | null = null
    let avoidAt = -1e9
    const fit = () => r.resize(cv.clientWidth, cv.clientHeight, window.devicePixelRatio)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv)

    let slow = 0
    let seen = 0
    const frame = (now: number) => {
      hid = requestAnimationFrame(frame)
      const raw = now - last
      const dt = Math.min(0.1, raw / 1000)
      // A device that cannot keep ~40 fps renders at a lower pixel density.
      if (raw < 200 && ++seen > 30) slow += raw
      if (seen === 120) {
        if (slow / 90 > 25 && r.maxDpr > 1) { r.maxDpr -= 0.5; fit() }
        slow = seen = 0
      }
      last = now
      const { model: m, progress: t, palette: pal } = live.current
      if (m.cur < 0) { r.draw({ items: [], G: 0, t, level: 0, palette: PALETTES[pal], avoid: null }); return }
      const cur = m.items[m.cur]
      const G = m.TS[m.cur] + positionNow(m.q, clockSkew(), Date.now(), cur.track.dur)
      const k = trackAt(m.TS, G)
      const ez = 1 - Math.exp(-dt / 0.12)
      m.items.forEach((it, i) => {
        it.a = m.TS[i] - G
        it.hl += ((i === k ? 1 : 0) - it.hl) * ez
      })
      const an = engine.analyser
      if (an && getQueue().playing && !still.matches) {
        if (bins.length !== an.frequencyBinCount) bins = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(bins)
        let s = 0
        for (let i = 8; i < 192; i++) s += bins[i]
        level = level * 0.7 + (s / 184 / 255) * 0.3
      } else level *= 0.95
      if (now - avoidAt > 250) {
        avoidAt = now
        avoid = document.querySelector('[data-queue]')?.getBoundingClientRect() ?? null
      }
      r.draw({ items: m.items, G, t, level, palette: PALETTES[pal], avoid })
    }
    hid = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(hid); ro.disconnect() }
  }, [])

  return <canvas ref={canvas} aria-hidden="true" className="fixed inset-0 -z-10 size-full pointer-events-none" />
}
