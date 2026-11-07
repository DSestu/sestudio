import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSummaries, type Summary } from '../../../musicMeta'
import { clockSkew, getQueue, onQueueEvent, positionNow, queueActions, type QueueState, type TrackInfo } from '../../../musicQueue'
import { addTracks } from '../adding'
import { claimSound, engine, useSyncStatus } from '../engine'
import { fmtTime } from '../format'
import { frameLoop, wake } from '../idle'
import { join as joinOf, joinColor, type ProxTrack } from '../crates/proximity'
import { joins, type Join } from '../joins'
import { bez, crossed, dipScale, flash, MORPH_MS, morphOffsets, stepHl } from '../interact'
import { analysing, loadAnalyses, mixOf, PARTIAL_MS, rawOf, RETRY_MS, trackOf } from '../mix/analysis'
import { plan } from '../mix/plan'
import MixPopover from '../mix/Popover'
import { barPos, registerScrubber, Scrubber } from '../scrub'
import { PALETTES, TIMELINE_PALETTE, type PaletteName } from './palette'
import { phaseOf } from '../harmonyListen'
import { COUNT_IN, DOCK, LOCK_END, quint, SEEN, TimelineRenderer, type LabelItem } from './render'
import { layoutQueue, trackAt, type Span, type Track } from './sampling'

// The whole queue as one bass, mids and highs timeline (SPEC-music-player §6).

interface Model {
  q: QueueState
  items: LabelItem[]
  /** Where each track should start on the global axis, and its audible span; the drawn ones ease toward them. */
  TS: number[]
  /** Queue item id of each laid-out track. */
  ids: string[]
  /** The last position the view may reach (.5 s before the end of the last track). */
  end: number
  spans: Span[]
  /** Queue index of each layout item. */
  rows: number[]
  /** Layout index of the playing track, -1 when none. */
  cur: number
}

const proxOf = (id: string, s?: Summary): ProxTrack => ({ id, bpm: s?.bpm, camelot: s?.camelot, genre: s?.genre, harmony: s?.harmony, energyScale: s?.energyScale })

const joinTone = (a: ProxTrack, b: ProxTrack) => {
  const j = joinOf(a, b)
  return j.kind ? joinColor(j) : undefined
}

/** The join's kind and colour, for its notes panel. */
const joinVerdict = (a: ProxTrack, b: ProxTrack) => {
  const j = joinOf(a, b)
  return j.kind && j.kindLabel ? { label: j.kindLabel, color: joinColor(j) } : null
}

function buildModel(q: QueueState, info: (id: string) => TrackInfo | undefined, summary: (id: string) => Summary | undefined): Model {
  const tracks: Track[] = []
  const rows: number[] = []
  const ids: string[] = []
  q.items.forEach((it, i) => {
    const dur = info(it.track_id)?.duration || (rawOf(it.track_id)?.bands?.[0]?.length ?? 0) / 10
    if (dur <= 0) return
    tracks.push(trackOf(it.track_id, dur))
    rows.push(i)
    ids.push(it.item_id)
  })
  const { TS, spans, plans } = layoutQueue(tracks, (a, b) => plan(a, b, mixOf(q, a.id, b.id)))
  const items = tracks.map((track, i): LabelItem => ({
    track, span: spans[i], a: 0, sc: 1, hl: 0, title: info(track.id)?.title ?? '', plan: plans[i - 1],
    tone: i && summary(track.id) && summary(tracks[i - 1].id) ? joinTone(proxOf(tracks[i - 1].id, summary(tracks[i - 1].id)), proxOf(track.id, summary(track.id))) : undefined,
    reading: summary(track.id)?.harmony?.track,
    prevReading: i ? summary(tracks[i - 1].id)?.harmony?.track : undefined,
    verdict: i && summary(track.id) && summary(tracks[i - 1].id) ? joinVerdict(proxOf(tracks[i - 1].id, summary(tracks[i - 1].id)), proxOf(track.id, summary(track.id))) : null,
  }))
  const last = tracks.length - 1
  return { q, items, TS, spans, rows, ids, end: last < 0 ? 0 : TS[last] + tracks[last].dur - 0.5, cur: rows.indexOf(q.current) }
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
/** Each row with its layout index, looked up again only when the model, the sheet or its rows change. */
let rowCache: { m: Model | null; el: Element | null; rows: [HTMLElement, number][] } = { m: null, el: null, rows: [] }

/** The queue rows follow the highlight: `--hl` is the row's own, the rows above the track under the view are "played". */
function paintRows(queueEl: Element | null, m: Model, k: number) {
  if (!queueEl) return
  const c = rowCache
  // A remounted list (the phone's Library tab and back) keeps the model but has new rows.
  if (c.m !== m || c.el !== queueEl || !c.rows.length || !c.rows[0][0].isConnected) {
    const at = new Map(m.ids.map((id, i) => [id, i]))
    const rows: [HTMLElement, number][] = []
    queueEl.querySelectorAll<HTMLElement>('[data-item]').forEach(row => {
      const i = at.get(row.dataset.item!)
      if (i !== undefined) rows.push([row, i])
    })
    rowCache = { m, el: queueEl, rows }
  }
  for (const [row, i] of rowCache.rows) {
    const hl = m.items[i].hl
    if (Math.abs((rowHl.get(row) ?? -1) - hl) > 0.003) {
      rowHl.set(row, hl)
      row.style.setProperty('--hl', hl.toFixed(3))
    }
    const played = i < k ? '1' : '0'
    if (row.dataset.played !== played) row.dataset.played = played
  }
}

const MARKS = 7
/** Seconds the drawn analysis front takes over a whole track, at the slowest. */
const REVEAL = 2.5

export default function Timeline({ q, info, progress = () => 0, palette = TIMELINE_PALETTE, onOutside, marks = false, aim = null, onAim }: {
  q: QueueState
  info: (id: string) => TrackInfo | undefined
  /** A press on the timeline outside the scrub band. */
  onOutside?: () => void
  /** Adding: the joins after the playing track show as targets ("Next", then +). */
  marks?: boolean
  /** The queue index the next add goes to, when one was picked. */
  aim?: number | null
  onAim?: (at: number) => void
  /** Mode progress, 0 default, 1 expanded. */
  progress?: () => number
  palette?: PaletteName
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLCanvasElement>(null)
  const markEls = useRef<(HTMLButtonElement | null)[]>([])
  const slotEl = useRef<HTMLDivElement>(null)
  const slotLabel = useRef<HTMLDivElement>(null)
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState<{ a: string; b: string; x: number; above: number } | null>(null)
  const ids = q.items.map(i => i.track_id).join(',')

  useEffect(() => {
    const list = ids.split(',').filter(Boolean)
    let id = 0
    let live = true
    // Asked again soon while the server is analysing one of them, so its bands draw as they come.
    const run = () => {
      void loadAnalyses(list).then(c => {
        if (!live) return
        if (c) setVersion(v => v + 1)
        id = window.setTimeout(run, analysing(list) ? PARTIAL_MS : RETRY_MS)
      })
    }
    run()
    return () => { live = false; window.clearTimeout(id) }
  }, [ids])

  // Titles arrive later than the queue, so they count too. The current track too: on the TV page it
  // follows the station's clock, which reaches the next track after the queue's revision did.
  const titles = q.items.map(i => info(i.track_id)?.title ?? '').join('\n')
  const sums = useSummaries(useMemo(() => ids.split(',').filter(Boolean), [ids]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildModel(q, info, sums.get), [q.rev, q.current, ids, titles, version, sums.v])
  const live = useRef({ model, progress, palette, onOutside, marks, aim })
  // Any render may carry a change the loop should draw (queue, mode, look).
  useEffect(() => {
    live.current = { model, progress, palette, onOutside, marks, aim }
    wake()
  })

  useEffect(() => {
    // The text canvas spans the viewport; the WebGL one only the curves' band, which it follows.
    const cv = text.current!
    const r = new TimelineRenderer(canvas.current!, cv)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    let bins = new Uint8Array(0)
    let level = 0
    let last = performance.now()
    let avoid: DOMRect | null = null
    let avoidAt = -1e9
    let queueEl: Element | null = null
    let seenModel: Model | null = null
    let morph: Morph | null = null
    let movedId: string | undefined
    let lastG: number | null = null
    /** A changed plan glides the drawn layout from where it was to the new one. */
    let tween: { t0: number; ts: number[]; spans: Span[]; ms: number; ease: (x: number) => number } | null = null
    /** Track id -> when its tempo arrived while shown (ms): its count-in, dock and lock play from then. */
    const landed = new Map<string, number>()
    /** Item ids of the joins whose notes panel is open (a tap on the diamond). */
    const opened = new Set<string>()
    const scrub = new Scrubber({
      root: (cv.closest('[role="dialog"]') as HTMLElement | null) ?? document.body,
      r,
      model: () => { const m = live.current.model; return m.items.length ? { TS: shown.ts, ids: m.ids, end: m.end } : null },
      progress: () => live.current.progress(),
      outside: () => live.current.onOutside?.(),
    })
    const fit = () => {
      r.resize(cv.clientWidth, cv.clientHeight, window.devicePixelRatio)
      wake()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv)

    const shown = { ts: [] as number[], spans: [] as Span[] }

    // A press on a label opens its transition (a double tap jumps to the track, scrub.ts).
    const root = cv.closest<HTMLElement>('[role=dialog]') ?? document.body
    const labelAt = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, input, [role=slider], [data-queue], [data-mix-popover]')) return null
      const b = cv.getBoundingClientRect()
      const h = r.labelAt(e.clientX - b.left, e.clientY - b.top)
      return h ? { ...h, left: b.left, top: b.top } : null
    }
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-mix-popover]')) return
      // A tap on a join's diamond opens (or closes) what the two keys share.
      if (!(e.target as HTMLElement).closest('button, input, [role=slider], [data-queue]')) {
        const b = cv.getBoundingClientRect()
        const j = r.joinAt(e.clientX - b.left, e.clientY - b.top)
        const id = j === null ? undefined : live.current.model.ids[j]
        const was = id !== undefined && opened.has(id)
        opened.clear()
        if (id !== undefined && !was) opened.add(id)
        wake()
        if (j !== null) return
      }
      const h = labelAt(e)
      const m = live.current.model
      if (h && m.items[h.i]) {
        setOpen({ a: m.items[h.i - 1].track.id, b: m.items[h.i].track.id, x: h.left + h.x0, above: h.top + h.ty - 14 })
      } else setOpen(null)
    }
    root.addEventListener('pointerdown', down)
    const poke = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'touchstart']
    for (const ev of poke) root.addEventListener(ev, wake, { passive: true })

    // The joins after the playing track: drop targets for the row drag, and the marks while adding.
    const times: number[] = []
    const placeJoins = (m: Model, G: number): boolean => {
      const M = r.M
      const list: Join[] = []
      times.length = 0
      const n = m.items.length
      for (let i = m.cur + 1; i <= n; i++) {
        const s = i < n ? m.items[i].a : m.items[n - 1].a + m.items[n - 1].track.dur
        const x = M.X(s)
        if (x < M.R.x - 1 || x > M.R.x + M.R.w + 1) continue
        list.push({ at: i < n ? m.rows[i] : m.q.items.length, x })
        times.push(i)
      }
      joins.list = list
      joins.band = M.band()
      const { marks: on, aim } = live.current
      const show = on || joins.dragging
      // Marks closer than 40 px to the last one shown are skipped (the fisheye packs the far joins); every join still takes a drop.
      const marks: Join[] = []
      if (show) for (const j of list) if (!marks.length || j.x - marks[marks.length - 1].x >= 40) marks.push(j)
      markEls.current.forEach((b, k) => {
        const j = marks[k]
        if (!b) return
        if (!j) { b.style.display = 'none'; return }
        const next = j.at === m.q.current + 1
        b.style.display = ''
        // On the horizon, like the others; the pill stays on screen when the join sits at the playhead, near the edge.
        const x = next ? Math.min(M.W - 34, Math.max(34, j.x)) : j.x
        b.style.transform = `translate(${x}px, ${M.y0}px) translate(-50%, -50%)`
        b.dataset.at = String(j.at)
        const label = next ? 'Next' : '+'
        if (b.textContent !== label) b.textContent = label
        b.setAttribute('aria-label', next ? 'Add next' : 'Add here')
        b.dataset.next = next ? '1' : '0'
        b.dataset.aimed = j.at === aim ? '1' : '0'
      })
      const slot = slotEl.current
      const k = joins.slot === null ? -1 : list.findIndex(j => j.at === joins.slot)
      if (slot) {
        slot.style.display = k < 0 ? 'none' : ''
        if (k >= 0) {
          const j = list[k]
          const i = times[k]
          slot.style.transform = `translate(${j.x - 18}px, ${M.y0 - M.amp}px)`
          slot.style.height = `${M.amp * 1.8}px`
          const after = i < n ? m.items[i - 1] : m.items[n - 1]
          const startS = i < n ? shown.ts[i] : shown.ts[n - 1] + m.items[n - 1].track.dur
          const when = Math.max(0, startS - G)
          // The label goes left of the slot near the right edge.
          slotLabel.current!.style.transform = j.x > M.W - 300 ? 'translateX(calc(-100% - 60px))' : ''
          slotLabel.current!.textContent = `${j.at === m.q.current + 1 ? 'Plays next' : `After ${after.title || 'the track before'}`} · in ${fmtTime(when)}`
        }
      }
      return show
    }

    let slow = 0
    let seen = 0
    let lastSig = ''
    // The drawn analysis front of each track being analysed: it chases the bands measured so far,
    // a whole track in REVEAL s at the slowest, then runs to the end once the analysis is done.
    const fronts = new Map<string, number>()
    const stepFront = (tr: Track, dt: number): number | undefined => {
      const to = tr.front ?? (fronts.has(tr.id) ? tr.dur : undefined)
      if (to === undefined) return undefined
      const was = fronts.get(tr.id) ?? 0
      const f = still.matches ? to : Math.min(to, was + Math.max(tr.dur / REVEAL, (to - was) * 3) * dt)
      if (tr.front === undefined && f >= tr.dur) {
        fronts.delete(tr.id)
        return undefined
      }
      fronts.set(tr.id, f)
      return f
    }
    const step = (now: number): boolean => {
      const raw = now - last
      const dt = Math.min(0.1, raw / 1000)
      // A device that cannot keep ~40 fps renders at a lower pixel density.
      if (raw < 200 && ++seen > 30) slow += raw
      if (seen === 120) {
        if (slow / 90 > 25 && r.maxDpr > 1) { r.maxDpr -= 0.5; fit() }
        slow = seen = 0
      }
      last = now
      const { model: m, progress, palette: pal } = live.current
      const t = progress()
      if (m !== seenModel) {
        if (seenModel && seenModel.items.length && m.items.length && differs(seenModel.ids, m.ids)) {
          morph = makeMorph(seenModel, m, movedId, now)
          tween = null
        } else {
          // A tempo that just arrived: its ticks are laid and the landing shown before the queue docks.
          const had = new Map(seenModel?.items.map(it => [it.track.id, it.track.bpm]) ?? [])
          let fresh = false
          for (const it of m.items) {
            if (it.track.bpm && had.has(it.track.id) && !had.get(it.track.id) && !still.matches) {
              landed.set(it.track.id, now)
              fresh = true
            }
          }
          tween = fresh
            ? { t0: now + (COUNT_IN + SEEN) * 1000, ts: [...shown.ts], spans: shown.spans.map(s => ({ ...s })), ms: DOCK * 1000, ease: quint }
            : { t0: now, ts: [...shown.ts], spans: shown.spans.map(s => ({ ...s })), ms: MORPH_MS, ease: bez }
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
      if (m.cur < 0) { r.draw({ items: [], G: 0, t, level: 0, palette: PALETTES[pal], avoid: null }); return false }
      // The drawn layout glides to the planned one, so a changed plan moves the joins and resizes the blends.
      const n = m.items.length
      const tw = tween && tween.ts.length === n && !still.matches ? tween : null
      const em = tw ? tw.ease(Math.max(0, Math.min(1, (now - tw.t0) / tw.ms))) : 1
      if (em >= 1) tween = null
      shown.ts.length = n
      for (let i = 0; i < n; i++) {
        const to = m.spans[i]
        const sp = (shown.spans[i] ??= { ...to })
        if (tw) {
          shown.ts[i] = tw.ts[i] + (m.TS[i] - tw.ts[i]) * em
          for (const f of ['i0', 'il', 'o0', 'ol'] as const) sp[f] = tw.spans[i][f] + (to[f] - tw.spans[i][f]) * em
        } else {
          shown.ts[i] = m.TS[i]
          Object.assign(sp, to)
        }
        m.items[i].span = sp
      }
      const cur = m.items[m.cur]
      const nowG = shown.ts[m.cur] + (barPos(now) ?? positionNow(m.q, clockSkew(), Date.now(), cur.track.dur) - engine.lag)
      const G = scrub.frame(now, nowG)
      const k = trackAt(shown.ts, G)
      if (lastG !== null) flash(m.items, crossed(shown.ts, lastG, G))
      lastG = G
      const me = morph ? bez(Math.min(1, (now - morph.t0) / MORPH_MS)) : 1
      m.items.forEach((it, i) => {
        const id = m.ids[i]
        it.a = shown.ts[i] - G + (morph ? (morph.off.get(id) ?? 0) * (1 - me) : 0)
        it.sc = morph ? (morph.grow.has(id) ? me : id === morph.moved ? dipScale(me) : 1) : 1
        it.hl = stepHl(it.hl, i === k ? 1 : 0, dt)
        it.front = stepFront(it.track, dt)
        it.harm = phaseOf(it.track.id, it.reading, now)
        it.open = opened.has(id)
        const at = landed.get(it.track.id)
        it.lock = at === undefined ? undefined : (now - at) / 1000
        if (it.lock !== undefined && it.lock > LOCK_END) {
          landed.delete(it.track.id)
          it.lock = undefined
        }
      })
      let items = m.items
      if (morph) {
        const pos = G - shown.ts[m.cur]
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
      } else level = level < 1e-3 ? 0 : level * 0.95
      if (now - avoidAt > 250) {
        avoidAt = now
        queueEl = document.querySelector('[data-queue]')
        avoid = queueEl?.getBoundingClientRect() ?? null
      }
      paintRows(queueEl, m, k)
      r.draw({ items, G, t, level, palette: PALETTES[pal], avoid, hover: scrub.hovered })
      const show = placeJoins(m, G)
      // Nothing to draw next frame when this one matches the last (and nothing plays).
      let sum = 0
      for (const it of items) sum += it.a + it.hl + it.sc + it.span.i0 + it.span.il + it.span.o0 + it.span.ol + (it.front ?? 0) + (it.lock ?? 0) + (it.harm ? it.harm.t + it.harm.land : 0) + (it.open ? 1 : 0)
      const sig = `${G.toFixed(3)}|${t.toFixed(3)}|${level.toFixed(3)}|${scrub.hovered}|${sum.toFixed(3)}|${items.length}|${show}|${joins.slot}|${live.current.aim}`
      const moved = sig !== lastSig || getQueue().playing
      lastSig = sig
      return moved
    }
    const stop = frameLoop(step)
    const dropScrub = scrub.attach()
    registerScrubber(scrub)
    // Another screen's move names the row that moved, so it dips like a local one.
    const dropEvents = onQueueEvent(ev => { if (ev.op === 'mv') movedId = ev.item_id as string })
    return () => {
      stop()
      ro.disconnect()
      root.removeEventListener('pointerdown', down)
      for (const ev of poke) root.removeEventListener(ev, wake)
      dropScrub()
      registerScrubber(null)
      dropEvents()
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
      <canvas ref={canvas} aria-hidden="true" className="fixed left-0 top-0 -z-10 w-full pointer-events-none" />
      <canvas ref={text} aria-hidden="true" className="fixed inset-0 -z-10 size-full pointer-events-none" />
      {/* Above the queue sheet: a drop's slot and its label may sit under it. */}
      <div className="fixed left-0 top-0 z-20 pointer-events-none">
        {Array.from({ length: MARKS }, (_, k) => (
          <button
            key={k}
            ref={el => { markEls.current[k] = el }}
            style={{ display: 'none' }}
            className="absolute left-0 top-0 pointer-events-auto grid place-items-center h-8 min-w-8 rounded-full border border-primary/60 bg-black/55 text-[15px] font-bold leading-none text-primary after:absolute after:-inset-1.5 after:content-[''] hover:bg-black/75 data-[next=1]:h-7 data-[next=1]:px-3 data-[next=1]:text-xs data-[next=1]:border-primary data-[next=1]:bg-primary data-[next=1]:text-primary-content data-[aimed=1]:bg-primary data-[aimed=1]:text-primary-content data-[aimed=1]:ring-2 data-[aimed=1]:ring-white/70"
            onClick={e => onAim?.(Number(e.currentTarget.dataset.at))}
          />
        ))}
        <div ref={slotEl} style={{ display: 'none' }} className="absolute left-0 top-0 w-9 rounded-xl border-2 border-dashed border-primary bg-primary/12">
          <div ref={slotLabel} className="absolute left-12 top-0 w-max max-w-64 rounded-xl glass px-3 py-2 text-xs font-semibold text-primary" />
        </div>
      </div>
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
          queued={model.q.items.map(i => i.track_id)}
          onUse={t => {
            const old = model.q.items[model.rows[at]]
            void addTracks([{ library: t.library, track_id: t.id }], model.rows[at], `${t.title} replaces ${model.items[at].title}`).then(() => queueActions.remove(old.item_id))
            close()
          }}
          onHear={() => hear(at, Math.max(0, model.items[at].plan!.mixOut - 8))}
        />
      )}
    </>
  )
}
