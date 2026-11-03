import { useEffect, useMemo, useState } from 'react'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import {
  isSet, itemsOf, locate, playlistApi, statsOf,
  type PartStats, type PlaylistItem, type PlaylistNode,
} from '../../../musicPlaylists'
import { useMusicQueue } from '../../../musicQueue'
import { mixOf, rawOf, trackOf, useAnalyses } from '../mix/analysis'
import { plan } from '../mix/plan'
import { playNow, playPayload, startPlayback, usePosition } from '../player'
import FillDialog from './FillDialog'
import GenreTag from './GenreTag'
import { SmartForm } from './PlaylistTree'
import SetCurve from './SetCurve'
import { autoOrder, transitionChips, type Chip, type OrderMode, type SetTrack } from './setBuilder'

const ORDERS: [OrderMode, string][] = [['tempo', 'Smooth tempo'], ['harmonic', 'Harmonic (Camelot walk)'], ['energy', 'Energy arc']]

const run = (p: Promise<unknown>) => { p.catch(e => window.alert((e as Error).message)) }
const blur = () => (document.activeElement as HTMLElement | null)?.blur()

/** The genre most tracks share, when any is known. */
function dominant(genres: (string | undefined)[]): string | undefined {
  const n = new Map<string, number>()
  for (const g of genres) if (g) n.set(g, (n.get(g) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0]
}

function summary(s: PartStats, genre?: string): string {
  const bpm =s.bpmMin === undefined ? '' : s.bpmMin === s.bpmMax ? ` · ${Math.round(s.bpmMin)} bpm` : ` · ${Math.round(s.bpmMin)}–${Math.round(s.bpmMax!)} bpm`
  const dur = s.duration ? ` · ${formatDuration(s.duration)}` : ''
  return `${s.count} ${s.count === 1 ? 'track' : 'tracks'}${dur}${bpm}${genre ? ` · ${genre}` : ''}`
}

interface Drop { part: string | null; index: number }

function ChipLine({ chips }: { chips: Chip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pb-1 pl-8 pr-3">
      {chips.map(c => (
        <span key={c.text} className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${c.tone === 'warn' ? 'bg-warning/15 text-warning' : 'bg-white/5 text-base-content/60'}`}>{c.text}</span>
      ))}
    </div>
  )
}

/** A track's analysis as shown on its row. */
interface Meta {
  bpm?: number
  camelot?: string
  genre?: string
  conf: number
}

interface RowProps {
  item: PlaylistItem
  track?: MusicTrack
  meta: Meta
  chips?: Chip[]
  onGenre: () => void
  /** Position among its group, and where the menu can send it. */
  index: number
  last: boolean
  parts: { id: string; name: string }[]
  here: string | null
  onDragStart?: () => void
  onDropHere?: () => void
  onUp?: () => void
  onDown?: () => void
  onRemove?: () => void
  onToPart?: (part: string) => void
}

function Row({ item, track, meta, chips, onGenre, parts, here, last, index, ...ev }: RowProps) {
  const title = track?.title ?? item.title ?? 'Missing track'
  const artist = track?.artist ?? item.artist ?? ''
  const duration = track?.duration ?? item.duration ?? 0
  const play = () => run(item.library === 'online' ? playPayload([{ library: item.library, track_id: item.track_id, source: item.source, title: item.title, artist: item.artist, duration: item.duration }]) : track ? playNow(track) : Promise.resolve())
  return (
    <li
      draggable={!!ev.onDragStart}
      onDragStart={ev.onDragStart}
      onDragOver={ev.onDropHere && (e => e.preventDefault())}
      onDrop={ev.onDropHere && (e => { e.preventDefault(); ev.onDropHere!() })}
    >
      <div className="flex items-center gap-1 rounded-xl hover:bg-white/5">
      {ev.onDragStart && (
        <svg className="ml-1 w-4 h-4 shrink-0 cursor-grab text-base-content/30" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
      )}
      <button onClick={play} className="flex-1 min-w-0 flex items-center gap-3 px-3 h-12 text-left">
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-base-content/60">{artist}</span>
        </span>
      </button>
      {item.library === 'online' && <span className="hidden sm:inline text-[11px] text-base-content/40">{item.source === 'ytmusic' ? 'YT Music' : 'YouTube'}</span>}
      {meta.genre && <span className="hidden sm:block"><GenreTag id={item.track_id} genre={meta.genre} conf={meta.conf} onChange={onGenre} /></span>}
      {meta.camelot && <span className="rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-base-content/70">{meta.camelot}</span>}
      {meta.bpm !== undefined && <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(meta.bpm)}<span className="hidden sm:inline"> bpm</span></span>}
      <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(duration)}</span>
      {ev.onRemove && (
        <div className="dropdown dropdown-end">
          <button tabIndex={0} aria-label={`Options for ${title}`} className="btn btn-ghost btn-circle btn-sm mr-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-52 rounded-xl bg-base-200 p-1 shadow-lg">
            {index > 0 && <li><button onClick={() => { blur(); ev.onUp!() }}>Move up</button></li>}
            {!last && <li><button onClick={() => { blur(); ev.onDown!() }}>Move down</button></li>}
            {parts.filter(p => p.id !== here).map(p => <li key={p.id}><button onClick={() => { blur(); ev.onToPart!(p.id) }}>Move to {p.name}</button></li>)}
            <li><button className="text-error" onClick={() => { blur(); ev.onRemove!() }}>Remove from playlist</button></li>
          </ul>
        </div>
      )}
      </div>
      {meta.genre && <div className="pb-1 pl-8 sm:hidden"><GenreTag id={item.track_id} genre={meta.genre} conf={meta.conf} onChange={onGenre} /></div>}
      {chips && <ChipLine chips={chips} />}
    </li>
  )
}

/** A playlist's tracks (grouped by part for a set) or a smart list's matches. */
export default function PlaylistView({ node, byId }: { node: PlaylistNode; byId: ReadonlyMap<string, MusicTrack> }) {
  const [matches, setMatches] = useState<{ id: string; list: PlaylistItem[] }>()
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<string>()
  const smart = node.kind === 'smart'
  const rulesKey = JSON.stringify(node.rules)
  useEffect(() => {
    if (!smart) return
    let live = true
    playlistApi.smartTracks(node.id).then(refs => {
      if (live) setMatches({ id: node.id + rulesKey, list: refs.map(r => ({ item_id: r.track_id, ...r })) })
    }, () => {})
    return () => { live = false }
  }, [smart, node.id, rulesKey])

  const items = smart ? (matches?.id === node.id + rulesKey ? matches.list : []) : itemsOf(node)
  const facts = (i: PlaylistItem) => {
    const t = byId.get(i.track_id)
    return t ? { duration: t.duration, bpm: t.bpm } : { duration: i.duration ?? 0 }
  }
  const total = useMemo(() => statsOf(items, facts), [items, byId]) // eslint-disable-line react-hooks/exhaustive-deps
  const parts = node.parts ?? []

  const q = useMusicQueue()
  const [tick, reload] = useAnalyses(items.map(i => i.track_id))
  const [filling, setFilling] = useState(false)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  /** A track with its analysis (the set builder's view of it); `id` defaults to the track's. */
  const setTrack = (trackId: string, duration: number, bpm?: number, id = trackId): SetTrack => {
    const raw = rawOf(trackId)
    const en = raw?.energy
    return {
      id, duration, bpm: raw?.bpm || bpm, camelot: raw?.camelot, genre: raw?.genre, curve: en,
      energy: en?.length ? en.reduce((s, v) => s + v, 0) / en.length / 100 : undefined,
    }
  }
  const setOf = (i: PlaylistItem) => { const f = facts(i); return setTrack(i.track_id, f.duration, f.bpm, i.item_id) }
  const flat = useMemo(() => items.map(setOf), [items, byId, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const flatIndex = (itemId: string) => items.findIndex(i => i.item_id === itemId)

  // Where the set is playing, on the curve's time axis.
  const cur = q.items[q.current]
  const at = cur ? items.findIndex(i => i.track_id === cur.track_id) : -1
  const pos = usePosition(q, cur?.duration ?? 0)
  const now = !smart && at >= 0 ? flat.slice(0, at).reduce((s, t) => s + t.duration, 0) + pos : undefined

  /** The handover from a row to the next, as chips; a tempo warning suggests the part whose tempo fits. */
  const chipsAfter = (item: PlaylistItem, part: string | null): Chip[] | undefined => {
    const i = flatIndex(item.item_id)
    const next = items[i + 1]
    if (smart || !next) return undefined
    const a = flat[i]
    const b = flat[i + 1]
    if (!a.duration || !b.duration) return undefined
    const p = plan(trackOf(item.track_id, a.duration), trackOf(next.track_id, b.duration), mixOf(q, item.track_id, next.track_id))
    let hint: string | undefined
    if (p.why === 'tempo' && b.bpm) {
      const fits = parts
        .filter(x => x.id !== part)
        .map(x => ({ x, bpms: x.items.map(y => flat[flatIndex(y.item_id)]?.bpm).filter((v): v is number => !!v) }))
        .filter(({ bpms }) => bpms.length)
        .map(({ x, bpms }) => ({ x, gap: Math.abs(bpms.reduce((s, v) => s + v, 0) / bpms.length / b.bpm! - 1) }))
        .filter(f => f.gap <= 0.08)
        .sort((m, n) => m.gap - n.gap)
      if (fits[0]) hint = `Move to ${fits[0].x.name}?`
    }
    return transitionChips(p, a, b, hint)
  }
  const metaOf = (i: PlaylistItem): Meta => {
    const raw = rawOf(i.track_id)
    return { bpm: raw?.bpm || byId.get(i.track_id)?.bpm, camelot: raw?.camelot, genre: raw?.genre, conf: raw?.genreConf ?? 1 }
  }
  const order = (mode: OrderMode, part?: string | 'whole') => {
    const ids = part && part !== 'whole' ? parts.find(p => p.id === part)!.items : items
    run(playlistApi.reorder(node.id, autoOrder(ids.map(setOf), mode), part === 'whole' || !part ? undefined : part, part === 'whole' && isSet(node)))
  }
  const orderMenu = (label: string, part?: string) => (
    <div className="dropdown dropdown-end">
      <button tabIndex={0} className="btn btn-ghost btn-xs">{label} ▾</button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-56 rounded-xl bg-base-200 p-1 shadow-lg">
        {ORDERS.map(([mode, name]) => <li key={mode}><button onClick={() => { blur(); order(mode, part ?? 'whole') }}>{name}</button></li>)}
      </ul>
    </div>
  )
  const groups: { id: string | null; name?: string; items: PlaylistItem[] }[] = isSet(node)
    ? parts.map(p => ({ id: p.id, name: p.name, items: p.items }))
    : [{ id: null, items }]
  const partRefs = parts.map(p => ({ id: p.id, name: p.name }))

  const drop = (to: Drop) => {
    const from = drag && locate(node, drag)
    setDrag(undefined)
    if (!drag || !from) return
    // The server removes the item before inserting, so a later slot of the same list shifts up.
    const index = from.part === to.part && from.index < to.index ? to.index - 1 : to.index
    run(playlistApi.moveItem(node.id, drag, index, to.part ?? undefined))
  }
  const shift = (i: PlaylistItem, part: string | null, at: number, by: number) =>
    run(playlistApi.moveItem(node.id, i.item_id, at + by, part ?? undefined))

  const playPart = (part?: string) => run(startPlayback(() => playlistApi.play(node.id, part).then(() => undefined)))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <div className="flex-1 min-w-40 leading-tight">
          <h2 className="truncate text-lg font-semibold">{node.name}</h2>
          <p className="text-xs text-base-content/60">
            {summary(total)}{isSet(node) && ` · ${parts.length} parts`}
            {smart && ' · fills itself from the rules'}
          </p>
        </div>
        {items.length > 0 && <button onClick={() => playPart()} className="btn btn-primary btn-sm">{isSet(node) ? 'Play set' : 'Play'}</button>}
        {!smart && items.length > 1 && orderMenu(isSet(node) ? 'Auto-order whole set' : 'Auto-order')}
        {!smart && <button onClick={() => setFilling(true)} className="btn btn-ghost btn-sm">Fill from library</button>}
        {smart ? (
          <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit rules</button>
        ) : (
          <button
            onClick={() => { const n = window.prompt(isSet(node) ? 'New part' : 'Split into parts: name of the new part', isSet(node) ? `Part ${parts.length + 1}` : 'Part 2'); if (n?.trim()) run(playlistApi.addPart(node.id, n)) }}
            className="btn btn-ghost btn-sm"
          >
            {isSet(node) ? 'Add a part' : 'Split into parts'}
          </button>
        )}
      </div>
      {!smart && <SetCurve groups={groups.map(g => ({ name: g.name, tracks: g.items.map(i => flat[flatIndex(i.item_id)]) }))} now={now} />}
      {!items.length && !parts.length ? (
        <p className="px-3 py-8 text-center text-sm text-base-content/60">
          {smart ? 'No track matches these rules yet.' : 'Empty. Add tracks with the + on any track row.'}
        </p>
      ) : (
        groups.map(g => {
          const part = parts.find(p => p.id === g.id)
          return (
            <section key={g.id ?? 'all'}>
              {part && (
                <div
                  className="flex flex-wrap items-center gap-x-2 px-1 pb-1 pt-1"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); drop({ part: part.id, index: part.items.length }) }}
                >
                  <button
                    onClick={() => setFolded(s => { const n = new Set(s); if (!n.delete(part.id)) n.add(part.id); return n })}
                    aria-expanded={!folded.has(part.id)}
                    aria-label={`${folded.has(part.id) ? 'Expand' : 'Collapse'} ${part.name}`}
                    className="btn btn-ghost btn-circle btn-xs"
                  >
                    <svg className={`w-3 h-3 transition-transform ${folded.has(part.id) ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <div className="flex-1 min-w-0 leading-tight">
                    <h3 className="truncate text-sm font-semibold">{part.name}</h3>
                    <p className="text-xs text-base-content/60">{summary(statsOf(part.items, facts), dominant(part.items.map(i => metaOf(i).genre)))}</p>
                  </div>
                  <button onClick={() => playPart(part.id)} className="btn btn-ghost btn-xs">Play</button>
                  {part.items.length > 1 && orderMenu('Auto-order', part.id)}
                  <button
                    onClick={() => { const n = window.prompt('Rename part', part.name); if (n?.trim()) run(playlistApi.renamePart(node.id, part.id, n)) }}
                    className="btn btn-ghost btn-xs"
                  >Rename</button>
                  <button
                    onClick={() => { if (window.confirm(`Remove ${part.name}? Its tracks join a neighbouring part.`)) run(playlistApi.removePart(node.id, part.id)) }}
                    className="btn btn-ghost btn-xs text-error"
                  >Remove</button>
                </div>
              )}
              <ul className={part && !g.items.length ? 'min-h-10 rounded-xl border border-dashed border-white/10' : ''} hidden={!!g.id && folded.has(g.id)}>
                {g.items.map((item, i) => (
                  <Row
                    key={item.item_id}
                    item={item}
                    track={byId.get(item.track_id)}
                    meta={metaOf(item)}
                    chips={chipsAfter(item, g.id)}
                    onGenre={reload}
                    index={i}
                    last={i === g.items.length - 1}
                    parts={partRefs}
                    here={g.id}
                    {...(!smart && {
                      onDragStart: () => setDrag(item.item_id),
                      onDropHere: () => drop({ part: g.id, index: i }),
                      onUp: () => shift(item, g.id, i, -1),
                      onDown: () => shift(item, g.id, i, 1),
                      onRemove: () => run(playlistApi.removeItem(node.id, item.item_id)),
                      onToPart: (to: string) => run(playlistApi.moveItem(node.id, item.item_id, Number.MAX_SAFE_INTEGER, to)),
                    })}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
      {editing && <SmartForm node={node} onClose={() => setEditing(false)} />}
      {filling && <FillDialog node={node} byId={byId} toSet={(id, t) => setTrack(id, t?.duration ?? 0, t?.bpm)} onClose={() => setFilling(false)} />}
    </div>
  )
}
