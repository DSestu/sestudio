import { useEffect, useMemo, useRef, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import { useBlendWeights } from '../../../musicBlendWeights'
import { filtersOf, proxOf, rankFits } from '../../../musicFits'
import { useSummaries } from '../../../musicMeta'
import { useSettings } from '../../../useSettings'
import { blendOf } from '../crates/proximity'
import { gapBridges } from '../gaps'
import { useFlows, energyShape } from '../../../musicFlows'
import { playlistApi, type PlaylistNode } from '../../../musicPlaylists'
import { clockSkew, getQueue, positionNow, usePlaylistRun } from '../../../musicQueue'
import { startPlayback, togglePlay } from '../player'
import { totalTime } from '../format'
import { toast } from '../toast'
import type { Facts } from './facts'
import FillFlow, { type FillPreview } from './FillFlow'
import { Ic } from './icons'
import { addTo, joinKey, unkeepJoin, useKept, indexAfterRemoval, moveBlock, moveItem, autoOrderBy, reblend, removeItems, setBlend, setShape, SHAPE_HINT, swapItem, togglePin, useMoved, type PlaylistView } from './playlistEdit'
import PlaylistPhone from './PlaylistPhone'
import { ORDERS } from '../crates/setBuilder'
import { clearSelection, clickSelect, idsIn, useSelection } from './selection'
import { EnergyLine, FixPanel, JoinLine, Row } from './PlaylistRows'
import { useDeleteKey, useDragOff, useSetDrop, type SetActions } from './setGestures'
import { Seg } from './TapeBar'
import { SHAPES } from './tapeLayout'
import type { Colour } from './sigil'

// The playlist open in the centre of the board (SPEC-blend-playlists §3.1, D1): under the tape,
// under the tape. Header, energy line, rows with a join line between each pair. A join or a
// row selected here shows its panel in the right column (`JoinFix`, `SwapFor`).


export default function PlaylistBoard({ node, view, byId, wide, facts, colour, selectedId, openJoin, onJoin, onSelect, hoverProps, onClose, onBlendBy }: {
  node: PlaylistNode
  byId: ReadonlyMap<string, MusicTrack>
  wide: boolean
  view: PlaylistView
  facts: Facts
  colour: Colour
  selectedId?: string
  /** The join whose Fix panel is open in the right column (`a>b` track ids). */
  openJoin: string | null
  onJoin: (key: string | null) => void
  onSelect: (t: MusicTrack) => void
  hoverProps?: (t: MusicTrack) => object
  onClose: () => void
  /** A phone: the options sheet opens the Blend by sheet. */
  onBlendBy?: () => void
}) {
  const { rows, tracks, res, joins } = view
  const kept = useKept()
  const moved = useMoved()
  const picked = idsIn(useSelection(), 'set')
  const box = useRef<HTMLElement>(null)
  const ids = useMemo(() => rows.map(r => r.item.item_id), [rows])
  const trackIds = useMemo(() => tracks.map(t => t.id), [tracks])
  const itemOf = (trackId: string) => rows.find(r => r.track.id === trackId)?.item.item_id
  const blend = !!node.blend
  const pins = node.pins ?? {}
  const run = usePlaylistRun(node.id)
  const playingAt = run ? rows.findIndex(r => r.track.id === run.trackId) : -1
  const [fillOpen, setFillOpen] = useState(false)
  const [preview, setPreview] = useState<FillPreview | null>(null)
  const { flows } = useFlows()
  const shapeFlow = node.shape?.startsWith('flow:') ? flows.find(f => f.id === node.shape!.slice(5)) : undefined
  const curve = (preview?.useShape ? energyShape(preview.flow) : shapeFlow && energyShape(shapeFlow)) || undefined
  const added = (preview?.ids ?? []).flatMap(id => byId.get(id) ?? [])

  // Every gesture, bound to this playlist: a drop pins where it lands, a drop on the
  // list but not between rows goes to the end, a single move is one pinned move.
  const on: SetActions = {
    move: (tids, to) => {
      const block = tids.map(itemOf).filter((x): x is string => !!x)
      if (block.length === 1) {
        const at = indexAfterRemoval(ids, block[0], to)
        if (at !== ids.indexOf(block[0])) void moveItem(node, block[0], at)
      } else if (block.length) void moveBlock(node, block, to)
    },
    add: (ts, label, to) => void addTo(node, ts, label, to ?? ids.length),
    remove: tids => void removeItems(node, tids.map(itemOf).filter((x): x is string => !!x)),
  }
  const { off, moveProps } = useDragOff(box, tracks, picked, 'y', on.remove)
  useDeleteKey(on.remove)
  const { slot, ...dropProps } = useSetDrop(box, tracks, 'y', on)

  // Blend by changed (a weight let go, a harmony preset): re-order once, not on the first render.
  const w = useBlendWeights()
  const weights = JSON.stringify(w)
  const last = useRef(weights)
  useEffect(() => {
    if (weights === last.current) return
    last.current = weights
    if (node.blend) void reblend(node, false, 'Blend by changed')
  }, [weights]) // eslint-disable-line react-hooks/exhaustive-deps -- only a change of the weights re-orders

  const problems = (i: number) => (joins?.[i] && !kept.includes(joinKey(tracks[i], tracks[i + 1])) ? joins[i].problems : [])
  const secs = tracks.reduce((a, t) => a + t.duration, 0)
  const play = () => startPlayback(() => playlistApi.play(node.id).then(() => undefined)).catch((e: Error) => toast(e.message))
  const pause = () => { const q = getQueue(); togglePlay(q.playing, positionNow(q, clockSkew(), Date.now())) }

  if (!wide) {
    return <PlaylistPhone node={node} view={view} byId={byId} facts={facts} colour={colour} secs={secs} run={run} playingAt={playingAt} moved={moved} curve={curve} added={added}
      problems={problems} openJoin={openJoin} onJoin={onJoin} onPreview={setPreview} onClose={onClose} onBlendBy={onBlendBy ?? (() => {})} play={() => void play()} pause={pause} />
  }

  return (
    <section ref={box} {...dropProps} className="flex flex-col gap-2 rounded-2xl bg-white/4 p-3" aria-label={node.name}>
      <div className="flex items-center gap-2">
        <h3 className="max-w-[45%] shrink-0 truncate text-sm font-semibold">{node.name}</h3>
        <span className="min-w-0 flex-1 truncate text-xs text-base-content/55">
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}{tracks.length ? ` · ${totalTime(secs)}` : ''}
          {blend && res && tracks.length > 1 ? ` · ${res.score} blend · ${res.rough} rough ${res.rough === 1 ? 'join' : 'joins'}` : ''}
          {run && <span className={`font-medium ${run.playing ? 'text-success' : 'text-base-content/60'}`}> · ● {run.playing ? 'Playing' : 'Paused'} · order locked</span>}
        </span>
        <button disabled={!tracks.length} onClick={run ? pause : () => void play()} className="btn btn-primary btn-xs sm:btn-sm shrink-0 gap-1 rounded-xl">
          <svg className="size-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d={run?.playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z'} /></svg>{run?.playing ? 'Pause' : 'Play'}
        </button>
        <Menu node={node} onClose={onClose} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Seg label="Order" options={[['blend', 'Blend'], ['hand', 'Hand order']] as const} value={blend ? 'blend' : 'hand'} onPick={v => { if ((v === 'blend') !== blend) void setBlend(node, v === 'blend') }} />
        {blend && <ShapeChip node={node} />}
        <div className="relative">
          <button onClick={() => setFillOpen(o => !o)} aria-expanded={fillOpen} className="flex h-7 items-center gap-1.5 rounded-xl bg-black/25 px-3 text-xs hover:bg-black/35"><Ic name="plus" size={11} />Fill from a flow</button>
          {fillOpen && <FillFlow node={node} wide={wide} avgSecs={secs / Math.max(1, tracks.length)} onPreview={setPreview} onClose={() => setFillOpen(false)} />}
        </div>
        {!blend && <span className="text-base-content/50">Nothing moves on its own.</span>}
        {off !== null && <span className="font-medium text-error" role="status">Release to remove {off} {off === 1 ? 'track' : 'tracks'}</span>}
      </div>
      {!tracks.length ? (
        <div className={`grid h-28 place-items-center rounded-xl border-2 border-dashed px-4 text-center text-xs ${slot !== null ? 'border-primary/70 bg-primary/5 text-base-content' : 'border-white/15 text-base-content/50'}`}>
          Drag tracks, albums or a selection here, or press + on a track. {blend ? 'Blend orders them; what you place stays pinned.' : 'They stay in the order you drop them.'}
        </div>
      ) : (
        <>
          <EnergyLine tracks={tracks} facts={facts} shape={blend ? node.shape : undefined} curve={blend ? curve : undefined} pinned={(_, i) => rows[i].item.item_id in pins} />
          <div className="flex flex-col">
            {rows.map(({ item, track: t }, i) => (
              <div key={item.item_id} className="contents">
                {slot === i && <span className="h-0.5 rounded bg-primary" />}
                <Row t={t} i={i} facts={facts} colour={colour} pinned={item.item_id in pins} picked={picked.has(t.id)} focused={t.id === selectedId} moved={moved.has(item.item_id)} state={playingAt < 0 ? undefined : i < playingAt ? 'played' : i === playingAt ? 'playing' : undefined}
                  drag={moveProps(t)} hover={hoverProps?.(t)}
                  onClick={e => { clickSelect('set', t.id, trackIds, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey }); onSelect(t); onJoin(null) }}
                  onPin={blend ? () => void togglePin(node, item.item_id) : undefined}
                  onRemove={() => { void removeItems(node, [item.item_id]); clearSelection() }} />
                {i < rows.length - 1 && (() => {
                  const k = joinKey(t, tracks[i + 1])
                  return <div data-join={i} className={k === openJoin ? 'rounded-md bg-primary/10' : ''}>
                    <JoinLine j={joins?.[i]} problems={problems(i)} kept={kept.includes(k)} onFix={() => onJoin(openJoin === k ? null : k)} onUnkeep={() => unkeepJoin(k)} />
                  </div>
                })()}
              </div>
            ))}
            {slot === rows.length && <span className="h-0.5 rounded bg-primary" />}
            {added.map((t, k) => (
              <div key={t.id} className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-dashed border-white/20 px-2 text-[13px] text-base-content/70">
                <span className="w-5 text-right text-[11px] tabular-nums text-base-content/45">{rows.length + k + 1}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}<span className="text-[11px] text-base-content/50"> · {t.artist}</span></span>
                <span className="text-[11px] text-base-content/50">New</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/** ⋯: Re-blend all (ignores the stay-put cost once) and Close. */
function Menu({ node, onClose }: { node: PlaylistNode; onClose: () => void }) {
  const done = (fn: () => void) => () => { (document.activeElement as HTMLElement | null)?.blur(); fn() }
  return (
    <div className="dropdown dropdown-end shrink-0">
      <button tabIndex={0} aria-label={`Options for ${node.name}`} className="btn btn-ghost btn-circle btn-xs sm:btn-sm">
        <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-52 rounded-xl bg-base-200 p-1 shadow-lg">
        {node.blend && <li><button onClick={done(() => void reblend(node, true))}>Re-blend all</button></li>}
        <li className="menu-title pt-2 text-[11px]">Auto-order</li>
        {ORDERS.map(([mode, name]) => <li key={mode}><button onClick={done(() => void autoOrderBy(node, mode))}>{name}</button></li>)}
        <li><button onClick={done(onClose)}>Close playlist</button></li>
      </ul>
    </div>
  )
}

/** The shape the blend aims at: Hold, Lift, Ease or Arc, or a flow's own curve (named by the flow). */
function ShapeChip({ node }: { node: PlaylistNode }) {
  const shape = node.shape ?? 'Lift'
  const { flows } = useFlows()
  const label = shape.startsWith('flow:') ? flows.find(f => f.id === shape.slice(5))?.name ?? 'A flow' : shape
  const done = (s: string) => () => { (document.activeElement as HTMLElement | null)?.blur(); if (s !== shape) void setShape(node, s) }
  return (
    <div className="dropdown">
      <button tabIndex={0} aria-label={`Shape: ${shape}`} className="flex h-7 items-center gap-1.5 rounded-xl bg-black/25 px-3 text-xs hover:bg-black/35">
        <span className="text-base-content/60">Shape</span><b className="max-w-32 truncate font-semibold">{label}</b><Ic name="up" size={11} className="rotate-180" />
      </button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 max-h-72 w-52 flex-nowrap overflow-y-auto rounded-xl bg-base-200 p-1 shadow-lg">
        {SHAPES.map(s => <li key={s}><button onClick={done(s)} className={s === shape ? 'bg-primary/15 text-primary' : ''}>{s}<span className="text-[11px] text-base-content/50">{SHAPE_HINT[s]}</span></button></li>)}
        {flows.length > 0 && <li className="menu-title pt-2 text-[11px]">From a flow</li>}
        {flows.map(f => { const s = `flow:${f.id}`; return <li key={f.id}><button onClick={done(s)} className={s === shape ? 'bg-primary/15 text-primary' : ''}><span className="truncate">{f.name}</span></button></li> })}
      </ul>
    </div>
  )
}

/** Right column, a join selected: the Fix panel (put one between, move B, keep it). */
export function JoinFix({ node, view, openJoin, facts, colour, byId, onClose }: {
  node: PlaylistNode; view: PlaylistView; openJoin: string; facts: Facts; colour: Colour; byId: ReadonlyMap<string, MusicTrack>; onClose: () => void
}) {
  const kept = useKept()
  const { rows, tracks, joins } = view
  const i = tracks.findIndex((t, n) => n < tracks.length - 1 && joinKey(t, tracks[n + 1]) === openJoin)
  useEffect(() => { if (i < 0) onClose() }, [i, onClose]) // the join left the playlist
  if (i < 0) return null
  const a = tracks[i], b = tracks[i + 1]
  return (
    <section className="p-3">
      <p className="pb-1.5 text-[11px] uppercase tracking-wider text-base-content/50">Join {i + 1} → {i + 2}</p>
      <FixPanel key={openJoin} a={a} b={b} shown={tracks} problems={joins?.[i]?.problems ?? []} facts={facts} colour={colour} byId={byId} kept={kept} onClose={onClose} className=""
        onInsert={t => void addTo(node, [t], t.title, i + 1)}
        onSpot={order => void moveItem(node, rows[i + 1].item.item_id, order.indexOf(b.id))} />
    </section>
  )
}

/** Right column or phone sheet, a row selected: a few tracks that fit in its place, ranked by Blend; a tap swaps one in, pinned there. */
export function SwapFor({ node, view, trackId, library, facts, onDone }: { node: PlaylistNode; view: PlaylistView; trackId: string; library: MusicTrack[]; facts: Facts; onDone: () => void }) {
  const { rows } = view
  const i = rows.findIndex(r => r.track.id === trackId)
  const prev = rows[i - 1]?.track
  const next = rows[i + 1]?.track
  const { get, v } = useSummaries(useMemo(() => library.map(t => t.id), [library]))
  const bw = useBlendWeights()
  const [settings] = useSettings()
  const picks = useMemo(() => {
    if (!prev) return []
    const a = proxOf(prev, get(prev.id))
    const b = next && proxOf(next, get(next.id))
    const byId = new Map(library.map(t => [t.id, t]))
    const song = (t?: MusicTrack) => t && `${t.title}\u0000${t.artist}`.toLowerCase()
    const skip = new Set(rows.map(r => r.track.id))
    const seen = new Set(rows.map(r => song(r.track)))
    const pool = library.map(t => proxOf(t, get(t.id)))
    // Between two tracks the gap ranking; at the end, what fits after the last one.
    const ranked = b ? gapBridges(a, b, pool, 30, skip).map(r => r.id) : rankFits(a, pool, filtersOf({}, settings.music_harmony_rule)).map(r => r.id)
    const out: { t: MusicTrack; score: number }[] = []
    for (const id of ranked) {
      const t = byId.get(id)
      if (!t || skip.has(id) || seen.has(song(t))) continue
      seen.add(song(t))
      const p = proxOf(t, get(t.id))
      const sides = [blendOf(a, p).score, ...(b ? [blendOf(p, b).score] : [])]
      out.push({ t, score: Math.round((sides.reduce((s, x) => s + x, 0) / sides.length) * 100) })
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 5)
  }, [prev?.id, next?.id, library, rows, v, bw, settings.music_harmony_rule]) // eslint-disable-line react-hooks/exhaustive-deps -- `v` and `bw` change what is read
  if (i < 0) return null
  return (
    <section className="flex flex-col border-t border-white/8 px-3 pb-3">
      <h4 className="pt-3 text-sm font-semibold">Swap for<span className="font-normal text-base-content/60">{prev ? ` · fits ${next ? 'between' : 'after'} ${prev.title}${next ? ` and ${next.title}` : ''}` : ''}</span></h4>
      {!prev ? (
        <p className="py-2 text-xs text-base-content/60">Nothing comes before the first row, so there is no join to fit. Pick the second row to swap what leads into it.</p>
      ) : !picks.length ? (
        <p className="py-2 text-xs text-base-content/60">Nothing in your libraries fits here.</p>
      ) : (
        <ul className="flex flex-col pt-1">
          {picks.map(({ t, score }) => {
            const f = facts(t.id)
            return (
              <li key={t.id}>
                <button onClick={() => { void swapItem(node, rows[i].item.item_id, t); onDone() }} aria-label={`Swap in ${t.title}`} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-1.5 text-left hover:bg-white/5">
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px]">{t.title}</span>
                    <span className="block truncate text-[11px] text-base-content/55">{[f.bpm && Math.round(f.bpm), f.key && `${f.key}${f.camelot ? ` ${f.camelot}` : ''}`].filter(Boolean).join(' · ') || t.artist}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums">{score}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
