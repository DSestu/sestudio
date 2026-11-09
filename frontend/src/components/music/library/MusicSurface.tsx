import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import { folderName, type MusicTrack } from '../../../musicLibrary'
import type { LibraryStatus } from '../../../musicLibraries'
import { applyPreset, useColour, useGrouping } from '../../../musicGrouping'
import { useMusicQueue } from '../../../musicQueue'
import type { Summary } from '../../../musicMeta'
import { currentParams, patchParams } from '../../../nav'
import { useModalBack } from '../../../useModalBack'
import { addTracks } from '../adding'
import { playFrom } from '../player'
import Explorer from './Explorer'
import type { TreeHandlers } from './ExplorerTree'
import { factsFrom } from './facts'
import { DIMS, findNode, treeOf, type GroupNode, type Grouping } from './grouping'
import { Ic } from './icons'
import Tape, { type Join } from './Tape'
import TapeBar, { type Order, type Shape } from './TapeBar'
import type { TapeGroup } from './tapeLayout'
import { toast } from '../toast'

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
  const inView = source?.all ?? all
  const viewTree = useMemo(() => (source ? treeOf(source.all, grouping, facts) : tree), [source, tree, grouping, facts])
  const groups = useMemo(() => tapeGroupsOf(viewTree, grouping), [viewTree, grouping])
  // Grouped by default, whatever opens (§2.4); Best blend asks the server for the order and the joins.
  const [order, setOrder] = useState<Order>('grouped')
  const [shape, setShape] = useState<Shape>('Arc')
  const sourceName = source ? source.name : 'Whole library'
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a new source opens Grouped
  useEffect(() => { setOrder('grouped') }, [sourceKey])
  const blend = useBlendOrder(order === 'blend' ? inView.slice(0, BLEND_CAP) : undefined, shape, byId)
  const blendGroups = useMemo<TapeGroup[] | undefined>(() => blend && [{ key: 'blend', head: `Best blend · ${shape}`, name: sourceName, tracks: blend.tracks }], [blend, shape, sourceName])
  const [selectedId, setSelectedId] = useState<string>()
  const h: TreeHandlers = {
    sourceKey,
    facts,
    colour,
    playingId,
    onOpen: n => { setSourceKey(n.key); setBrowse(false) },
    onAdd: (ts, label) => void addTracks(ts.map(t => ({ library: t.library, track_id: t.id })), undefined, `Added ${ts.length === 1 ? label : `${ts.length} tracks from ${label}`}`),
    onTrack: (t, list) => void playFrom(list, t),
  }
  const explorer = (
    <Explorer tree={tree} total={all.length} libraries={libraries} h={h} dir={grouping.files ? source : undefined}
      onList={onList} onNewList={onNewList} onFlow={onFlow} onFlows={onFlows} onAddLibrary={onAddLibrary} onClose={wide ? undefined : () => setBrowse(false)} />
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
        {!wide && <button onClick={() => setBrowse(true)} className="btn btn-sm rounded-xl gap-1.5"><Ic name="folder" size={14} />Browse</button>}
      </TapeBar>
      <Tape
        groups={order === 'blend' && blendGroups ? blendGroups : groups} facts={facts} colour={colour}
        joins={order === 'blend' ? blend?.joins : undefined} selectedId={selectedId} playingId={playingId}
        onSelect={t => setSelectedId(t.id)} onPlay={t => void playFrom(order === 'blend' && blend ? blend.tracks : inView, t)}
      />
    </>
  )
  if (!wide) {
    return (
      <div className="flex flex-col gap-3">
        {centre}
        {browse && <ResponsiveModal onClose={() => setBrowse(false)} boxClassName="flex h-[82vh] flex-col p-0">{explorer}</ResponsiveModal>}
      </div>
    )
  }
  return (
    <div className="flex gap-4 h-[calc(100dvh-15.5rem-var(--music-bar,0rem))] min-h-0">
      <aside className="w-80 shrink-0 overflow-hidden rounded-2xl bg-white/5">{explorer}</aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl">{centre}</div>
      <aside className="w-85 shrink-0 overflow-y-auto rounded-2xl bg-white/5">
        {right ?? <p className="p-4 text-xs text-base-content/45">{selectedId ? byId.get(selectedId)?.title : 'Select a track to see its details here.'}</p>}
      </aside>
    </div>
  )
}

/** Best blend caps the tracks it orders (§2.4). */
const BLEND_CAP = 160

interface BlendResult { tracks: MusicTrack[]; joins: Join[]; score: number; rough: number }

/** The server's Best blend of `tracks` for `shape`; undefined while it works or when off. */
function useBlendOrder(tracks: MusicTrack[] | undefined, shape: Shape, byId: Map<string, MusicTrack>): BlendResult | undefined {
  const [out, setOut] = useState<{ key: string; result: BlendResult }>()
  const key = tracks ? `${shape}|${tracks.map(t => t.id).join(',')}` : ''
  useEffect(() => {
    if (!tracks) return
    const ctrl = new AbortController()
    fetch('/api/music/set/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: tracks.map(t => t.id), shape }), signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`order: ${r.status}`))))
      .then((res: { order: string[]; joins: Join[] }) => {
        const ordered = res.order.map(id => byId.get(id)).filter((t): t is MusicTrack => !!t)
        const score = res.joins.length ? Math.round((res.joins.reduce((s, j) => s + j.blend, 0) / res.joins.length) * 100) : 100
        setOut({ key, result: { tracks: ordered, joins: res.joins, score, rough: res.joins.filter(j => j.mark === 'rough').length } })
      })
      .catch((e: Error) => { if (e.name !== 'AbortError') toast(e.message) })
    return () => ctrl.abort()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` names the request
  return out?.key === key ? out.result : undefined
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
