import { useEffect, useMemo, useRef, useState } from 'react'
import { clockSkew, getQueue, onQueueEvent, positionNow, type QueueState, type TrackInfo } from '../../../musicQueue'
import { engine } from '../engine'
import { bez, crossed, dipScale, flash, MORPH_MS, morphOffsets, stepHl } from '../interact'
import { registerScrubber, Scrubber } from '../scrub'
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
  /** Queue item id of each laid-out track. */
  ids: string[]
  /** The last position the view may reach (.5 s before the end of the last track). */
  end: number
  /** Layout index of the playing track, -1 when none. */
  cur: number
}

function buildModel(q: QueueState, info: (id: string) => TrackInfo | undefined): Model {
  const tracks: Track[] = []
  const rows: number[] = []
  const ids: string[] = []
  q.items.forEach((it, i) => {
    const raw = cache.get(it.track_id)?.raw
    const dur = info(it.track_id)?.duration || (raw?.bands?.[0]?.length ?? 0) / 10
    if (dur <= 0) return
    tracks.push(prepTrack(it.track_id, dur, raw))
    rows.push(i)
    ids.push(it.item_id)
  })
  const { TS, spans, plans } = layoutQueue(tracks)
  const items = tracks.map((track, i): LabelItem => ({
    track, span: spans[i], a: 0, sc: 1, hl: 0, title: info(track.id)?.title ?? '', plan: plans[i - 1],
  }))
  const last = tracks.length - 1
  return { q, items, TS, ids, end: last < 0 ? 0 : TS[last] + tracks[last].dur - 0.5, cur: rows.indexOf(q.current) }
}

/** How the drawn queue eases into a new one after an add, a remove or a move (SPEC-music-player §7.7). */
interface Morph {
  t0: number
  /** Item id -> seconds the track lags behind its new place. */
  off: Map<string, number>
  grow: Set<string>
  moved?: string
  /** Removed tracks, shrinking at their old place. rel: seconds from the playing track's start. */
  ghosts: { item: LabelItem; rel: number }[]
}

const differs = (a: string[], b: string[]) => a.length !== b.length || a.some((x, i) => x !== b[i])

function makeMorph(before: Model, after: Model, moved: string | undefined, t0: number): Morph {
  const rel = (m: Model) => new Map(m.ids.map((id, i) => [id, m.TS[i] - m.TS[Math.max(0, m.cur)]]))
  const was = rel(before)
  const now = rel(after)
  return {
    t0,
    off: morphOffsets(was, now),
    grow: new Set(after.ids.filter(id => !was.has(id))),
    moved: before.ids.length === after.ids.length ? moved : undefined,
    ghosts: before.ids.flatMap((id, i) => (now.has(id) ? [] : [{ item: before.items[i], rel: was.get(id)! }])),
  }
}

const rowHl = new WeakMap<Element, number>()

/** The queue rows follow the highlight: `--hl` is the row's own, the rows above the track under the view are "played". */
function paintRows(queueEl: Element | null, m: Model, k: number) {
  if (!queueEl) return
  const at = new Map(m.ids.map((id, i) => [id, i]))
  queueEl.querySelectorAll<HTMLElement>('[data-item]').forEach(row => {
    const i = at.get(row.dataset.item!)
    if (i === undefined) return
    const hl = m.items[i].hl
    if (Math.abs((rowHl.get(row) ?? -1) - hl) > 0.003) {
      rowHl.set(row, hl)
      row.style.setProperty('--hl', hl.toFixed(3))
    }
    const played = i < k ? '1' : '0'
    if (row.dataset.played !== played) row.dataset.played = played
  })
}

export default function Timeline({ q, info, progress = 0, palette = TIMELINE_PALETTE, onOutside }: {
  q: QueueState
  info: (id: string) => TrackInfo | undefined
  /** A press on the timeline outside the scrub band. */
  onOutside?: () => void
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
  const live = useRef({ model, progress, palette, onOutside })
  useEffect(() => { live.current = { model, progress, palette, onOutside } })

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
    let queueEl: Element | null = null
    let seenModel: Model | null = null
    let morph: Morph | null = null
    let movedId: string | undefined
    let lastG: number | null = null
    const scrub = new Scrubber({
      root: (cv.closest('[role="dialog"]') as HTMLElement | null) ?? document.body,
      r,
      model: () => (live.current.model.items.length ? live.current.model : null),
      progress: () => live.current.progress,
      outside: () => live.current.onOutside?.(),
    })
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
      if (m !== seenModel) {
        if (seenModel && seenModel.items.length && m.items.length && differs(seenModel.ids, m.ids)) {
          morph = makeMorph(seenModel, m, movedId, now)
        }
        if (seenModel) {
          // The highlight survives a rebuild of the layout.
          const old = new Map(seenModel.ids.map((id, i) => [id, seenModel!.items[i].hl]))
          m.items.forEach((it, i) => { it.hl = old.get(m.ids[i]) ?? 0 })
        }
        movedId = undefined
        lastG = null
        seenModel = m
      }
      if (m.cur < 0) { r.draw({ items: [], G: 0, t, level: 0, palette: PALETTES[pal], avoid: null }); return }
      const cur = m.items[m.cur]
      const nowG = m.TS[m.cur] + positionNow(m.q, clockSkew(), Date.now(), cur.track.dur)
      const G = scrub.frame(now, nowG)
      const k = trackAt(m.TS, G)
      if (lastG !== null) flash(m.items, crossed(m.TS, lastG, G))
      lastG = G
      const me = morph ? bez(Math.min(1, (now - morph.t0) / MORPH_MS)) : 1
      m.items.forEach((it, i) => {
        const id = m.ids[i]
        it.a = m.TS[i] - G + (morph ? (morph.off.get(id) ?? 0) * (1 - me) : 0)
        it.sc = morph ? (morph.grow.has(id) ? me : id === morph.moved ? dipScale(me) : 1) : 1
        it.hl = stepHl(it.hl, i === k ? 1 : 0, dt)
      })
      let items = m.items
      if (morph) {
        const pos = G - m.TS[m.cur]
        items = [...items, ...morph.ghosts.map(g => ({ ...g.item, a: g.rel - pos, sc: 1 - me, plan: undefined }))]
        if (me >= 1) morph = null
      }
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
        queueEl = document.querySelector('[data-queue]')
        avoid = queueEl?.getBoundingClientRect() ?? null
      }
      paintRows(queueEl, m, k)
      r.draw({ items, G, t, level, palette: PALETTES[pal], avoid, hover: scrub.hovered })
    }
    hid = requestAnimationFrame(frame)
    const dropScrub = scrub.attach()
    registerScrubber(scrub)
    // Another screen's move names the row that moved, so it dips like a local one.
    const dropEvents = onQueueEvent(ev => { if (ev.op === 'mv') movedId = ev.item_id as string })
    return () => { cancelAnimationFrame(hid); ro.disconnect(); dropScrub(); registerScrubber(null); dropEvents() }
  }, [])

  return <canvas ref={canvas} aria-hidden="true" className="fixed inset-0 -z-10 size-full pointer-events-none" />
}
