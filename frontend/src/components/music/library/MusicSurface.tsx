import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import { folderName, type MusicTrack } from '../../../musicLibrary'
import type { LibraryStatus } from '../../../musicLibraries'
import { applyPreset, useColour, useGrouping } from '../../../musicGrouping'
import { useMusicQueue } from '../../../musicQueue'
import type { Summary } from '../../../musicMeta'
import { currentParams, patchParams } from '../../../nav'
import { useModalBack } from '../../../useModalBack'
import { itemsOf, type PlaylistNode } from '../../../musicPlaylists'
import { toast } from '../toast'
import { clearSelection, idsIn, useSelection } from './selection'
import { playFrom } from '../player'
import Explorer from './Explorer'
import type { TreeHandlers } from './ExplorerTree'
import { factsFrom } from './facts'
import { DIMS, findNode, treeOf, type GroupNode, type Grouping } from './grouping'
import { Ic } from './icons'
import Tape from './Tape'
import { BLEND_CAP, useBlendOrder } from './blendOrder'
import BlendBy from './BlendBy'
import PlaylistBoard, { JoinFix, SwapFor } from './PlaylistBoard'
import { addTo, removeItems, usePlaylistView } from './playlistEdit'
import TapeBar, { type Order, type Shape } from './TapeBar'
import type { TapeGroup } from './tapeLayout'
import { LINK_RE, useMusicQuery } from '../../../musicQuery'
import { isEmpty, matches, parseQuery } from './searchWords'
import HoverCard from './HoverCard'
import { useHoverCard } from './useHoverCard'
import Orbit from './Orbit'
import TrackInfo from './TrackInfo'
import { PlayAsFlowAt } from '../flows/PlayAsFlow'
import type { Source } from '../../../flowSources'
import { setMusicQuery } from '../../../musicQuery'

/** Sound words a phone can try with one tap (§2.3). */
const QUICK_WORDS = ['dark', 'floating', '128', '172']

// The Music page as one surface (SPEC-music-library §2.1): explorer · centre · right column,
// three columns that scroll on their own on desktop; stacked on a phone, the explorer sliding in.

export default function MusicSurface({ all, libraries, get, v, wide, right, openList: pickedList, draft, onSaveDraft, onOpenDraft, onCloseList, onList, onNewList, onFlow, onFlows, onAddLibrary, centreView, rightTop }: {
  all: MusicTrack[]
  libraries: LibraryStatus[]
  get: (id: string) => Summary | undefined
  /** Bumps when summaries land, so the tree regroups. */
  v: number
  wide: boolean
  /** The Fits panel when one is open, else the track info. */
  right?: ReactNode
  /** The playlist open on the board (`?pl=`), in the centre under the tape. */
  openList?: PlaylistNode
  /** The Queue: an unsaved playlist that takes the open playlist's place when none is open. */
  draft?: PlaylistNode
  onSaveDraft: () => void
  /** A phone opens the Queue as its own page. */
  onOpenDraft: () => void
  onCloseList: () => void
  onList: (id: string) => void
  onNewList: () => void
  onFlow: (id: string) => void
  onFlows: () => void
  onAddLibrary: () => void
  /** Flows or Mixes, opened from the explorer, in place of the tape and the playlist. */
  centreView?: { label: string; node: ReactNode; onClose: () => void }
  /** Above the track info in the right column; while it has content (a list's Fits) the track info hides. */
  rightTop?: ReactNode
}) {
  const grouping = useGrouping()
  // + and drops go to the open playlist, else to the Queue.
  const openList = pickedList ?? draft
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
  // The explorer's tree cut to the sound words; its name words narrow it in place.
  const soundTree = useMemo(() => {
    const sounds = { ...query, terms: [] }
    return isEmpty(sounds) ? undefined : treeOf(all.filter(t => matches(t, facts, sounds)), grouping, facts)
  }, [all, facts, query, grouping])
  const base = source?.all ?? all
  const inView = useMemo(() => (searching ? base.filter(t => matches(t, facts, query)) : base), [base, facts, query, searching])
  const viewTree = useMemo(() => (source || searching ? treeOf(inView, grouping, facts) : tree), [source, searching, inView, tree, grouping, facts])
  const groups = useMemo(() => tapeGroupsOf(viewTree, grouping), [viewTree, grouping])
  // A source (folder, album, artist...) opens in Best blend, the whole library Grouped; Best blend asks the server for the order and the joins.
  const [order, setOrder] = useState<Order>(sourceKey ? 'blend' : 'grouped')
  const [shape, setShape] = useState<Shape>('Arc')
  const sourceName = source ? source.name : 'Whole library'
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a new source opens in its default order
  useEffect(() => { setOrder(sourceKey ? 'blend' : 'grouped') }, [sourceKey])
  const blend = useBlendOrder(order === 'blend' ? inView.slice(0, BLEND_CAP) : undefined, shape)
  const blendGroups = useMemo<TapeGroup[] | undefined>(() => blend && [{ key: 'blend', head: `Best blend · ${shape}`, name: sourceName, tracks: blend.tracks }], [blend, shape, sourceName])
  const [selectedId, setSelectedId] = useState<string>()
  const [fillRef, fillStyle] = useFillHeight(wide)
  const [door, setDoor] = useState<{ at: DOMRect; name: string; source: Source } | null>(null)
  const picked = idsIn(useSelection(), 'tape')
  const h: TreeHandlers = {
    sourceKey,
    facts,
    colour,
    playingId,
    hoverProps: t => hc.props(t),
    onFlowDoor: (n, at) => setDoor({ at, name: n.name, source: n.kind === 'genre' ? { kind: 'genre', value: n.name, rule: 'lean' } : n.kind === 'library' ? { kind: 'library', value: n.all[0]?.library ?? n.name, label: n.name, rule: 'only' } : { kind: n.kind === 'artist' ? 'artist' : 'album', value: n.name, rule: 'only' } }),
    onOpen: n => { setSourceKey(n.key); setBrowse(false) },
    addTo: openList?.name,
    onAdd: (ts, label) => { if (openList) void addTo(openList, ts, label); else toast('Open a playlist, or start a New playlist, to add tracks') },
    onTrack: (t, list) => void playFrom(list, t),
  }
  const hc = useHoverCard()
  const focusTrack = (selectedId && byId.get(selectedId)) || (playingId && byId.get(playingId)) || undefined
  const view = usePlaylistView(openList, byId)
  const inSet = useMemo(() => new Set(openList ? itemsOf(openList).map(i => i.track_id) : []), [openList])
  // + on a track: in the open playlist, or out of it again.
  const toggleOne = (t: MusicTrack) => {
    const item = openList && itemsOf(openList).find(i => i.track_id === t.id)
    if (openList && item) void removeItems(openList, [item.item_id])
    else h.onAdd([t], t.title)
  }
  // A join of the playlist asked for its Fix panel; it belongs to that playlist only.
  const [join, setJoin] = useState<{ pl: string; key: string } | null>(null)
  const openJoin = openList && join?.pl === openList.id ? join.key : null
  const sel = useSelection()
  const rowSelected = !!(openList && selectedId && idsIn(sel, 'set').has(selectedId) && view.rows.some(r => r.track.id === selectedId))
  const rightColumn = openList && openJoin ? (
    <JoinFix node={openList} view={view} openJoin={openJoin} facts={facts} colour={colour} byId={byId} onClose={() => setJoin(null)} />
  ) : focusTrack ? (
    <>
      <TrackInfo
        track={focusTrack} selected={!!selectedId} facts={facts} colour={colour} libraries={libraries}
        onClear={() => setSelectedId(undefined)} onPlay={() => void playFrom(inView.some(t => t.id === focusTrack.id) ? inView : [focusTrack], focusTrack)}
        action={{ label: inSet.has(focusTrack.id) ? 'Remove from playlist' : 'Add to playlist', onClick: () => toggleOne(focusTrack), remove: inSet.has(focusTrack.id) }}
      />
      {rowSelected && openList
        ? <SwapFor node={openList} view={view} trackId={focusTrack.id} library={all} facts={facts} onDone={() => setSelectedId(undefined)} />
        : <Orbit focus={focusTrack} all={all} facts={facts} get={get} colour={colour} inSet={inSet} onFocus={t => setSelectedId(t.id)} onAdd={toggleOne} />}
    </>
  ) : <p className="p-4 text-xs text-base-content/45">Select a track to see its details here.</p>
  const explorer = (
    <Explorer tree={tree} total={all.length} libraries={libraries} h={h} dir={grouping.files ? source : undefined}
      onList={onList} onNewList={onNewList} onFlow={onFlow} onFlows={onFlows} onAddLibrary={onAddLibrary} onClose={wide ? undefined : () => setBrowse(false)}
      query={query} soundTree={soundTree} matched={matched} />
  )
  const kindLabel = source ? (source.kind === 'folder' || source.kind === 'library' ? 'Folder' : source.kind === 'all' ? '' : DIMS[source.kind].label) : ''
  const quick = !wide && (
    <>
      {/* The phone's search bar is the explorer's box: a tap opens it with the keyboard up. */}
      <button onClick={() => setBrowse(true)} className="input flex w-full items-center gap-2 text-left">
        <Ic name="search" size={15} className="shrink-0 text-base-content/60" />
        <span className={`min-w-0 flex-1 truncate ${text ? '' : 'text-base-content/60'}`}>{text || 'Search or paste a link'}</span>
      </button>
      <div role="group" aria-label="Quick" className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {QUICK_WORDS.map(w => <button key={w} onClick={() => setMusicQuery(w)} className="btn btn-ghost btn-sm shrink-0 rounded-full bg-white/6">“{w}”</button>)}
      </div>
    </>
  )
  // A phone with a playlist open shows only that playlist (SPEC-blend-playlists P1); the tape and the right column are for the library.
  const phoneList = !wide && !!pickedList
  const [blendSignal, setBlendSignal] = useState(0)
  const centre = centreView ? (
    <>
      {quick}
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-sm font-semibold">{centreView.label}</h3>
        <span className="flex-1" />
        <button onClick={centreView.onClose} className="btn btn-ghost btn-sm gap-1 rounded-xl"><Ic name="close" size={12} width={2.4} />Back to the library</button>
      </div>
      {centreView.node}
    </>
  ) : phoneList ? (
    <>
      <BlendBy joins={view.joins} score={view.res?.score} hasSet={view.tracks.length > 1} sheet bar={false} signal={blendSignal} noun="playlist" />
      <PlaylistBoard node={pickedList} view={view} byId={byId} wide={wide} facts={facts} colour={colour} openJoin={openJoin} onJoin={k => setJoin(k ? { pl: pickedList.id, key: k } : null)} onSave={pickedList.draft ? onSaveDraft : undefined}
        onSelect={t => setSelectedId(t.id)} onClose={onCloseList} onBlendBy={() => setBlendSignal(n => n + 1)} />
    </>
  ) : (
    <>
      {quick}
      {(openList?.blend || order === 'blend') && <BlendBy joins={openList ? view.joins : blend?.joins} score={openList ? view.res?.score : blend?.score} hasSet={openList ? view.tracks.length > 1 : !!blend} sheet={!wide} noun={openList ? 'playlist' : 'list'} />}
      <TapeBar
        source={source ? { kind: kindLabel, name: source.name } : undefined} onClearSource={() => setSourceKey('')}
        tracks={inView} grouping={grouping} order={order} onOrder={setOrder} shape={shape} onShape={setShape} colour={colour} facts={facts}
        blendLine={order === 'blend' ? (blend ? `${blend.score} blend · ${blend.rough} rough ${blend.rough === 1 ? 'join' : 'joins'}${inView.length > BLEND_CAP ? ` · first ${BLEND_CAP}` : ''}` : 'ordering…') : undefined}
        onAddAll={() => h.onAdd(inView, sourceName)}
      >
        {picked.size > 1 && (
          <span className="flex h-8 items-center gap-1 rounded-[10px] bg-primary/15 pl-3 pr-1 text-xs text-primary">
            <b>{picked.size}</b> selected · drag them, or
            <button onClick={() => { h.onAdd(inView.filter(t => picked.has(t.id)), `${picked.size} tracks`); clearSelection() }} className="btn btn-xs rounded-lg">Add to playlist</button>
            <button onClick={clearSelection} className="btn btn-ghost btn-xs rounded-lg">Clear</button>
          </span>
        )}
      </TapeBar>
      <Tape
        groups={order === 'blend' && blendGroups ? blendGroups : groups} facts={facts} colour={colour}
        joins={order === 'blend' ? blend?.joins : undefined} selectedId={selectedId} playingId={playingId}
        onSelect={t => setSelectedId(t.id)} onPlay={t => void playFrom(order === 'blend' && blend ? blend.tracks : inView, t)} hoverProps={hc.props} picked={picked}
      />
      {openList && !wide ? (
        // A phone keeps the Queue to one line under the tape; a tap opens it as a page.
        <QueueLine node={openList} tracks={view.tracks} onOpen={onOpenDraft} onSave={onSaveDraft} />
      ) : openList ? (
        <PlaylistBoard node={openList} view={view} byId={byId} wide={wide} facts={facts} colour={colour} selectedId={selectedId} openJoin={openJoin} onJoin={k => setJoin(k ? { pl: openList.id, key: k } : null)}
          onSelect={t => setSelectedId(t.id)} hoverProps={hc.props} onClose={onCloseList} onSave={openList.draft ? onSaveDraft : undefined} />
      ) : (
        <p className="rounded-2xl bg-white/4 p-4 text-center text-xs text-base-content/50">Open a playlist from the explorer, or start a <button onClick={onNewList} className="underline">New playlist</button>, and drag tracks from the tape into it.</p>
      )}
      {hc.hover && <HoverCard hover={hc.hover} facts={facts} colour={colour} />}
    </>
  )
  const doorPop = door && <PlayAsFlowAt at={door.at} name={door.name} source={door.source} byId={byId} onClose={() => setDoor(null)} onFlows={() => { setDoor(null); onFlows() }} />
  if (!wide) {
    return (
      <div className="flex flex-col gap-3">
        {centre}
        {!phoneList && rightColumn}
        {doorPop}
        {browse && <ResponsiveModal onClose={() => setBrowse(false)} boxClassName="flex h-[82vh] flex-col p-0">{explorer}</ResponsiveModal>}
      </div>
    )
  }
  return (
    <div ref={fillRef} className="flex min-h-0 gap-4" style={fillStyle}>
      <aside className="w-80 shrink-0 overflow-hidden rounded-2xl bg-white/5">{explorer}</aside>
      <div className="scroll-thin flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto rounded-2xl">{centre}</div>
      <aside className="scroll-thin w-85 shrink-0 overflow-y-auto rounded-2xl bg-white/5">
        {right ?? <>{rightTop}<div className="[[data-fits]:not(:empty)~&]:hidden">{rightColumn}</div></>}
      </aside>
      {doorPop}
    </div>
  )
}



/** The Queue on a phone: its size, a tap to open it, and Save as playlist. */
function QueueLine({ node, tracks, onOpen, onSave }: { node: PlaylistNode; tracks: MusicTrack[]; onOpen: () => void; onSave: () => void }) {
  const secs = tracks.reduce((a, t) => a + t.duration, 0)
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white/4 p-2 pl-4">
      <button onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-baseline gap-2 text-left">
        <b className="text-sm">{node.name}</b>
        <span className="truncate text-xs text-base-content/60">{tracks.length ? `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} · ${Math.round(secs / 60)} min` : 'Empty · tap + on a track'}</span>
      </button>
      {node.draft && <button disabled={!tracks.length} onClick={onSave} className="btn btn-sm h-11 shrink-0 rounded-xl">Save as playlist</button>}
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

/** Space kept between the columns and the player bar. */
const GAP_ABOVE_BAR = 12

/**
 * The three columns fill the screen down to just above the player bar, whatever the header and
 * the bar measure; the page's own bottom padding (kept for the bar) is cancelled so it does not scroll.
 */
function useFillHeight(on: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ height: 'calc(100dvh - 12rem)' })
  useLayoutEffect(() => {
    const el = ref.current
    if (!on || !el) return
    const fit = () => {
      const root = getComputedStyle(document.documentElement)
      const rem = parseFloat(root.fontSize) || 16
      const bar = (parseFloat(root.getPropertyValue('--music-bar')) || 0) * rem
      const top = el.getBoundingClientRect().top + window.scrollY
      const pad = parseFloat(getComputedStyle(el.closest('main') ?? document.body).paddingBottom) || 0
      setStyle({ height: Math.max(420, window.innerHeight - top - bar - GAP_ABOVE_BAR), marginBottom: Math.min(0, bar + GAP_ABOVE_BAR - pad) })
    }
    fit()
    window.addEventListener('resize', fit)
    const watch = new MutationObserver(fit) // the player bar sets --music-bar on <html> when it shows or hides
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => { window.removeEventListener('resize', fit); watch.disconnect() }
  }, [on])
  return [ref, style] as const
}
