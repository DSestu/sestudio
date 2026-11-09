import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import { folderName, type MusicTrack } from '../../../musicLibrary'
import type { LibraryStatus } from '../../../musicLibraries'
import { applyPreset, useColour, useGrouping } from '../../../musicGrouping'
import { useMusicQueue } from '../../../musicQueue'
import type { Summary } from '../../../musicMeta'
import { currentParams, patchParams } from '../../../nav'
import { useModalBack } from '../../../useModalBack'
import { removeFromSet, useSet } from '../../../musicSet'
import { addTracksToSet } from './setQueue'
import SetLane from './SetLane'
import { clearSelection, idsIn, useSelection } from './selection'
import { playFrom } from '../player'
import Explorer from './Explorer'
import type { TreeHandlers } from './ExplorerTree'
import { factsFrom } from './facts'
import { DIMS, findNode, treeOf, type GroupNode, type Grouping } from './grouping'
import { Ic } from './icons'
import Tape from './Tape'
import { BLEND_CAP, useBlendOrder, useSetOrder } from './blendOrder'
import SetList from './SetList'
import TapeBar, { type Order, type Shape } from './TapeBar'
import type { TapeGroup } from './tapeLayout'
import { LINK_RE, useMusicQuery } from '../../../musicQuery'
import ExplorerSearch from './ExplorerSearch'
import { isEmpty, matches, parseQuery } from './searchWords'
import HoverCard from './HoverCard'
import { useHoverCard } from './hoverCard'
import Orbit from './Orbit'
import TrackInfo from './TrackInfo'

// The Music page as one surface (SPEC-music-library §2.1): explorer · centre · right column,
// three columns that scroll on their own on desktop; stacked on a phone, the explorer sliding in.

export default function MusicSurface({ all, libraries, get, v, wide, right, onList, onNewList, onFlow, onFlows, onAddLibrary }: {
  all: MusicTrack[]
  libraries: LibraryStatus[]
  get: (id: string) => Summary | undefined
  /** Bumps when summaries land, so the tree regroups. */
  v: number
  wide: boolean
  /** What the right column shows for now (the Fits panel); PR 4 brings the track info. */
  right?: ReactNode
  onList: (id: string) => void
  onNewList: () => void
  onFlow: (id: string) => void
  onFlows: () => void
  onAddLibrary: () => void
}) {
  const grouping = useGrouping()
  const byId = useMemo(() => new Map(all.map(t => [t.id, t])), [all])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `v` stands for the summaries behind `get`
  const facts = useMemo(() => factsFrom(get, byId), [get, byId, v])
  const tree = useMemo(() => treeOf(all, grouping, facts), [all, grouping, facts])
  // The source is a node of the tree; old links (§4: ?al= ?ar= ?lib= ?genre=) name one too.
  const [sourceKey, setSourceKey] = useState(() => {
    const p = currentParams()
    const al = p.get('al')
    if (al) return folderName(al.slice(al.indexOf('|') + 1))
    return p.get('ar') ?? p.get('genre') ?? p.get('lib') ?? p.get(grouping.files ? 'dir' : 'grp') ?? ''
  })
  useEffect(() => {
    const p = currentParams()
    const preset = p.get('al') ? 'album' : p.get('ar') ? 'artist' : p.get('lib') ? 'files' : p.get('genre') ? 'genre' : undefined
    if (!preset) return
    applyPreset(preset)
    patchParams({ al: undefined, ar: undefined, lib: undefined, genre: undefined })
  }, [])
  // A node the grouping no longer has (the grouping changed under it) means the whole library.
  const source = sourceKey ? findNode(tree, sourceKey) : undefined
  useEffect(() => { patchParams({ grp: source && !grouping.files ? source.key : undefined, dir: source && grouping.files ? source.key : undefined }) }, [source, grouping.files])
  const [browse, setBrowse] = useState(false)
  useModalBack(browse && !wide, () => setBrowse(false))
  const queue = useMusicQueue()
  const playingId = queue.items[queue.current]?.track_id
  const colour = useColour()
  // Search (§2.3): the words narrow the tape live; the explorer goes flat.
  const text = useMusicQuery()
  const query = useMemo(() => parseQuery(LINK_RE.test(text.trim()) ? '' : text), [text])
  const searching = !isEmpty(query)
  const matched = useMemo(() => (searching ? all.filter(t => matches(t, facts, query)) : all), [all, facts, query, searching])
  const base = source?.all ?? all
  const inView = useMemo(() => (searching ? base.filter(t => matches(t, facts, query)) : base), [base, facts, query, searching])
  const viewTree = useMemo(() => (source || searching ? treeOf(inView, grouping, facts) : tree), [source, searching, inView, tree, grouping, facts])
  const groups = useMemo(() => tapeGroupsOf(viewTree, grouping), [viewTree, grouping])
  // Grouped by default, whatever opens (§2.4); Best blend asks the server for the order and the joins.
  const [order, setOrder] = useState<Order>('grouped')
  const [shape, setShape] = useState<Shape>('Arc')
  const sourceName = source ? source.name : 'Whole library'
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a new source opens Grouped
  useEffect(() => { setOrder('grouped') }, [sourceKey])
  const blend = useBlendOrder(order === 'blend' ? inView.slice(0, BLEND_CAP) : undefined, shape)
  const blendGroups = useMemo<TapeGroup[] | undefined>(() => blend && [{ key: 'blend', head: `Best blend · ${shape}`, name: sourceName, tracks: blend.tracks }], [blend, shape, sourceName])
  const [selectedId, setSelectedId] = useState<string>()
  const picked = idsIn(useSelection(), 'tape')
  const h: TreeHandlers = {
    sourceKey,
    facts,
    colour,
    playingId,
    hoverProps: t => hc.props(t),
    onOpen: n => { setSourceKey(n.key); setBrowse(false) },
    onAdd: (ts, label) => { addTracksToSet(ts, label) },
    onTrack: (t, list) => void playFrom(list, t),
  }
  const hc = useHoverCard()
  const focusTrack = (selectedId && byId.get(selectedId)) || (playingId && byId.get(playingId)) || undefined
  const set = useSet()
  const setView = useSetOrder(set)
  const inSet = useMemo(() => new Set(set.tracks.map(t => t.id)), [set.tracks])
  // + on a track: in the set, or out of it again.
  const toggleOne = (t: MusicTrack) => (inSet.has(t.id) ? removeFromSet([t.id]) : h.onAdd([t], t.title))
  const rightColumn = focusTrack ? (
    <>
      <TrackInfo
        track={focusTrack} selected={!!selectedId} facts={facts} colour={colour} libraries={libraries}
        onClear={() => setSelectedId(undefined)} onPlay={() => void playFrom(inView.some(t => t.id === focusTrack.id) ? inView : [focusTrack], focusTrack)}
        action={{ label: inSet.has(focusTrack.id) ? 'Remove from set' : 'Add to set', onClick: () => toggleOne(focusTrack) }}
      />
      <Orbit focus={focusTrack} all={all} facts={facts} colour={colour} inSet={inSet} onFocus={t => setSelectedId(t.id)} onAdd={toggleOne} />
    </>
  ) : <p className="p-4 text-xs text-base-content/45">Select a track to see its details here.</p>
  const explorer = (
    <Explorer tree={tree} total={all.length} libraries={libraries} h={h} dir={grouping.files ? source : undefined}
      onList={onList} onNewList={onNewList} onFlow={onFlow} onFlows={onFlows} onAddLibrary={onAddLibrary} onClose={wide ? undefined : () => setBrowse(false)}
      search={searching ? { words: text.trim(), body: <ExplorerSearch query={query} matched={matched} h={h} onOpenAs={(p, k) => { applyPreset(p); setSourceKey(k); setBrowse(false) }} onList={onList} onFlow={onFlow} /> } : undefined} />
  )
  const kindLabel = source ? (source.kind === 'folder' || source.kind === 'library' ? 'Folder' : source.kind === 'all' ? '' : DIMS[source.kind].label) : ''
  const centre = (
    <>
      <TapeBar
        source={source ? { kind: kindLabel, name: source.name } : undefined} onClearSource={() => setSourceKey('')}
        tracks={inView} grouping={grouping} order={order} onOrder={setOrder} shape={shape} onShape={setShape} colour={colour} facts={facts}
        blendLine={order === 'blend' ? (blend ? `${blend.score} blend · ${blend.rough} rough ${blend.rough === 1 ? 'join' : 'joins'}${inView.length > BLEND_CAP ? ` · first ${BLEND_CAP}` : ''}` : 'ordering…') : undefined}
        onAddAll={() => h.onAdd(inView, sourceName)}
      >
        {picked.size > 1 && (
          <span className="flex h-8 items-center gap-1 rounded-[10px] bg-primary/15 pl-3 pr-1 text-xs text-primary">
            <b>{picked.size}</b> selected · drag them, or
            <button onClick={() => { h.onAdd(inView.filter(t => picked.has(t.id)), `${picked.size} tracks`); clearSelection() }} className="btn btn-xs rounded-lg">Add to set</button>
            <button onClick={clearSelection} className="btn btn-ghost btn-xs rounded-lg">Clear</button>
          </span>
        )}
        {!wide && <button onClick={() => setBrowse(true)} className="btn btn-sm rounded-xl gap-1.5"><Ic name="folder" size={14} />Browse</button>}
      </TapeBar>
      <Tape
        groups={order === 'blend' && blendGroups ? blendGroups : groups} facts={facts} colour={colour}
        joins={order === 'blend' ? blend?.joins : undefined} selectedId={selectedId} playingId={playingId}
        onSelect={t => setSelectedId(t.id)} onPlay={t => void playFrom(order === 'blend' && blend ? blend.tracks : inView, t)} hoverProps={hc.props} picked={picked}
      />
      <SetLane order={setView} facts={facts} colour={colour} get={get} wide={wide} sourceName={source?.kind === 'album' ? source.name : undefined} selectedId={selectedId} onSelect={t => setSelectedId(t.id)} hoverProps={hc.props} />
      <SetList order={setView} facts={facts} colour={colour} byId={byId} selectedId={selectedId} onSelect={t => setSelectedId(t.id)} hoverProps={hc.props} />
      {hc.hover && <HoverCard hover={hc.hover} facts={facts} colour={colour} />}
    </>
  )
  if (!wide) {
    return (
      <div className="flex flex-col gap-3">
        {centre}
        {rightColumn}
        {browse && <ResponsiveModal onClose={() => setBrowse(false)} boxClassName="flex h-[82vh] flex-col p-0">{explorer}</ResponsiveModal>}
      </div>
    )
  }
  return (
    <div className="flex gap-4 h-[calc(100dvh-15.5rem-var(--music-bar,0rem))] min-h-0">
      <aside className="w-80 shrink-0 overflow-hidden rounded-2xl bg-white/5">{explorer}</aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl">{centre}</div>
      <aside className="w-85 shrink-0 overflow-y-auto rounded-2xl bg-white/5">
        {right ?? rightColumn}
      </aside>
    </div>
  )
}



/** The leaves of the tree as tape groups: with 2+ levels the parent is the large head. */
function tapeGroupsOf(tree: GroupNode[], g: Grouping): TapeGroup[] {
  const out: TapeGroup[] = []
  const walk = (nodes: GroupNode[], trail: string[]) => nodes.forEach(n => {
    if (n.files?.length) out.push({ key: n.key, head: trail[0] ?? n.name, name: trail.length ? [...trail.slice(1), n.name].join(' / ') : 'Top level', tracks: n.files })
    if (n.kids) walk(n.kids, [...trail, n.name])
    else if (!n.files) out.push({ key: n.key, head: g.dims.length > 1 ? trail[trail.length - 1] ?? '' : '', name: n.name, tracks: n.all })
  })
  walk(tree, [])
  return out
}
