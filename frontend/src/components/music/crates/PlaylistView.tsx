import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import {
  isSet, itemsOf, locate, playlistApi, statsOf,
  type PartStats, type PlaylistItem, type PlaylistNode,
} from '../../../musicPlaylists'
import { keyDisplay } from '../../../harmony'
import { useTheory } from '../../../musicTheory'
import { join } from './proximity'
import { post, useMusicQueue } from '../../../musicQueue'
import { useSettings } from '../../../useSettings'
import ClashTip from './ClashTip'
import FitsNext from '../FitsNext'
import SaveAsPlaylist from '../SaveAsPlaylist'
import ResponsiveModal from '../../ResponsiveModal'
import { useModalBack } from '../../../useModalBack'
import JoinDialog from './JoinDialog'
import JoinLine from './JoinLine'
import { toast } from '../toast'
import { mixOf, rawOf, setTrackOf, trackOf, useAnalyses } from '../mix/analysis'
import { plan } from '../mix/plan'
import { startPlayback, usePosition } from '../player'
import Apply from './build/Apply'
import ArcsWay from './build/ArcsWay'
import GenreTag from './GenreTag'
import Explore from '../explore/Explore'
import { SmartForm } from './PlaylistTree'
import SetCurve from './SetCurve'
import { autoOrder, ORDERS, bestReorders, countJoins, isClash, keptKey, placement, transitionChips, type Chip, type OrderMode, type Reorder } from './setBuilder'
import { useKeptJoins } from './useKeptJoins'


const WIDE = '(min-width: 64rem)'
const useWide = () => useSyncExternalStore(
  cb => { const m = matchMedia(WIDE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
  () => matchMedia(WIDE).matches,
)

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

function ChipLine({ id, selected, chips = [], children }: { id?: string; selected?: boolean; chips?: Chip[]; children?: ReactNode }) {
  return (
    <div id={id} className={`flex flex-wrap items-center gap-1.5 pb-1 pl-8 pr-3 ${selected ? 'mx-1 mb-1 rounded-lg bg-primary/10 pt-1 ring-1 ring-primary/40' : ''}`}>
      {chips.map(c => (
        <span key={c.text} className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${c.tone === 'warn' ? 'bg-warning/15 text-warning' : 'bg-white/5 text-base-content/60'}`}>{c.text}</span>
      ))}
      {children}
    </div>
  )
}

/** A track's analysis as shown on its row. */
interface Meta {
  bpm?: number
  key?: string
  camelot?: string
  harmony?: { track?: { tonic: string; mode: string } }
  genre?: string
  conf: number
}

interface RowProps {
  item: PlaylistItem
  track?: MusicTrack
  meta: Meta
  chips?: Chip[]
  /** How this row joins the next one. */
  join?: ReactNode
  onGenre: () => void
  /** Replace the queue with the playlist, starting here. */
  onPlay: () => void
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
  /** The row is the inspector's target. */
  selected?: boolean
  /** The inspector is on the join after this row. */
  joinSelected?: boolean
  onSelect?: () => void
}

function Row({ item, track, meta, chips, join, onGenre, onPlay, parts, here, last, index, ...ev }: RowProps) {
  const title = track?.title ?? item.title ?? 'Missing track'
  const artist = track?.artist ?? item.artist ?? ''
  const duration = track?.duration ?? item.duration ?? 0
  const key = keyDisplay(useTheory(), meta)
  return (
    <li
      draggable={!!ev.onDragStart}
      onDragStart={ev.onDragStart}
      onDragOver={ev.onDropHere && (e => e.preventDefault())}
      onDrop={ev.onDropHere && (e => { e.preventDefault(); ev.onDropHere!() })}
    >
      <div className={`flex items-center gap-1 rounded-xl hover:bg-white/5 ${ev.selected ? 'bg-primary/10' : ''}`}>
      {ev.onDragStart && (
        <svg className="ml-1 w-4 h-4 shrink-0 cursor-grab text-base-content/30" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
      )}
      <button onClick={onPlay} className="flex-1 min-w-0 flex items-center gap-3 px-3 h-12 text-left">
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-base-content/60">{artist}</span>
        </span>
      </button>
      {item.library === 'online' && <span className="hidden sm:inline text-[11px] text-base-content/40">{item.source === 'ytmusic' ? 'YT Music' : 'YouTube'}</span>}
      {meta.genre && <span className="hidden sm:block"><GenreTag id={item.track_id} genre={meta.genre} conf={meta.conf} onChange={onGenre} /></span>}
      {key && <span className="inline-flex items-center gap-1.5 rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-base-content/70">{key.color && <i className="inline-block size-2 rounded-full" style={{ background: key.color }} />}{key.text}</span>}
      {meta.bpm !== undefined && <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(meta.bpm)}<span className="hidden sm:inline"> bpm</span></span>}
      <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(duration)}</span>
      {ev.onRemove && (
        <div className="dropdown dropdown-end">
          <button tabIndex={0} aria-label={`Options for ${title}`} className="btn btn-ghost btn-circle btn-sm mr-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-52 rounded-xl bg-base-200 p-1 shadow-lg">
            {ev.onSelect && <li><button onClick={() => { blur(); ev.onSelect!() }}>Fits next</button></li>}
            {index > 0 && <li><button onClick={() => { blur(); ev.onUp!() }}>Move up</button></li>}
            {!last && <li><button onClick={() => { blur(); ev.onDown!() }}>Move down</button></li>}
            {parts.filter(p => p.id !== here).map(p => <li key={p.id}><button onClick={() => { blur(); ev.onToPart!(p.id) }}>Move to {p.name}</button></li>)}
            <li><button className="text-error" onClick={() => { blur(); ev.onRemove!() }}>Remove from playlist</button></li>
          </ul>
        </div>
      )}
      </div>
      {meta.genre && <div className="pb-1 pl-8 sm:hidden"><GenreTag id={item.track_id} genre={meta.genre} conf={meta.conf} onChange={onGenre} /></div>}
      {(chips || join) && <ChipLine id={`join-${item.item_id}`} selected={ev.joinSelected} chips={chips}>{join}</ChipLine>}
    </li>
  )
}

/** A playlist's tracks (grouped by part for a set) or a smart list's matches. */
export default function PlaylistView({ node, byId, onPlaylist }: { node: PlaylistNode; byId: ReadonlyMap<string, MusicTrack>; onPlaylist: (t: MusicTrack) => void }) {
  const [matches, setMatches] = useState<{ id: string; list: PlaylistItem[] }>()
  const [editing, setEditing] = useState(false)
  /** The Draw the arcs editor, rebuilding this playlist. */
  const [arcs, setArcs] = useState(false)
  useModalBack(arcs, () => setArcs(false))
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

  const items = useMemo(() => smart ? (matches?.id === node.id + rulesKey ? matches.list : []) : itemsOf(node), [smart, matches, node, rulesKey])
  const facts = (i: PlaylistItem) => {
    const t = byId.get(i.track_id)
    return t ? { duration: t.duration, bpm: t.bpm } : { duration: i.duration ?? 0 }
  }
  const total = useMemo(() => statsOf(items, facts), [items, byId]) // eslint-disable-line react-hooks/exhaustive-deps
  const parts = node.parts ?? []

  const q = useMusicQueue()
  const [settings] = useSettings()
  const [tick, reload] = useAnalyses(items.map(i => i.track_id))
  /** Flat index of the first track of the join shown in the dialog. */
  const [joinAt, setJoinAt] = useState<number>()
  const [kept, keep] = useKeptJoins(node.id)
  const wide = useWide()
  /** The inspector: open or not, the row picked, and whether the target is the join after it. */
  const [insp, setInsp] = useState(false)
  const [sel, setSel] = useState<string>()
  const [between, setBetween] = useState(false)
  /** The tracks as a list or as a map of mood and energy. */
  const [mode, setMode] = useState<'list' | 'map'>('list')
  useModalBack(insp && !wide, () => setInsp(false))
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  /** A track with its analysis (the set builder's view of it); `id` defaults to the track's. */
  const setOf = (i: PlaylistItem) => { const f = facts(i); return setTrackOf(i.track_id, f.duration, f.bpm, i.item_id) }
  const flat = useMemo(() => items.map(setOf), [items, byId, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The playlist replaces the queue and plays from this row; rows whose track is gone are left out. */
  const playFrom = (from: PlaylistItem) => {
    const rows = items.filter(i => i.library === 'online' || byId.has(i.track_id))
    run(startPlayback(() => post({
      tracks: rows.map(i => i.library === 'online'
        ? { library: i.library, track_id: i.track_id, source: i.source, title: i.title, artist: i.artist, duration: i.duration }
        : { library: i.library, track_id: i.track_id }),
      replace: true,
      start: Math.max(0, rows.findIndex(i => i.item_id === from.item_id)),
    })))
  }
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
  /** The join to the next row; a clash's Fix and the + open Fits between for it. */
  const joinAfter = (item: PlaylistItem): ReactNode => {
    const i = flatIndex(item.item_id)
    if (smart || i < 0 || i >= items.length - 1) return undefined
    const [a, b] = [flat[i], flat[i + 1]]
    return (
      <JoinLine
        a={a} b={b} theory={settings.music_theory_level === 'theory'} kept={kept.has(keptKey(a, b))}
        onOpen={() => setJoinAt(i)} onFix={() => pick(item, true)} onInsert={() => pick(item, true)}
      />
    )
  }
  /** The inspector's target: the picked row, else the last track. */
  const target = Math.max(0, sel && flatIndex(sel) >= 0 ? flatIndex(sel) : items.length - 1)
  const pick = (item: PlaylistItem, join = false) => { setSel(item.item_id); setBetween(join); setInsp(true) }
  const insertAfterTarget = (t: MusicTrack) => {
    const at = items[target] && locate(node, items[target].item_id)
    run(playlistApi.add(node.id, [{ library: t.library, track_id: t.id }], at ? at.part ?? undefined : undefined, at ? at.index + 1 : undefined).then(() => { toast(`Added ${t.title}`); setBetween(false); setSel(undefined) }))
  }
  const library = useMemo(() => [...byId.values()], [byId])
  const taken = items.map(i => i.track_id)
  const anchor = items[target] && byId.get(items[target].track_id)
  const then = between && items[target + 1] ? byId.get(items[target + 1].track_id) : undefined
  /** Joins after a row that clash and were not kept, as flat indexes. */
  const clashes = useMemo(() => flat.flatMap((t, i) => i < flat.length - 1 && isClash(join(t, flat[i + 1])) && !kept.has(keptKey(t, flat[i + 1])) ? [i] : []), [flat, kept])
  const clashHere = between && clashes.includes(target)
  /** Select the next clashing join after the current one, wrapping round, and bring it into view. */
  const nextClash = () => {
    const i = clashes.find(c => c > (between ? target : -1)) ?? clashes[0]
    if (i === undefined) return
    pick(items[i], true)
    requestAnimationFrame(() => document.getElementById(`join-${items[i].item_id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
  /** The map's path: the rows whose track is in the library, and the rows touching a clashing join. */
  const stops = useMemo(() => items.flatMap(i => { const track = byId.get(i.track_id); return track ? [{ key: i.item_id, track }] : [] }), [items, byId])
  const clashRows = useMemo(() => new Set(clashes.flatMap(i => [items[i].item_id, items[i + 1].item_id])), [clashes, items])
  const showMap = (m: 'list' | 'map') => { setMode(m); if (m === 'map' && wide) setInsp(true) }
  const mapping = mode === 'map' && !smart
  const titleAt = (i: number) => byId.get(items[i].track_id)?.title ?? items[i].title ?? 'Track'
  const reorder = (r: Reorder, text: string) => {
    const { part, index } = placement(groups.map(g => ({ id: g.id, items: g.items.map(x => x.item_id) })), items[r.from].item_id, r.to)
    run(playlistApi.moveItem(node.id, items[r.from].item_id, index, part ?? undefined).then(() => toast(`${text}: clashes ${r.before} → ${r.after}`)))
  }
  /** What else settles the clash under the Fits between list: the best swap and move, or keeping the join. */
  const otherFixes = () => {
    const { swap, move } = bestReorders(flat, target, kept)
    const fixes = [
      swap && { r: swap, text: `Swap ${titleAt(swap.from)} and ${titleAt(swap.to)}` },
      move && { r: move, text: `Move ${titleAt(move.from)} to position ${move.to + 1}` },
    ].filter(x => !!x)
    const btn = 'btn btn-sm h-11 justify-between gap-3 font-normal sm:h-8'
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-base-content/60">Or fix the clash another way</p>
        {fixes.map(x => (
          // The pair under the panel changes with the order, so the panel goes back to the last track.
          <button key={x.text} onClick={() => { reorder(x.r, x.text); setBetween(false); setSel(undefined) }} className={btn}>
            <span className="truncate">{x.text}</span>
            <span className="shrink-0 text-xs text-base-content/60">{x.r.before} → {x.r.after} {x.r.after === 1 ? 'clash' : 'clashes'}</span>
          </button>
        ))}
        <button onClick={() => { keep(keptKey(flat[target], flat[target + 1])); toast('Kept: this join is no longer flagged') }} className={btn}>
          <span>Keep this join</span>
          <span className="text-xs text-base-content/60">stops being flagged</span>
        </button>
        {/* On phones the sheet covers the header's clash count, so the next clash is reachable here too. */}
        {clashes.length > 1 && (
          <button onClick={nextClash} className={btn}>
            <span>Next clash</span>
            <span className="text-xs text-base-content/60">{clashes.indexOf(target) + 1} of {clashes.length}</span>
          </button>
        )}
      </div>
    )
  }
  const inspector = insp && !smart && (anchor ? (
    <FitsNext
      anchor={anchor} then={then} where={sel ? undefined : 'the last track'} library={library} exclude={taken}
      action={{ label: 'Insert', onPick: insertAfterTarget }} onAfter={() => setBetween(false)} onClose={() => setInsp(false)}
      footer={clashHere ? otherFixes() : undefined}
    />
  ) : <p className="p-4 text-sm text-base-content/60">Add a track to see what fits next.</p>)
  const metaOf = (i: PlaylistItem): Meta => {
    const raw = rawOf(i.track_id)
    return { bpm: raw?.bpm || byId.get(i.track_id)?.bpm, key: raw?.key, camelot: raw?.camelot, harmony: raw?.harmony, genre: raw?.genre, conf: raw?.genreConf ?? 1 }
  }
  const order = (mode: OrderMode, part?: string | 'whole') => {
    const ids = part && part !== 'whole' ? parts.find(p => p.id === part)!.items : items
    const sorted = autoOrder(ids.map(setOf), mode)
    const after = (isSet(node) && part && part !== 'whole' ? groups.flatMap(g => (g.id === part ? sorted : g.items.map(x => x.item_id))) : sorted).map(id => flat[flatIndex(id)])
    run(playlistApi.reorder(node.id, sorted, part === 'whole' || !part ? undefined : part, part === 'whole' && isSet(node)).then(() => {
      const n = countJoins(after, kept).clashes
      toast(`Ordered by ${ORDERS.find(o => o[0] === mode)![1].toLowerCase()}: ${n === 0 ? 'no clash' : `${n} ${n === 1 ? 'clash' : 'clashes'}`}`)
    }))
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
  const joinCounts = useMemo(() => countJoins(flat, kept), [flat, kept])
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
    <div className="flex items-start gap-4">
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 px-1">
        {/* The name is the page header's title. */}
        <div className="flex-1 min-w-40 leading-tight">
          <p className="text-sm text-base-content/60">
            {summary(total)}{isSet(node) && ` · ${parts.length} parts`}
            {!smart && joinCounts.clashes + joinCounts.jumps > 0 && (
              <>
                {joinCounts.clashes > 0 && (
                  <>
                    {' · '}
                    <button onClick={nextClash} title="Next clash" className="relative hit rounded-full bg-warning/15 px-2.5 py-0.5 text-warning hover:brightness-125">{joinCounts.clashes} {joinCounts.clashes === 1 ? 'clash' : 'clashes'}</button>
                  </>
                )}
                {joinCounts.jumps > 0 && <span className="text-warning">{` · ${joinCounts.jumps} tempo ${joinCounts.jumps === 1 ? 'jump' : 'jumps'}`}</span>}
              </>
            )}
            {smart && ' · fills itself from the rules'}
          </p>
        </div>
        {!smart && (
          <div role="group" aria-label="View" className="inline-flex rounded-full bg-white/6 p-0.5">
            {([['list', 'List'], ['map', 'Map']] as const).map(([m, text]) => (
              <button key={m} onClick={() => showMap(m)} aria-pressed={mode === m} className={`relative hit h-9 rounded-full px-4 text-sm font-medium ${mode === m ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:text-base-content'}`}>{text}</button>
            ))}
          </div>
        )}
        {items.length > 0 && <button onClick={() => playPart()} className="btn btn-primary btn-sm">{isSet(node) ? 'Play set' : 'Play'}</button>}
        {!smart && (
          <div className="dropdown dropdown-end">
            <button tabIndex={0} className="btn btn-ghost btn-sm relative hit gap-1.5">
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.8 15.9L9 18.75l-.8-2.85a4.5 4.5 0 00-3.1-3.1L2.25 12l2.85-.8a4.5 4.5 0 003.1-3.1L9 5.25l.8 2.85a4.5 4.5 0 003.1 3.1l2.85.8-2.85.8a4.5 4.5 0 00-3.1 3.1zM18.3 8.7L18 9.75l-.3-1.05a3.4 3.4 0 00-2.3-2.3L14.25 6l1.15-.3a3.4 3.4 0 002.3-2.3L18 2.25l.3 1.15a3.4 3.4 0 002.3 2.3l1.15.3-1.15.3a3.4 3.4 0 00-2.3 2.4z" /></svg>
              Shape ▾
            </button>
            <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-56 rounded-xl bg-base-200 p-1 shadow-lg max-sm:[&_li>button]:min-h-11">
              {items.length > 1 && (
                <>
                  <li className="menu-title">Auto-order{isSet(node) && ' the whole set'}</li>
                  {ORDERS.map(([mode, name]) => <li key={mode}><button onClick={() => { blur(); order(mode, 'whole') }}>{name}</button></li>)}
                  <li className="my-0.5 h-px bg-white/10 p-0" aria-hidden="true" />
                </>
              )}
              <li><button onClick={() => { blur(); setArcs(true) }}>Draw the arcs…</button></li>
            </ul>
          </div>
        )}
        {!smart && <button onClick={() => setInsp(o => !o)} aria-pressed={insp} className={`btn btn-sm ${insp ? 'btn-primary btn-soft' : 'btn-ghost'}`}>Fits next</button>}
        {smart ? (
          <>
            <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit rules</button>
            {/* A snapshot: the copy keeps these tracks while the smart list goes on following its rules. */}
            <SaveAsPlaylist name={node.name} tracks={items.map(i => ({ library: i.library, track_id: i.track_id }))} className="btn btn-ghost btn-sm" />
          </>
        ) : (
          <button
            onClick={() => { const n = window.prompt(isSet(node) ? 'New part' : 'Split into parts: name of the new part', isSet(node) ? `Part ${parts.length + 1}` : 'Part 2'); if (n?.trim()) run(playlistApi.addPart(node.id, n)) }}
            className="btn btn-ghost btn-sm"
          >
            {isSet(node) ? 'Add a part' : 'Split into parts'}
          </button>
        )}
      </div>
      {!smart && !mapping && joinCounts.clashes > 0 && <ClashTip />}
      {!smart && !mapping && <SetCurve groups={groups.map(g => ({ name: g.name, tracks: g.items.map(i => flat[flatIndex(i.item_id)]) }))} now={now} />}
      {mapping ? (
        <Explore
          library={library} path={stops} clash={clashRows} onPick={key => { const i = items.find(x => x.item_id === key); if (i) pick(i) }}
          anchor={anchor ? { key: items[target].item_id, track: anchor } : undefined}
          action={{ label: anchor ? `Insert after ${anchor.title}` : 'Add to this playlist', onPick: insertAfterTarget }}
          onPlaylist={onPlaylist}
        />
      ) : !items.length && !parts.length ? (
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
                    join={joinAfter(item)}
                    onGenre={reload}
                    onPlay={() => playFrom(item)}
                    index={i}
                    last={i === g.items.length - 1}
                    parts={partRefs}
                    here={g.id}
                    selected={insp && !smart && flatIndex(item.item_id) === target}
                    joinSelected={insp && !smart && between && flatIndex(item.item_id) === target}
                    {...(!smart && {
                      onDragStart: () => setDrag(item.item_id),
                      onDropHere: () => drop({ part: g.id, index: i }),
                      onSelect: () => pick(item),
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
      {joinAt !== undefined && items[joinAt + 1] && (
        <JoinDialog
          a={flat[joinAt]} b={flat[joinAt + 1]} titleA={titleAt(joinAt)} titleB={titleAt(joinAt + 1)} kept={kept.has(keptKey(flat[joinAt], flat[joinAt + 1]))}
          onFix={() => pick(items[joinAt], true)} onClose={() => setJoinAt(undefined)}
        />
      )}
      {editing && <SmartForm node={node} onClose={() => setEditing(false)} />}
      {arcs && (
        <ResponsiveModal onClose={() => setArcs(false)} boxClassName="max-w-3xl max-sm:h-full max-sm:max-h-full max-sm:rounded-none">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-semibold">Draw the arcs</h3>
            <span className="truncate text-xs text-base-content/60">for {node.name}</span>
            <button onClick={() => setArcs(false)} aria-label="Close" className="btn btn-ghost btn-sm btn-circle relative hit ml-auto">✕</button>
          </div>
          <ArcsWay byId={byId} actions={(ids, again) => <Apply ids={ids} byId={byId} onAnother={again} node={node} onDone={() => setArcs(false)} />} />
        </ResponsiveModal>
      )}
    </div>
    {inspector && wide && <aside className="sticky top-4 flex h-[calc(100vh-8rem)] w-96 shrink-0 flex-col overflow-hidden rounded-2xl bg-white/5">{inspector}</aside>}
    {inspector && !wide && (
      <ResponsiveModal onClose={() => setInsp(false)} boxClassName="flex h-[60vh] flex-col p-0">
        {inspector}
      </ResponsiveModal>
    )}
    </div>
  )
}
