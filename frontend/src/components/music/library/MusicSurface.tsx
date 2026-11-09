import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import { folderName, type MusicTrack } from '../../../musicLibrary'
import type { LibraryStatus } from '../../../musicLibraries'
import { applyPreset, useGrouping } from '../../../musicGrouping'
import { useMusicQueue } from '../../../musicQueue'
import type { Summary } from '../../../musicMeta'
import { currentParams, patchParams } from '../../../nav'
import { useModalBack } from '../../../useModalBack'
import { addTracks } from '../adding'
import { playFrom } from '../player'
import { totalTime } from '../format'
import Explorer from './Explorer'
import type { TreeHandlers } from './ExplorerTree'
import { factsFrom } from './facts'
import { DIMS, findNode, treeOf } from './grouping'
import { Ic } from './icons'
import TrackList from './TrackList'

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
  const inView = source?.all ?? all
  const viewTree = useMemo(() => (source ? treeOf(source.all, grouping, facts) : tree), [source, tree, grouping, facts])
  const h: TreeHandlers = {
    sourceKey,
    facts,
    playingId,
    onOpen: n => { setSourceKey(n.key); setBrowse(false) },
    onAdd: (ts, label) => void addTracks(ts.map(t => ({ library: t.library, track_id: t.id })), undefined, `Added ${ts.length === 1 ? label : `${ts.length} tracks from ${label}`}`),
    onTrack: (t, list) => void playFrom(list, t),
  }
  const explorer = (
    <Explorer tree={tree} total={all.length} libraries={libraries} h={h} dir={grouping.files ? source : undefined}
      onList={onList} onNewList={onNewList} onFlow={onFlow} onFlows={onFlows} onAddLibrary={onAddLibrary} onClose={wide ? undefined : () => setBrowse(false)} />
  )
  const chip = (
    <div className="flex items-center gap-2 px-1">
      {!wide && <button onClick={() => setBrowse(true)} className="btn btn-sm rounded-full gap-1.5 relative hit"><Ic name="folder" size={14} />Browse</button>}
      <span className={`flex h-8 items-center gap-1 rounded-full px-3 text-xs ${source ? 'bg-primary/15 text-primary' : 'bg-white/6 text-base-content/70'}`}>
        {source ? <>{source.kind === 'all' ? '' : `${source.kind === 'folder' || source.kind === 'library' ? 'Folder' : DIMS[source.kind as keyof typeof DIMS]?.label ?? ''}: `}{source.name}
          <button onClick={() => setSourceKey('')} aria-label="Show the whole library" className="ml-1 grid size-5 place-items-center rounded-full hover:bg-white/10"><Ic name="close" size={11} width={2.4} /></button></>
          : 'Whole library'}
      </span>
      <span className="text-xs text-base-content/50">{inView.length} tracks · {totalTime(inView.reduce((s, t) => s + t.duration, 0))}</span>
    </div>
  )
  const centre = (
    <TrackList tree={viewTree} grouping={grouping} facts={facts} onPlay={h.onTrack} onAdd={h.onAdd} />
  )
  if (!wide) {
    return (
      <div className="flex flex-col gap-3">
        {chip}
        {centre}
        {browse && <ResponsiveModal onClose={() => setBrowse(false)} boxClassName="flex h-[82vh] flex-col p-0">{explorer}</ResponsiveModal>}
      </div>
    )
  }
  return (
    <div className="flex gap-4 h-[calc(100dvh-15.5rem-var(--music-bar,0rem))] min-h-0">
      <aside className="w-80 shrink-0 overflow-hidden rounded-2xl bg-white/5">{explorer}</aside>
      <div className="min-w-0 flex-1 overflow-y-auto rounded-2xl">
        <div className="sticky top-0 z-10 bg-base-100/90 py-2 backdrop-blur">{chip}</div>
        {centre}
      </div>
      <aside className="w-85 shrink-0 overflow-y-auto rounded-2xl bg-white/5">
        {right ?? <p className="p-4 text-xs text-base-content/45">Select a track to see its details here.</p>}
      </aside>
    </div>
  )
}
