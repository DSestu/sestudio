import { useEffect, useMemo, useState } from 'react'
import AddToPlaylist from '../components/music/crates/AddToPlaylist'
import AddLibrary from '../components/music/crates/AddLibrary'
import { openHarmonyBasics } from '../components/music/harmony/store'
import BuildSet from '../components/music/crates/build/BuildSet'
import { openBuildSet } from '../components/music/crates/build/store'
import { newFlow } from '../components/music/builder/flows'
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
import { addPayload, addToQueue, post, resolveLink, type OnlineLink } from '../musicQueue'
import { playAll, playFrom, playPayload } from '../components/music/player'
import { factsLine, useAnalysing, useSummaries, type Summary } from '../musicMeta'
import TrackMeta, { MetaLine } from '../components/music/TrackMeta'
import MusicSearch from '../components/music/MusicSearch'
import { LINK_RE, setMusicQuery, useMusicQuery } from '../musicQuery'
import { setFitsRef, useFitsRef } from '../musicFits'
import { useModalBack } from '../useModalBack'
import { currentParams, patchParams, type Navigate } from '../nav'

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

const subline = (parts: string[]) => parts.filter(Boolean).join(' · ')

/** An album's key in the URL: its library and folder. */
const albumKey = (a: MusicAlbum) => `${a.tracks[0].crate ?? a.tracks[0].library}|${a.folder}`

/** "2 h 58" or "38 min". */
const totalTime = (s: number) => {
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
}

function AlbumCard({ album, get, onOpen }: { album: MusicAlbum; get: (id: string) => Summary | undefined; onOpen: () => void }) {
  const facts = factsLine(album.tracks.map(t => get(t.id)), album.tracks.map(t => t.bpm))
  return (
    <div className="group relative flex flex-col gap-2 min-w-0">
      <div className="relative">
        <Cover name={album.name} className="aspect-square rounded-2xl text-3xl" />
        <button onClick={onOpen} aria-label={`Open ${album.name}`} className="absolute inset-0 rounded-2xl hover:bg-white/5" />
        <button
          onClick={() => run(playAll(album.tracks))}
          aria-label={`Play all of ${album.name}`}
          className="absolute hit right-2 bottom-2 btn btn-primary btn-circle btn-sm md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
      {/* The cover's button is the keyboard path; the name opens it too for a pointer. */}
      <div onClick={onOpen} className="min-w-0 leading-tight cursor-pointer">
        <p className="truncate text-sm font-medium">{album.name}</p>
        <p className="line-clamp-2 text-xs text-base-content/60">{subline([album.artist, `${album.tracks.length} tracks`, facts])}</p>
      </div>
    </div>
  )
}

function TrackRow({ track, list, onPlaylist }: { track: MusicTrack; list: MusicTrack[]; onPlaylist: (t: MusicTrack) => void }) {
  const analysing = useAnalysing(track.id)
  return (
    <li className="flex items-center gap-1 rounded-xl hover:bg-white/5">
      <button
        onClick={() => run(playFrom(list, track))}
        className="flex-1 min-w-0 flex items-center gap-3 px-3 h-12 text-left"
      >
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{track.title}</span>
          <span className="block truncate text-xs text-base-content/60">{track.artist}<MetaLine id={track.id} bpm={track.bpm} title={track.title} /></span>
        </span>
        <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(track.duration)}</span>
      </button>
      <TrackMeta id={track.id} bpm={track.bpm} title={track.title} />
      <div className="dropdown dropdown-end">
        <button tabIndex={0} aria-label={`Add ${track.title}`} className="btn btn-ghost btn-circle btn-sm mr-1 relative hit">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
        <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-56 rounded-xl bg-base-200 p-1 shadow-lg">
          <li><button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); run(addToQueue(track)) }}>Add to queue</button></li>
          <li><button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); onPlaylist(track) }}>Add to playlist…</button></li>
          {!analysing && <li><button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setFitsRef(track.id) }}>Fits after this</button></li>}
          <li><button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); openBuildSet({ way: 'seed', seed: track.id }) }}>Build a set from this</button></li>
        </ul>
      </div>
    </li>
  )
}

/** An album's or an artist's own page: cover, facts, the three ways to play it, its tracks. */
function Detail({ name, round, tracks, get, onPlaylist }: {
  name: string; round?: boolean; tracks: MusicTrack[]; get: (id: string) => Summary | undefined; onPlaylist: (t: MusicTrack) => void
}) {
  const facts = factsLine(tracks.map(t => get(t.id)), tracks.map(t => t.bpm))
  const time = totalTime(tracks.reduce((s, t) => s + (t.duration || 0), 0))
  const shuffled = () => {
    const out = [...tracks]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-4 md:gap-5">
        <Cover name={name} className={`shrink-0 size-32 md:size-42 text-4xl ${round ? 'rounded-full' : 'rounded-[22px]'}`} />
        <div className="min-w-0 flex flex-col gap-3">
          <p className="text-sm leading-snug">
            <b className="font-semibold">{tracks.length} tracks · {time}</b>
            {facts && <span className="block text-xs text-base-content/60">{facts}</span>}
          </p>
          <div className="hidden md:flex gap-2">
            <DetailActions tracks={tracks} shuffled={shuffled} />
          </div>
        </div>
      </div>
      <div className="flex gap-2 md:hidden"><DetailActions tracks={tracks} shuffled={shuffled} /></div>
      <ul>{tracks.map(t => <TrackRow key={t.id} track={t} list={tracks} onPlaylist={onPlaylist} />)}</ul>
    </div>
  )
}

function DetailActions({ tracks, shuffled }: { tracks: MusicTrack[]; shuffled: () => MusicTrack[] }) {
  return (
    <>
      <button onClick={() => run(playAll(tracks))} className="btn btn-primary rounded-xl gap-2">
        <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Play
      </button>
      <button onClick={() => run(playAll(shuffled()))} className="btn rounded-xl">Shuffle</button>
      <button onClick={() => run(post(addPayload(tracks, 'append')))} className="btn rounded-xl">Add to queue</button>
    </>
  )
}


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

const KIND_LABEL = { folder: 'Folder', playlist: 'Playlist', smart: 'Smart list' } as const

// The browse state lives in the URL (Back returns to it as it was) and here,
// so coming back to Music from the nav finds it as it was left.
const last = { tab: 'albums' as MusicTab, lib: '', genre: '' }
const initial = () => {
  const p = currentParams()
  const tab = TABS.find(t => t.id === p.get('tab'))?.id
  return { tab: tab ?? last.tab, lib: p.get('lib') ?? last.lib, genre: p.get('genre') ?? last.genre }
}

export default function MusicView({ params, navigate }: { params: URLSearchParams; navigate: Navigate }) {
  const titles = useDownloadedLibrary()
  const [start] = useState(initial)
  const [tab, setTab] = useState<MusicTab>(start.tab)
  const [library, setLibrary] = useState(start.lib)
  const query = useMusicQuery()
  const fitsRef = useFitsRef()
  const [sheet, setSheet] = useState(false)
  const [adding, setAdding] = useState(false)
  // An open playlist, album or artist is its own history entry, so Back leaves it.
  const nodeId = params.get('pl') ?? ''
  const albumId = params.get('al') ?? ''
  const artistName = params.get('ar') ?? ''
  const go = (open: { pl?: string; al?: string; ar?: string }) =>
    navigate('music', { ...Object.fromEntries(currentParams()), pl: undefined, al: undefined, ar: undefined, ...open })
  const openNode = (id: string) => go({ pl: id || undefined })
  const openMix = (id?: string) => id ? navigate('mixes', { f: id }) : run(newFlow('mix').then(f => navigate('mixes', { f: f.id })))
  const [pickFor, setPickFor] = useState<MusicTrack>()
  useModalBack(sheet, () => setSheet(false))
  useModalBack(adding, () => setAdding(false))
  // "Fits after this" from any row lands on the Tracks tab, off any open page.
  useEffect(() => {
    if (!fitsRef) return
    setTab('tracks')
    if (nodeId || albumId || artistName) go({})
  }, [fitsRef]) // eslint-disable-line react-hooks/exhaustive-deps
  const playlists = usePlaylists()
  const node = playlists.find(n => n.id === nodeId)

  const others = useLibraryTracks()
  const libraries = useLibraries()
  const all = useMemo(() => [...albumsOf(titles).flatMap(a => a.tracks), ...others], [titles, others])
  const crates = useMemo<Crate[]>(() => [
    { id: '', label: 'All', count: all.length },
    ...libraries.map(l => ({ id: l.id, label: l.label, count: l.count, dot: DOT[l.state], line: stateLine(l) })),
  ], [all, libraries])

  const ids = useMemo(() => all.filter(t => t.library !== 'online').map(t => t.id), [all])
  const { get, v } = useSummaries(ids)
  const [genre, setGenre] = useState(start.genre)
  useEffect(() => {
    Object.assign(last, { tab, lib: library, genre })
    patchParams({ tab: tab === 'albums' ? undefined : tab, lib: library || undefined, genre: genre || undefined })
  }, [tab, library, genre])
  const inLibrary = useMemo(
    () => matchTracks(all.filter(t => !library || (t.crate ?? t.library) === library), query, get),
    [all, library, query, v], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Genres of what is listed, most common first.
  const genres = useMemo(() => {
    const n = new Map<string, number>()
    for (const t of inLibrary) {
      const g = get(t.id)?.genre
      if (g) n.set(g, (n.get(g) ?? 0) + 1)
    }
    return [...n].sort((a, b) => b[1] - a[1])
  }, [inLibrary, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const tracks = useMemo(
    () => (genre ? inLibrary.filter(t => get(t.id)?.genre === genre) : inLibrary),
    [inLibrary, genre, v], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const allAlbums = useMemo(() => [...albumsOf(titles), ...albumsOfTracks(others)], [titles, others])
  const albums = useMemo(() => {
    const ids = new Set(tracks.map(t => t.id))
    return allAlbums
      .map(a => ({ ...a, tracks: a.tracks.filter(t => ids.has(t.id)) }))
      .filter(a => a.tracks.length)
  }, [allAlbums, tracks])
  const artists = useMemo(() => artistsOf(tracks), [tracks])
  // A page shows the whole album or artist, whatever the library, genre or search.
  const album = albumId ? allAlbums.find(a => albumKey(a) === albumId) : undefined
  const artist = useMemo(() => artistName ? artistsOf(all).find(a => a.name === artistName) : undefined, [all, artistName])
  const page = node ?? album ?? artist

  const fitsTrack = fitsRef ? all.find(t => t.id === fitsRef) : undefined
  const byId = useMemo(() => new Map(all.map(t => [t.id, t])), [all])
  const activeLabel = crates.find(c => c.id === library)?.label ?? 'All'
  const pick = (id: string) => { setLibrary(id); setSheet(false); if (nodeId || albumId || artistName) go({}) }
  const pickNode = (id: string) => { setSheet(false); if (id !== nodeId) openNode(id) }

  const searching = !page && query.trim() !== '' && !LINK_RE.test(query.trim())
  const body = node ? (
    <PlaylistView key={node.id} node={node} byId={byId} />
  ) : album ? (
    <Detail name={album.name} tracks={album.tracks} get={get} onPlaylist={setPickFor} />
  ) : artist ? (
    <Detail name={artist.name} round tracks={artist.tracks} get={get} onPlaylist={setPickFor} />
  ) : searching ? (
    <MusicSearch
      query={query}
      byId={byId}
      renderLibrary={ts => <ul>{ts.map(t => <TrackRow key={t.id} track={t} list={ts} onPlaylist={setPickFor} />)}</ul>}
    />
  ) : !all.length ? (
    <EmptyState title="No music yet" message="Audio files in your downloads folder show up here." />
  ) : !tracks.length ? (
    <EmptyState title="No match" message="Nothing in your libraries matches that search." />
  ) : tab === 'albums' ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {albums.map(a => <AlbumCard key={a.tracks[0].id} album={a} get={get} onOpen={() => go({ al: albumKey(a) })} />)}
    </div>
  ) : tab === 'artists' ? (
    <ul>
      {artists.map(a => (
        <li key={a.name}>
          <button onClick={() => go({ ar: a.name })} className="w-full flex items-center gap-3 px-3 h-14 rounded-xl text-left hover:bg-white/5">
            <Cover name={a.name} className="size-10 shrink-0 rounded-full text-xs" />
            <span className="flex-1 min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">{a.name}</span>
              <span className="block truncate text-xs text-base-content/60">{subline([`${a.tracks.length} tracks`, factsLine(a.tracks.map(t => get(t.id)), a.tracks.map(t => t.bpm))])}</span>
            </span>
            <svg className="size-4 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <ul>{tracks.map(t => <TrackRow key={t.id} track={t} list={tracks} onPlaylist={setPickFor} />)}</ul>
  )

  return (
    <div className="flex flex-col gap-4">
      {node ? (
        <PageHeader title={node.name} status={`${KIND_LABEL[node.kind]} · Music`} onBack={() => go({})} />
      ) : album ? (
        <PageHeader title={album.name} status={`Album · ${album.artist}`} onBack={() => go({})} />
      ) : artist ? (
        <PageHeader title={artist.name} status="Artist" onBack={() => go({})} />
      ) : (
        <PageHeader
          title="Music"
          status={<><em>{tracks.length}</em> tracks{library && ` in ${activeLabel}`}{genre && ` · ${genre}`}</>}
          menu={<>
            <button onClick={() => openBuildSet()} className="btn btn-ghost btn-sm justify-start">Build a set</button>
            <button onClick={() => openMix()} className="btn btn-ghost btn-sm justify-start">New mix</button>
            <button onClick={openHarmonyBasics} className="btn btn-ghost btn-sm justify-start">? Harmony basics</button>
          </>}
          tabs={[...TABS]}
          tab={tab}
          onTab={setTab}
        />
      )}
      <div className={page ? 'hidden' : 'md:hidden'}>
        <button onClick={() => setSheet(true)} className="btn btn-sm rounded-full gap-1.5 relative hit">
          {activeLabel === 'All' ? 'All libraries' : activeLabel}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      <div className="flex gap-6 items-start">
        <aside className="hidden md:block w-62.5 shrink-0 sticky top-24">
          <Crates crates={crates} active={library} onPick={pick} onAdd={() => { setSheet(false); setAdding(true) }} onMix={openMix} node={nodeId} onNode={pickNode} />
        </aside>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!page && (
            <input
              type="search"
              value={query}
              onChange={e => setMusicQuery(e.target.value)}
              placeholder="Search your libraries and online, or paste a link"
              aria-label="Search your libraries"
              className="input input-bordered w-full md:hidden"
            />
          )}
          {!page && !searching && genres.length > 0 && (
            <div role="group" aria-label="Filter by genre" className="flex gap-1.5 overflow-x-auto pt-1.5 pb-2.5 -mt-1.5 -mb-1.5 [scrollbar-width:none]">
              {[['', inLibrary.length] as const, ...genres].map(([g, n]) => (
                <button
                  key={g}
                  aria-pressed={genre === g}
                  onClick={() => setGenre(g)}
                  className={`relative hit shrink-0 rounded-full px-3 h-8 text-xs font-medium ${genre === g ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70 hover:bg-white/10'}`}
                >
                  {g || 'All'} <span className="tabular-nums opacity-60">{n}</span>
                </button>
              ))}
            </div>
          )}
          {!page && fitsTrack && tab === 'tracks' && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-base-content/60">Fits after</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 pl-3 pr-1 h-8 text-primary font-medium min-w-0">
                <span className="truncate">{fitsTrack.title}</span>
                <button onClick={() => setFitsRef()} aria-label="Back to the normal list" className="relative hit btn btn-ghost btn-circle btn-xs">✕</button>
              </span>
            </div>
          )}
          {!page && LINK_RE.test(query.trim()) && <LinkCard url={query.trim()} />}
          {body}
        </div>
      </div>
      {sheet && (
        <ResponsiveModal onClose={() => setSheet(false)}>
          <Crates crates={crates} active={library} onPick={pick} onAdd={() => { setSheet(false); setAdding(true) }} onMix={openMix} node={nodeId} onNode={pickNode} />
        </ResponsiveModal>
      )}
      <BuildSet byId={byId} />
      {adding && <AddLibrary onClose={() => setAdding(false)} />}
      {pickFor && <AddToPlaylist track={pickFor} onClose={() => setPickFor(undefined)} />}
    </div>
  )
}
