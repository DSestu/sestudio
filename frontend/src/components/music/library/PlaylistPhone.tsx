import { useEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { useFlows, type Flow } from '../../../musicFlows'
import { playlistApi, type PlaylistNode } from '../../../musicPlaylists'
import { queueActions } from '../../../musicQueue'
import ResponsiveModal from '../../ResponsiveModal'
import { useModalBack } from '../../../useModalBack'
import Sources, { type SourceTab } from '../edit/Sources'
import { songKey } from '../edit/focus'
import { totalTime } from '../format'
import { startPlayback } from '../player'
import { toast } from '../toast'
import type { Facts } from './facts'
import FillFlow, { type FillPreview } from './FillFlow'
import { Ic } from './icons'
import { addTo, joinKey, indexAfterRemoval, moveItem, autoOrderBy, reblend, removeItems, setBlend, setShape, SHAPE_HINT, togglePin, type PlaylistView } from './playlistEdit'
import { rowDragIntent, HOLD_MS } from '../interact'
import { EnergyLine, JoinChips } from './PlaylistRows'
import { JoinFix, SwapFor } from './PlaylistBoard'
import { ORDERS } from '../crates/setBuilder'
import { silhouette, trackColor, type Colour } from './sigil'
import { SHAPES } from './tapeLayout'

// The open playlist on a phone (SPEC-blend-playlists §3.2, P1–P4): its own screen under the
// page header: a header card, the chips Shape · Fill · + Add, the energy line, compact rows with
// join lines, and Play fixed above the player bar and the dock. A tap on a row opens its sheet;
// a hold lifts the row to drag it (a touch scrolls until it has been held for HOLD_MS).

type Sheet = { k: 'row'; id: string } | { k: 'menu' } | { k: 'shape' } | { k: 'fill' } | { k: 'add' } | { k: 'fix' }

const BTN = 'btn h-11 min-h-0 rounded-xl border-0 bg-white/8 text-sm font-medium disabled:opacity-40'
const PLUS = <Ic name="plus" size={12} />

export default function PlaylistPhone({ node, view, byId, facts, colour, secs, run, playingAt, moved, curve, added, problems, openJoin, onJoin, onPreview, onClose, onBlendBy, play, pause, onSave }: {
  node: PlaylistNode
  view: PlaylistView
  byId: ReadonlyMap<string, MusicTrack>
  facts: Facts
  colour: Colour
  secs: number
  run: { playing: boolean } | null
  playingAt: number
  moved: ReadonlySet<string>
  curve?: [number, number][]
  /** Tracks a Fill would add, drawn as dashed rows. */
  added: MusicTrack[]
  problems: (i: number) => string[]
  openJoin: string | null
  onJoin: (key: string | null) => void
  onPreview: (p: FillPreview | null) => void
  onClose: () => void
  onBlendBy: () => void
  play: () => void
  pause: () => void
  /** The Queue (a draft): Save as playlist in its header. */
  onSave?: () => void
}) {
  const { rows, tracks, joins } = view
  const blend = !!node.blend
  const pins = node.pins ?? {}
  const ids = useMemo(() => rows.map(r => r.item.item_id), [rows])
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [tab, setTab] = useState<SourceTab>('lib')
  const { flows } = useFlows()
  const all = useMemo(() => [...byId.values()], [byId])
  const inList = useMemo(() => new Set(rows.map(r => songKey(r.track))), [rows])
  const shape = node.shape ?? 'Lift'
  const shapeLabel = shape.startsWith('flow:') ? flows.find(f => f.id === shape.slice(5))?.name ?? 'A flow' : shape
  const fix = !!openJoin
  const rowOf = sheet?.k === 'row' ? rows.findIndex(r => r.item.item_id === sheet.id) : -1
  const shown = fix ? { k: 'fix' as const } : sheet?.k === 'row' && rowOf < 0 ? null : sheet // a row that left the playlist closes its sheet
  const close = () => { if (fix) onJoin(null); else { setSheet(null); onPreview(null) } }
  useModalBack(!!shown, close)

  const { drag, rowProps, justDragged, box } = useHoldDrag((id, at) => void moveItem(node, id, indexAfterRemoval(ids, id, at)))

  const sub = run ? <span className={run.playing ? 'text-success' : ''}>● {run.playing ? 'Playing' : 'Paused'} · order locked</span>
    : <>{blend ? 'Blend' : 'Hand order'} · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}{tracks.length ? ` · ${totalTime(secs)}` : ''}</>
  const act = (fn: () => unknown) => () => { setSheet(null); void fn() }

  return (
    <section className="flex flex-col gap-2.5 pb-20" aria-label={node.name}>
      <div className="flex items-center gap-1 rounded-2xl bg-white/6 p-2">
        <button onClick={onClose} aria-label="Back to the library" className="btn btn-ghost btn-circle size-11 min-h-0"><Ic name="up" size={16} className="-rotate-90" /></button>
        <div className="min-w-0 flex-1 leading-tight">
          <h3 className="truncate text-base font-semibold">{node.name}</h3>
          <p className="truncate text-xs text-base-content/60">{sub}</p>
        </div>
        {onSave && <button disabled={!tracks.length} onClick={onSave} className="btn btn-sm h-11 min-h-0 shrink-0 rounded-xl">Save as playlist</button>}
        <button onClick={() => setSheet({ k: 'menu' })} aria-label={`Options for ${node.name}`} className="btn btn-ghost btn-circle size-11 min-h-0">
          <svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
      </div>
      <div className="flex gap-1.5" role="group" aria-label="Playlist actions">
        {blend && <button onClick={() => setSheet({ k: 'shape' })} className={`${BTN} min-w-0 flex-[1.8] gap-1.5`}><span className="text-base-content/60">Shape</span><b className="truncate">{shapeLabel}</b></button>}
        <button onClick={() => setSheet({ k: 'fill' })} className={`${BTN} flex-1 gap-1.5`}>{PLUS}Fill</button>
        <button onClick={() => setSheet({ k: 'add' })} className={`${BTN} flex-1 gap-1.5`}>{PLUS}Add</button>
      </div>
      {!tracks.length ? (
        <p className="grid h-28 place-items-center rounded-xl border-2 border-dashed border-white/15 px-4 text-center text-xs text-base-content/60">
          Nothing here yet. Add tracks from your library or online, or fill it from a flow.
        </p>
      ) : (
        <>
          <EnergyLine tracks={tracks} facts={facts} shape={blend ? node.shape : undefined} curve={blend ? curve : undefined} pinned={(_, i) => rows[i].item.item_id in pins} />
          <div ref={box} className="flex flex-col">
            {rows.map(({ item, track: t }, i) => {
              const f = facts(t.id)
              const state = playingAt < 0 ? undefined : i < playingAt ? 'played' : i === playingAt ? 'playing' : undefined
              const lifted = drag?.id === item.item_id
              return (
                <div key={item.item_id} className="contents">
                  <div data-set-item {...rowProps(item.item_id)} onClick={() => { if (!justDragged()) setSheet({ k: 'row', id: item.item_id }) }} role="button" tabIndex={0} aria-label={`${i + 1}. ${t.title}`}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet({ k: 'row', id: item.item_id }) } }}
                    style={lifted ? { transform: `translateY(${drag.dy}px) scale(1.02)`, zIndex: 20 } : undefined}
                    className={`relative flex min-h-12 touch-pan-y select-none items-center gap-2.5 rounded-xl px-2 [-webkit-touch-callout:none] ${state === 'playing' ? 'bg-primary/12' : ''} ${state === 'played' ? 'opacity-45' : ''} ${lifted ? 'bg-base-300 shadow-xl' : ''} ${drag && drag.at === i && !lifted ? 'before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded before:bg-primary' : ''} ${drag && drag.at === rows.length && i === rows.length - 1 ? 'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded after:bg-primary' : ''}`}>
                    <span className="relative w-6 text-right text-xs tabular-nums text-base-content/55">{moved.has(item.item_id) && <i className="absolute -left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />}{i + 1}</span>
                    <svg width="28" height="20" viewBox="0 0 36 24" className="shrink-0" aria-hidden="true"><path d={silhouette(f.curve, 2, 32, 20, 12)} fill={trackColor(f, colour)} /></svg>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm">{t.title}</span>
                      <span className="block truncate text-xs text-base-content/60">{[f.bpm && Math.round(f.bpm), f.key && `${f.key}${f.camelot ? ` ${f.camelot}` : ''}`].filter(Boolean).join(' · ') || t.artist}</span>
                    </span>
                    {item.item_id in pins && <span className="text-primary" aria-label="Pinned"><Ic name="pin" size={14} /></span>}
                  </div>
                  {i < rows.length - 1 && (
                    <div className={`ml-11 flex min-h-6 flex-wrap items-center gap-2 py-0.5 ${problems(i).length ? 'rounded-lg bg-warning/6 px-1.5' : ''}`}>
                      <JoinChips j={joins?.[i]} problems={problems(i)} />
                      {problems(i).length > 0 && <button onClick={() => onJoin(joinKey(t, tracks[i + 1]))} className="btn btn-sm h-11 min-h-0 rounded-lg px-4">Fix</button>}
                    </div>
                  )}
                </div>
              )
            })}
            {added.map((t, k) => (
              <div key={t.id} className="mt-1 flex min-h-11 items-center gap-2.5 rounded-xl border border-dashed border-white/20 px-2 text-sm text-base-content/70">
                <span className="w-6 text-right text-xs tabular-nums text-base-content/55">{rows.length + k + 1}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-xs text-base-content/60">New</span>
              </div>
            ))}
          </div>
        </>
      )}
      <button disabled={!tracks.length} onClick={run ? pause : play}
        className="btn btn-primary fixed inset-x-3 bottom-[calc(var(--dock-clear)+var(--music-bar,0rem))] z-30 h-12 min-h-0 gap-2 rounded-2xl text-base shadow-xl">
        <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d={run?.playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z'} /></svg>{run?.playing ? 'Pause' : 'Play'}
      </button>

      {shown?.k === 'row' && rowOf >= 0 && (
        <RowSheet node={node} view={view} facts={facts} i={rowOf} pinned={rows[rowOf].item.item_id in pins} blend={blend} problems={problems(Math.max(0, rowOf - 1))} all={all} onClose={() => setSheet(null)} />
      )}
      {shown?.k === 'fix' && <ResponsiveModal onClose={close} boxClassName="[&_.btn]:h-11 [&_.btn]:min-h-0"><JoinFix node={node} view={view} openJoin={openJoin!} facts={facts} colour={colour} byId={byId} onClose={() => onJoin(null)} /></ResponsiveModal>}
      {shown?.k === 'fill' && <FillFlow node={node} wide={false} avgSecs={secs / Math.max(1, tracks.length)} onPreview={onPreview} onClose={close} />}
      {shown?.k === 'add' && (
        <ResponsiveModal onClose={close} boxClassName="flex h-[75vh] flex-col p-0">
          <Sources tab={tab} onTab={setTab} all={all} byId={byId} nodeId={node.id} inList={inList} onAdd={t => void addTo(node, [t], t.title, ids.length)} />
        </ResponsiveModal>
      )}
      {shown?.k === 'shape' && (
        <ResponsiveModal onClose={close}>
          <h4 className="pb-2 text-sm font-semibold">Shape the blend aims at</h4>
          <ShapeList shape={shape} flows={flows} onPick={s => { setSheet(null); if (s !== shape) void setShape(node, s) }} />
        </ResponsiveModal>
      )}
      {shown?.k === 'menu' && (
        <ResponsiveModal onClose={close}>
          <h4 className="pb-2 text-sm font-semibold">{node.name}</h4>
          <div role="group" aria-label="Order" className="mb-2 grid grid-cols-2 gap-1.5">
            {([[true, 'Blend'], [false, 'Hand order']] as const).map(([on, label]) => (
              <button key={label} aria-pressed={blend === on} onClick={act(() => blend !== on && setBlend(node, on))} className={`${BTN} ${blend === on ? 'bg-primary/20 text-primary' : ''}`}>{label}</button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {blend && <button onClick={() => { setSheet(null); onBlendBy() }} className={BTN}>Blend by</button>}
            {blend && <button onClick={act(() => reblend(node, true))} className={BTN}>Re-blend all</button>}
            <p className="pt-1 text-[11px] text-base-content/50">Auto-order</p>
            {ORDERS.map(([mode, name]) => <button key={mode} onClick={act(() => autoOrderBy(node, mode))} className={BTN}>{name}</button>)}
            <button onClick={act(() => { const name = window.prompt('Rename', node.name); return name?.trim() ? playlistApi.rename(node.id, name) : undefined })} className={BTN}>Rename</button>
            <button onClick={act(async () => { if (window.confirm(`Delete ${node.name}?`)) { await playlistApi.remove(node.id); onClose() } })} className={`${BTN} text-error`}>Delete</button>
          </div>
        </ResponsiveModal>
      )}
    </section>
  )
}

function ShapeList({ shape, flows, onPick }: { shape: string; flows: Flow[]; onPick: (s: string) => void }) {
  const item = (s: string, label: string, hint?: string) => (
    <button key={s} onClick={() => onPick(s)} className={`flex h-11 items-center justify-between rounded-xl px-3 text-sm ${s === shape ? 'bg-primary/15 text-primary' : 'bg-white/6'}`}>
      <span className="truncate">{label}</span>{hint && <span className="text-xs text-base-content/60">{hint}</span>}
    </button>
  )
  return (
    <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
      {SHAPES.map(s => item(s, s, SHAPE_HINT[s]))}
      {flows.length > 0 && <p className="pt-2 text-xs text-base-content/60">From a flow</p>}
      {flows.map(f => item(`flow:${f.id}`, f.name))}
    </div>
  )
}

/** P2: a row's sheet: its join, four actions, then what fits in its place. */
function RowSheet({ node, view, facts, i, pinned, blend, problems, all, onClose }: {
  node: PlaylistNode; view: PlaylistView; facts: Facts; i: number; pinned: boolean; blend: boolean; problems: string[]; all: MusicTrack[]; onClose: () => void
}) {
  const { rows, joins } = view
  const { item, track: t } = rows[i]
  const act = (fn: () => unknown) => () => { onClose(); void fn() }
  const playHere = () => startPlayback(async () => {
    const q = await playlistApi.play(node.id)
    const at = q.items.find(x => x.track_id === t.id)
    if (at && at.item_id !== q.items[0]?.item_id) await queueActions.play(at.item_id)
  }).catch((e: Error) => toast(e.message))
  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-h-[88dvh]">
      <h4 className="truncate text-base font-semibold">{i + 1} · {t.title}</h4>
      <p className="truncate pb-2 text-xs text-base-content/60">{t.artist}</p>
      {i > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-white/6 px-3 py-2 text-xs">
          <span className="text-base-content/60">From {rows[i - 1].track.title}</span>
          <JoinChips j={joins?.[i - 1]} problems={problems} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={act(playHere)} className={BTN}>Play from here</button>
        {blend ? <button onClick={act(() => togglePin(node, item.item_id))} className={`${BTN} ${pinned ? 'text-primary' : ''}`}>{pinned ? 'Unpin' : 'Pin here'}</button> : <span />}
        <button disabled={i === 0} onClick={act(() => moveItem(node, item.item_id, i - 1))} className={BTN}>Earlier</button>
        <button onClick={act(() => removeItems(node, [item.item_id]))} className={`${BTN} text-error`}>Remove</button>
      </div>
      <SwapFor node={node} view={view} trackId={t.id} library={all} facts={facts} onDone={onClose} />
    </ResponsiveModal>
  )
}

/**
 * Hold a row to lift it (a mouse lifts after a few px), drag it over the others, let go to drop it.
 * No HTML5 drag (a touch has none): pointer events, and the page stops scrolling once the row is lifted.
 */
function useHoldDrag(onDrop: (id: string, at: number) => void) {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; dy: number; at: number } | null>(null)
  const endedAt = useRef(-1e9)
  const cleanup = useRef<() => void>(() => {})
  useEffect(() => () => cleanup.current(), [])

  const start = (e: React.PointerEvent, id: string) => {
    if (e.button > 0 || (e.target as Element).closest('button') || drag) return
    const touch = e.pointerType !== 'mouse'
    const y0 = e.clientY, x0 = e.clientX, t0 = performance.now(), scroll0 = window.scrollY
    let lifted = false
    let y = y0
    let mids: number[] = []
    let timer = 0
    let scroller = 0
    const stop = (ev: TouchEvent) => ev.preventDefault()
    const at = () => mids.filter(m => m < y + window.scrollY - scroll0).length
    const lift = () => {
      lifted = true
      navigator.vibrate?.(12)
      mids = [...(box.current?.querySelectorAll<HTMLElement>('[data-set-item]') ?? [])].map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 })
      document.addEventListener('touchmove', stop, { passive: false })
      // The page scrolls while the row is held near an edge.
      scroller = window.setInterval(() => { if (y < 130) window.scrollBy(0, -10); else if (y > window.innerHeight - 190) window.scrollBy(0, 10); show() }, 16)
      show()
    }
    const show = () => setDrag({ id, dy: y - y0 + window.scrollY - scroll0, at: at() })
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      y = ev.clientY
      if (lifted) return show()
      const v = rowDragIntent(touch, Math.hypot(ev.clientX - x0, y - y0), performance.now() - t0)
      if (v === 'lift') lift()
      else if (v === 'cancel') end(false)
    }
    const end = (drop: boolean) => {
      cleanup.current()
      cleanup.current = () => {}
      if (lifted) {
        endedAt.current = performance.now()
        const to = at()
        setDrag(null)
        if (drop) onDrop(id, to)
      }
    }
    const up = () => end(true)
    const cancel = () => end(false)
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(false) }
    cleanup.current = () => {
      window.clearTimeout(timer)
      window.clearInterval(scroller)
      document.removeEventListener('touchmove', stop)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
    if (touch) timer = window.setTimeout(lift, HOLD_MS)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
  }
  const rowProps = (id: string) => ({ onPointerDown: (e: React.PointerEvent) => start(e, id), onContextMenu: (e: React.MouseEvent) => e.preventDefault() })
  return { box, drag, rowProps, justDragged: () => performance.now() - endedAt.current < 350 }
}
