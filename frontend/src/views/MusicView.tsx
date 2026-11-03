import { useEffect, useMemo, useState } from 'react'
import AddToPlaylist from '../components/music/crates/AddToPlaylist'
import AddLibrary from '../components/music/crates/AddLibrary'
import Crates, { type Crate } from '../components/music/crates/Crates'
import PlaylistView from '../components/music/crates/PlaylistView'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import ResponsiveModal from '../components/ResponsiveModal'
import { useDownloadedLibrary } from '../downloadedLibrary'
import { usePlaylists } from '../musicPlaylists'
import { stateLine, useLibraries, useLibraryTracks, type LibraryStatus } from '../musicLibraries'
import {
  albumsOf, albumsOfTracks, artistsOf, formatDuration, initials, matchTracks,
  type MusicAlbum, type MusicTrack,
} from '../musicLibrary'
import { addToQueue, post, resolveLink, type OnlineLink } from '../musicQueue'
import { playAll, playNow, playPayload } from '../components/music/player'
import { useModalBack } from '../useModalBack'

const TABS = [
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'tracks', label: 'Tracks' },
] as const
type MusicTab = (typeof TABS)[number]['id']

const DOT: Record<LibraryStatus['state'], string> = {
  online: 'bg-success',
  offline: 'bg-base-content/30',
  needs_signin: 'bg-warning',
}

const run = (p: Promise<void>) => { p.catch(() => {}) }

function Cover({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`grid place-items-center bg-linear-to-br from-sky-500 to-indigo-700 text-white/90 font-semibold ${className}`}
    >
      {initials(name)}
    </div>
  )
}

function AlbumCard({ album }: { album: MusicAlbum }) {
  return (
    <div className="group relative flex flex-col gap-2 min-w-0">
      <div className="relative">
        <Cover name={album.name} className="aspect-square rounded-2xl text-3xl" />
        <button
          onClick={() => run(playAll(album.tracks))}
          aria-label={`Play all of ${album.name}`}
          className="absolute right-2 bottom-2 btn btn-primary btn-circle btn-sm md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">{album.name}</p>
        <p className="truncate text-xs text-base-content/60">{album.artist} · {album.tracks.length} tracks</p>
      </div>
    </div>
  )
}

function TrackRow({ track, onPlaylist }: { track: MusicTrack; onPlaylist: (t: MusicTrack) => void }) {
  return (
    <li className="flex items-center gap-1 rounded-xl hover:bg-white/5">
      <button
        onClick={() => run(playNow(track))}
        className="flex-1 min-w-0 flex items-center gap-3 px-3 h-12 text-left"
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{track.title}</span>
          <span className="block truncate text-xs text-base-content/60">{track.artist}</span>
        </span>
        {track.bpm !== undefined && <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(track.bpm)} bpm</span>}
        <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(track.duration)}</span>
      </button>
      <div className="dropdown dropdown-end">
        <button tabIndex={0} aria-label={`Add ${track.title}`} className="btn btn-ghost btn-circle btn-sm mr-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
        <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-48 rounded-xl bg-base-200 p-1 shadow-lg">
          <li><button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); run(addToQueue(track)) }}>Add to queue</button></li>
          <li><button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); onPlaylist(track) }}>Add to playlist…</button></li>
        </ul>
      </div>
    </li>
  )
}

const LINK_RE = /^https?:\/\/(\S+\.)?(youtube\.com|youtu\.be)\//i

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

export default function MusicView() {
  const titles = useDownloadedLibrary()
  const [tab, setTab] = useState<MusicTab>('albums')
  const [library, setLibrary] = useState('')
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState(false)
  const [adding, setAdding] = useState(false)
  const [nodeId, setNodeId] = useState('')
  const [pickFor, setPickFor] = useState<MusicTrack>()
  useModalBack(sheet, () => setSheet(false))
  useModalBack(adding, () => setAdding(false))
  const playlists = usePlaylists()
  const node = playlists.find(n => n.id === nodeId)

  const others = useLibraryTracks()
  const libraries = useLibraries()
  const all = useMemo(() => [...albumsOf(titles).flatMap(a => a.tracks), ...others], [titles, others])
  const crates = useMemo<Crate[]>(() => [
    { id: '', label: 'All', count: all.length },
    ...libraries.map(l => ({ id: l.id, label: l.label, count: l.count, dot: DOT[l.state], line: stateLine(l) })),
  ], [all, libraries])

  const tracks = useMemo(
    () => matchTracks(all.filter(t => !library || (t.crate ?? t.library) === library), query),
    [all, library, query],
  )
  const albums = useMemo(() => {
    const ids = new Set(tracks.map(t => t.id))
    return [...albumsOf(titles), ...albumsOfTracks(others)]
      .map(a => ({ ...a, tracks: a.tracks.filter(t => ids.has(t.id)) }))
      .filter(a => a.tracks.length)
  }, [titles, others, tracks])
  const artists = useMemo(() => artistsOf(tracks), [tracks])

  const byId = useMemo(() => new Map(all.map(t => [t.id, t])), [all])
  const activeLabel = node?.name ?? crates.find(c => c.id === library)?.label ?? 'All'
  const pick = (id: string) => { setLibrary(id); setNodeId(''); setSheet(false) }
  const pickNode = (id: string) => { setNodeId(id); setSheet(false) }

  const body = node ? (
    <PlaylistView key={node.id} node={node} byId={byId} />
  ) : !all.length ? (
    <EmptyState title="No music yet" message="Audio files in your downloads folder show up here." />
  ) : !tracks.length ? (
    <EmptyState title="No match" message="Nothing in your libraries matches that search." />
  ) : tab === 'albums' ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {albums.map(a => <AlbumCard key={a.tracks[0].id} album={a} />)}
    </div>
  ) : tab === 'artists' ? (
    <div className="flex flex-col gap-5">
      {artists.map(a => (
        <section key={a.name}>
          <div className="flex items-center gap-3 px-3 pb-1">
            <Cover name={a.name} className="w-9 h-9 rounded-full text-xs" />
            <h3 className="flex-1 min-w-0 truncate text-sm font-semibold">{a.name}</h3>
            <button onClick={() => run(playAll(a.tracks))} className="btn btn-ghost btn-xs">Play all</button>
          </div>
          <ul>{a.tracks.map(t => <TrackRow key={t.id} track={t} onPlaylist={setPickFor} />)}</ul>
        </section>
      ))}
    </div>
  ) : (
    <ul>{tracks.map(t => <TrackRow key={t.id} track={t} onPlaylist={setPickFor} />)}</ul>
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Music"
        status={<><em>{all.length}</em> tracks</>}
        tabs={[...TABS]}
        tab={tab}
        onTab={t => { setTab(t); setNodeId('') }}
      />
      <div className="md:hidden">
        <button onClick={() => setSheet(true)} className="btn btn-sm rounded-full gap-1.5">
          {activeLabel === 'All' ? 'All libraries' : activeLabel}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      <div className="flex gap-6 items-start">
        <aside className="hidden md:block w-62.5 shrink-0 sticky top-24">
          <Crates crates={crates} active={library} onPick={pick} onAdd={() => { setSheet(false); setAdding(true) }} node={nodeId} onNode={pickNode} />
        </aside>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!node && (
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your libraries and online, or paste a link"
              aria-label="Search your libraries"
              className="input input-bordered w-full"
            />
          )}
          {!node && LINK_RE.test(query.trim()) && <LinkCard url={query.trim()} />}
          {body}
        </div>
      </div>
      {sheet && (
        <ResponsiveModal onClose={() => setSheet(false)}>
          <Crates crates={crates} active={library} onPick={pick} onAdd={() => { setSheet(false); setAdding(true) }} node={nodeId} onNode={pickNode} />
        </ResponsiveModal>
      )}
      {adding && <AddLibrary onClose={() => setAdding(false)} />}
      {pickFor && <AddToPlaylist track={pickFor} onClose={() => setPickFor(undefined)} />}
    </div>
  )
}
