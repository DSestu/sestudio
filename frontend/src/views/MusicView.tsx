import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import AddToPlaylist from '../components/music/crates/AddToPlaylist'
import AddLibrary from '../components/music/crates/AddLibrary'
import PlaylistView from '../components/music/crates/PlaylistView'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import ResponsiveModal from '../components/ResponsiveModal'
import { useDownloadedLibrary } from '../downloadedLibrary'
import { useLibraries, useLibraryTracks } from '../musicLibraries'
import { albumsOf, type MusicTrack } from '../musicLibrary'
import { post, resolveLink, useMusicQueue, type OnlineLink } from '../musicQueue'
import { addTracks, nextIndex } from '../components/music/adding'
import { playPayload } from '../components/music/player'
import { useSummaries } from '../musicMeta'
import { LINK_RE, setMusicQuery, useMusicQuery } from '../musicQuery'
import FitsNext from '../components/music/FitsNext'
import { closeFits, useFitsFor } from '../musicFits'
import { useModalBack } from '../useModalBack'
import { currentParams, replaceParams, type Navigate } from '../nav'
import FlowsHome from '../components/music/flows/FlowsHome'
import MixesList from '../components/music/flows/MixesList'
import FlowLanes from '../components/music/flows/FlowLanes'
import MixView from '../components/music/flows/MixView'
import { useFlows } from '../musicFlows'
import Sources, { type SourceTab } from '../components/music/edit/Sources'
import { refOf, resetFocus, setSheet as setEditSheet, songKey, useFocus } from '../components/music/edit/focus'
import { toast } from '../components/music/toast'
import { createWithTracks, freshName, itemsOf, playlistApi, usePlaylists } from '../musicPlaylists'
import MusicSurface from '../components/music/library/MusicSurface'
import QueryChips from '../components/music/library/QueryChips'

const run = (p: Promise<void>) => { p.catch(() => {}) }

/** A pasted YouTube / YouTube Music link: play it as music or queue it. */
function LinkCard({ url }: { url: string }) {
  const [found, setFound] = useState<{ url: string; link?: OnlineLink; error?: string }>()
  useEffect(() => {
    let live = true
    resolveLink(url).then(
      link => live && setFound({ url, link }),
      (e: Error) => live && setFound({ url, error: e.message }),
    )
    return () => { live = false }
  }, [url])
  const done = found?.url === url ? found : undefined
  const link = done?.link
  const what = link?.kind === 'playlist' ? `${link.title || 'Playlist'} · ${link.tracks.length} tracks` : link?.tracks[0]?.title
  return (
    <div className="rounded-2xl bg-white/5 p-3 flex flex-wrap items-center gap-3">
      <p className="flex-1 min-w-40 truncate text-sm">
        {done?.error ?? what ?? 'Looking it up…'}
      </p>
      {link && (
        <>
          <button onClick={() => run(playPayload(link.tracks))} className="btn btn-primary btn-sm">Play as music</button>
          <button onClick={() => run(post({ tracks: link.tracks }))} className="btn btn-ghost btn-sm">Add to queue</button>
        </>
      )}
    </div>
  )
}

const WIDE = '(min-width: 64rem)'
const useWide = () => useSyncExternalStore(
  cb => { const m = matchMedia(WIDE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
  () => matchMedia(WIDE).matches,
)

const KIND_LABEL = { folder: 'Folder', playlist: 'Playlist', smart: 'Smart list' } as const

export default function MusicView({ params, navigate }: { params: URLSearchParams; navigate: Navigate }) {
  const titles = useDownloadedLibrary()
  // Flows and mixes open in the centre from the explorer (SPEC-music-library §2.2); `?tab=` names them, so old links and Back still work.
  const centre = params.get('tab') === 'flows' ? 'flows' : params.get('tab') === 'mixes' ? 'mixes' : 'library'
  const openCentre = (c: 'library' | 'flows' | 'mixes') => navigate('music', { ...Object.fromEntries(currentParams()), tab: c === 'library' ? undefined : c })
  const query = useMusicQuery()
  const fitsFor = useFitsFor()
  const wide = useWide()
  const queue = useMusicQueue()
  const [adding, setAdding] = useState(false)
  // An open playlist is its own history entry, so Back leaves it.
  const nodeId = params.get('pl') ?? ''
  const drafting = nodeId === 'new'
  const flowEdit = params.get('fl') ?? ''
  const mixOpen = params.get('mx') ?? ''
  const { flows: allFlows, mixes: allMixes } = useFlows()
  const go = (open: { pl?: string; seed?: string; fl?: string; mx?: string }) =>
    navigate('music', { ...Object.fromEntries(currentParams()), pl: undefined, seed: undefined, fl: undefined, mx: undefined, edit: undefined, ...open })
  const newPlaylist = (seed?: string) => go({ pl: 'new', seed })
  /** The new playlist exists: its editor replaces the `pl=new` history entry. */
  const opened = (id: string) => {
    const next = { ...Object.fromEntries(currentParams()), pl: id, seed: undefined, edit: '1' }
    replaceParams('music', next)
    navigate('music', next)
  }
  const [pickFor, setPickFor] = useState<MusicTrack>()
  useModalBack(adding, () => setAdding(false))
  const playlists = usePlaylists()
  const node = playlists.find(n => n.id === nodeId)
  // The playlist editor (SPEC-playlist-edit): Edit opens it, Done closes it, Back leaves it.
  const editing = node?.kind === 'playlist' && params.get('edit') === '1'
  const setEditing = (on: boolean) => navigate('music', { ...Object.fromEntries(currentParams()), edit: on ? '1' : undefined })
  useEffect(() => { if (!editing) resetFocus() }, [editing])
  const focus = useFocus()
  const [sourceTab, setSourceTab] = useState<SourceTab>('lib')
  useModalBack(editing && !wide && (focus.sheet === 'lib' || focus.sheet === 'online'), () => setEditSheet(null))

  const others = useLibraryTracks()
  const libraries = useLibraries()
  const all = useMemo(() => [...albumsOf(titles).flatMap(a => a.tracks), ...others], [titles, others])
  const fitsTrack = fitsFor ? all.find(t => t.id === fitsFor) : undefined
  useModalBack(!!fitsTrack && !wide, closeFits)
  // Escape closes the panel (and Back, on a phone, through useModalBack).
  useEffect(() => {
    if (!fitsTrack) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeFits() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitsTrack])

  const ids = useMemo(() => all.filter(t => t.library !== 'online').map(t => t.id), [all])
  const { get, v } = useSummaries(ids)
  const page = (node ?? drafting) || !!flowEdit || !!mixOpen

  const byId = useMemo(() => new Map(all.map(t => [t.id, t])), [all])
  // `pl=new` makes the playlist at once (empty, or with the track of "New playlist from this") and opens its editor.
  const making = useRef(false)
  useEffect(() => {
    if (!drafting || making.current) return
    making.current = true
    const seed = byId.get(params.get('seed') ?? '')
    const made = seed ? createWithTracks([refOf(seed)]) : playlistApi.create('playlist', freshName(playlists.map(n => n.name)))
    made.then(n => opened(n.id), (e: Error) => { toast(e.message); go({}) }).finally(() => { making.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per `pl=new`, with the state of that moment
  }, [drafting])

  const fitsPanel = fitsTrack && (
    <FitsNext
      anchor={fitsTrack} library={all} exclude={queue.items.map(i => i.track_id)}
      action={{ label: 'Add to queue', onPick: t => void addTracks([{ library: t.library, track_id: t.id }], undefined, `Added ${t.title}`) }}
      onClose={closeFits}
      footer={<button onClick={() => void addTracks([{ library: fitsTrack.library, track_id: fitsTrack.id }], nextIndex(), `${fitsTrack.title} plays next`)} className="btn btn-sm h-11 w-full sm:h-8">Play next</button>}
    />
  )
  const searching = !page && query.trim() !== '' && !LINK_RE.test(query.trim())
  const surface = !page
  const inList = useMemo(() => new Set(node ? itemsOf(node).map(i => songKey(byId.get(i.track_id) ?? i)) : []), [node, byId])
  const sources = editing && node && (
    <Sources
      tab={sourceTab} onTab={setSourceTab} all={all} byId={byId} nodeId={node.id} inList={inList}
      onAdd={t => void playlistApi.add(node.id, [refOf(t)]).then(() => toast(`Added ${t.title} at the end`), (e: Error) => toast(e.message))}
    />
  )
  const body = flowEdit ? (
    <FlowLanes key={flowEdit} flowId={flowEdit} byId={byId} onOpen={id => go({ fl: id })} />
  ) : mixOpen ? (
    <MixView key={mixOpen} mixId={mixOpen} byId={byId} onEditFlow={id => go({ fl: id })} />
  ) : drafting ? null : node ? (
    <PlaylistView key={node.id} node={node} byId={byId} onPlaylist={setPickFor} edit={editing} onEdit={node.kind === 'playlist' ? () => setEditing(true) : undefined} onSource={t => { setSourceTab(t); setEditSheet(t) }} />
  ) : !all.length ? (
    <EmptyState title="No music yet" message="Audio files in your downloads folder show up here." />
  ) : (
    <MusicSurface
      all={all} libraries={libraries} get={get} v={v} wide={wide} right={fitsPanel || undefined}
      onList={id => go({ pl: id })} onNewList={() => newPlaylist()} onFlow={id => go({ fl: id })} onMix={id => go({ mx: id })} onFlows={() => openCentre('flows')} onMixes={() => openCentre('mixes')} onAddLibrary={() => setAdding(true)}
      centreView={centre !== 'library' && !searching ? {
        label: centre === 'flows' ? 'Flows' : 'Mixes',
        node: centre === 'flows' ? <FlowsHome onOpen={id => go({ fl: id })} byId={byId} /> : <MixesList onOpen={id => go({ mx: id })} />,
        onClose: () => openCentre('library'),
      } : undefined}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {flowEdit ? (
        <PageHeader title={allFlows.find(f => f.id === flowEdit)?.name ?? 'Flow'} status="Flow · Music" onBack={() => go({})} />
      ) : mixOpen ? (
        <PageHeader title={allMixes.find(m => m.id === mixOpen)?.name ?? 'Mix'} status="Mix · Music" onBack={() => go({})} />
      ) : drafting ? (
        <PageHeader title="New playlist" status="Music" onBack={() => go({})} />
      ) : node && editing ? (
        <PageHeader title={node.name} status="Editing · Playlist" onBack={() => go({})} action={{ label: 'Done', onClick: () => setEditing(false), icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5 9-10" /></svg> }} />
      ) : node ? (
        <PageHeader title={node.name} status={`${KIND_LABEL[node.kind]} · Music`} onBack={() => go({})} />
      ) : (
        <PageHeader
          title="Music"
          status={<><em>{all.length}</em> tracks</>}
          action={{ label: 'New playlist', onClick: () => newPlaylist() }}
        />
      )}
      <div className="flex gap-6 items-start">
        {editing && wide && (
          <aside className="sticky top-4 flex h-[calc(100vh-8rem)] w-88 shrink-0 flex-col overflow-hidden rounded-2xl bg-white/5">
            {sources}
          </aside>
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!page && (
            <label className="input input-bordered flex w-full items-center gap-1 md:hidden">
              <QueryChips />
              <input
                type="search"
                value={query}
                onChange={e => setMusicQuery(e.target.value)}
                placeholder="Search names or sounds, or paste a link"
                aria-label="Search your libraries"
                className="min-w-0 grow"
              />
            </label>
          )}
          {!page && LINK_RE.test(query.trim()) && <LinkCard url={query.trim()} />}
          {editing && !wide && (
            <div role="group" aria-label="Add and fits" className="sticky top-2 z-20 grid grid-cols-3 gap-1.5 rounded-2xl bg-base-300/90 p-1.5 backdrop-blur">
              {([['lib', 'Library'], ['online', 'Online'], ['fits', 'Fits']] as const).map(([v, label]) => (
                <button key={v} onClick={() => { if (v !== 'fits') setSourceTab(v); setEditSheet(v) }} disabled={v === 'fits' && !!node && !itemsOf(node).length} aria-pressed={focus.sheet === v} className={`btn h-11 min-h-0 border-0 text-sm font-medium disabled:bg-transparent disabled:opacity-40 ${focus.sheet === v ? 'bg-primary/20 text-primary' : 'btn-ghost'}`}>
                  {label}
                  {v === 'fits' && focus.target?.k === 'track' && <span className="max-w-20 truncate text-[11px] font-normal text-base-content/55">{focus.target.track.title}</span>}
                </button>
              ))}
            </div>
          )}
          {body}
        </div>
        {/* The surface shows Fits in its right column; a playlist page has its own Fits next aside, so a second one opens as a dialog. */}
        {fitsPanel && wide && !node && !surface && <aside className="sticky top-4 flex h-[calc(100vh-8rem)] w-96 shrink-0 flex-col overflow-hidden rounded-2xl bg-white/5">{fitsPanel}</aside>}
      </div>
      {fitsPanel && (!wide || node) && (
        <ResponsiveModal onClose={closeFits} boxClassName="flex h-[60vh] flex-col p-0">{fitsPanel}</ResponsiveModal>
      )}
      {editing && !wide && (focus.sheet === 'lib' || focus.sheet === 'online') && (
        <ResponsiveModal onClose={() => setEditSheet(null)} boxClassName="flex h-[75vh] flex-col p-0">{sources}</ResponsiveModal>
      )}
      {adding && <AddLibrary onClose={() => setAdding(false)} />}
      {pickFor && <AddToPlaylist track={pickFor} onClose={() => setPickFor(undefined)} />}
    </div>
  )
}
