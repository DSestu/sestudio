import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clockSkew, getQueue, positionNow, queueActions, type QueueState, type TrackInfo } from '../../../musicQueue'
import { claimSound, engine, useSyncStatus } from '../engine'
import { loadAnalyses, mixOf, rawOf, RETRY_MS, trackOf } from '../mix/analysis'
import { plan } from '../mix/plan'
import MixPopover from '../mix/Popover'
import { PALETTES, TIMELINE_PALETTE, type PaletteName } from './palette'
import { TimelineRenderer, type LabelItem } from './render'
import { layoutQueue, trackAt, type Span, type Track } from './sampling'

// The whole queue as one bass, mids and highs timeline (SPEC-music-player §6).

interface Model {
  q: QueueState
  items: LabelItem[]
  /** Where each track should start on the global axis, and its audible span; the drawn ones ease toward them. */
  TS: number[]
  spans: Span[]
  /** Queue index of each layout item. */
  rows: number[]
  /** Layout index of the playing track, -1 when none. */
  cur: number
}

/** The layout settles over this long when a plan changes (a time constant). */
const MORPH = 0.1

function buildModel(q: QueueState, info: (id: string) => TrackInfo | undefined): Model {
  const tracks: Track[] = []
  const rows: number[] = []
  q.items.forEach((it, i) => {
    const dur = info(it.track_id)?.duration || (rawOf(it.track_id)?.bands?.[0]?.length ?? 0) / 10
    if (dur <= 0) return
    tracks.push(trackOf(it.track_id, dur))
    rows.push(i)
  })
  const { TS, spans, plans } = layoutQueue(tracks, (a, b) => plan(a, b, mixOf(q, a.id, b.id)))
  const items = tracks.map((track, i): LabelItem => ({
    track, span: spans[i], a: 0, sc: 1, hl: 0, title: info(track.id)?.title ?? '', plan: plans[i - 1],
  }))
  return { q, items, TS, spans, rows, cur: rows.indexOf(q.current) }
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
  const [open, setOpen] = useState<{ a: string; b: string; x: number; above: number } | null>(null)
  const ids = q.items.map(i => i.track_id).join(',')

  useEffect(() => {
    const run = () => { void loadAnalyses(ids.split(',').filter(Boolean)).then(c => c && setVersion(v => v + 1)) }
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

    const shown = { ts: [] as number[], spans: [] as Span[] }

    // A press on a label's second line opens its transition.
    const root = cv.closest<HTMLElement>('[role=dialog]') ?? document.body
    const labelAt = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, input, [role=slider], [data-queue], [data-mix-popover]')) return null
      const b = cv.getBoundingClientRect()
      const h = r.labelAt(e.clientX - b.left, e.clientY - b.top)
      return h?.second ? { ...h, left: b.left, top: b.top } : null
    }
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-mix-popover]')) return
      const h = labelAt(e)
      const m = live.current.model
      if (h && m.items[h.i]) {
        setOpen({ a: m.items[h.i - 1].track.id, b: m.items[h.i].track.id, x: h.left + h.x0, above: h.top + h.ty - 14 })
      } else setOpen(null)
    }
    const move = (e: PointerEvent) => { root.style.cursor = labelAt(e) ? 'pointer' : '' }
    root.addEventListener('pointerdown', down)
    root.addEventListener('pointermove', move)

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
      // The drawn layout eases toward the planned one, so a changed plan moves the joins.
      const n = m.items.length
      const snap = shown.ts.length !== n || still.matches
      const em = snap ? 1 : 1 - Math.exp(-dt / MORPH)
      shown.ts.length = n
      for (let i = 0; i < n; i++) {
        const to = m.spans[i]
        const sp = (shown.spans[i] ??= { ...to })
        if (snap) {
          shown.ts[i] = m.TS[i]
          Object.assign(sp, to)
        } else {
          shown.ts[i] += (m.TS[i] - shown.ts[i]) * em
          for (const f of ['i0', 'il', 'o0', 'ol'] as const) sp[f] += (to[f] - sp[f]) * em
        }
        m.items[i].span = sp
      }
      const cur = m.items[m.cur]
      const G = shown.ts[m.cur] + positionNow(m.q, clockSkew(), Date.now(), cur.track.dur)
      const k = trackAt(shown.ts, G)
      const ez = 1 - Math.exp(-dt / 0.12)
      m.items.forEach((it, i) => {
        it.a = shown.ts[i] - G
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
    return () => {
      cancelAnimationFrame(hid)
      ro.disconnect()
      root.removeEventListener('pointerdown', down)
      root.removeEventListener('pointermove', move)
      root.style.cursor = ''
    }
  }, [])

  const sync = useSyncStatus()
  const close = useCallback(() => setOpen(null), [])
  // The popover follows the pair through queue changes; it goes when either track does.
  const at = open ? model.items.findIndex((it, i) => i > 0 && model.items[i - 1].track.id === open.a && it.track.id === open.b) : -1
  const hear = (i: number, position: number) => {
    const { q: now } = model
    const item = now.items[model.rows[i - 1]]
    claimSound()
    engine.unlock()
    const go = item.item_id === now.items[now.current]?.item_id ? Promise.resolve() : queueActions.play(item.item_id)
    void go.then(() => queueActions.transport('play', { position })).then(() => engine.seek(position))
  }

  return (
    <>
      <canvas ref={canvas} aria-hidden="true" className="fixed inset-0 -z-10 size-full pointer-events-none" />
      {open && at > 0 && (
        <MixPopover
          a={{ track: model.items[at - 1].track, title: model.items[at - 1].title }}
          b={{ track: model.items[at].track, title: model.items[at].title }}
          plan={model.items[at].plan!}
          settings={mixOf(model.q, open.a, open.b)}
          defaultMix={model.q.default_mix}
          sync={sync}
          x={open.x}
          above={open.above}
          onClose={close}
          onHear={() => hear(at, Math.max(0, model.items[at].plan!.mixOut - 8))}
        />
      )}
    </>
  )
}
