import { useMemo, useState, type ReactNode } from 'react'
import { keyDisplay } from '../../../harmony'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import { useSummaries, type Summary } from '../../../musicMeta'
import { itemsOf, usePlaylists } from '../../../musicPlaylists'
import { useMusicSearch, type OnlineHit, type SearchSource } from '../../../musicSearch'
import { useTheory } from '../../../musicTheory'
import { aim, dragProps, hover, songKey, unhover } from './focus'
import { analyseOnline, trackOfHit, useRun } from './onlineAnalysis'

// The editor's Add from column (SPEC-playlist-edit): the libraries as folders, or one
// online source at a time. Every row drags into the playlist and is a target for Fits.

export type SourceTab = 'lib' | 'online'


const SHOWN = 200
const ONLINE: { id: SearchSource; label: string }[] = [
  { id: 'library', label: 'Your libraries' },
  { id: 'ytmusic', label: 'YouTube Music' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'youtube', label: 'YouTube' },
]

const icon = (d: string, cls = 'size-4') => <svg className={`${cls} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
const DRIVE = 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 15h.01M11 15h6'
const LIST = 'M8 6h13M8 12h13M8 18h9M3 6h.01M3 12h.01M3 18h.01'
const CHEV = 'M9 6l6 6-6 6'
const PLUS = 'M12 5v14M5 12h14'
const WAVE = 'M3 12h2l2-6 3 12 3-9 2 5 2-2h4'

interface Dir { dirs: Map<string, Dir>; tracks: MusicTrack[] }
const newDir = (): Dir => ({ dirs: new Map(), tracks: [] })
const countOf = (d: Dir): number => d.tracks.length + [...d.dirs.values()].reduce((s, x) => s + countOf(x), 0)
const tracksUnder = (d: Dir): MusicTrack[] => [...d.tracks, ...[...d.dirs.values()].flatMap(tracksUnder)]

/** The libraries as trees of folders, keyed by library id. */
function useTree(all: MusicTrack[]) {
  return useMemo(() => {
    const libs = new Map<string, { label: string; root: Dir }>()
    for (const t of all) {
      if (t.library === 'online') continue
      const id = t.crate ?? t.library
      const lib = libs.get(id) ?? libs.set(id, { label: t.libraryLabel, root: newDir() }).get(id)!
      let d = lib.root
      for (const p of t.folder ? t.folder.split('/') : []) d = d.dirs.get(p) ?? d.dirs.set(p, newDir()).get(p)!
      d.tracks.push(t)
    }
    return libs
  }, [all])
}

function Meta({ s, bpm }: { s?: Summary; bpm?: number }) {
  const k = keyDisplay(useTheory(), s)
  const b = s?.bpm || bpm
  return (
    <>
      {k && <span className="inline-flex shrink-0 items-center gap-1.5 rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none text-base-content/70">{k.color && <i className="inline-block size-2 rounded-full" style={{ background: k.color }} />}{k.text}</span>}
      {b ? <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-base-content/45">{Math.round(b)}</span> : null}
    </>
  )
}

/** Hover aims Fits (after a pause), a click aims it at once (phones), and the row drags into the playlist. */
const targetProps = (t: MusicTrack) => ({
  onPointerEnter: (e: { pointerType: string }) => { if (e.pointerType === 'mouse') hover({ k: 'track', track: t }) },
  onPointerLeave: unhover,
  onClick: () => aim({ k: 'track', track: t }),
  ...dragProps(t),
})

function AddButton({ t, onAdd }: { t: MusicTrack; onAdd: (t: MusicTrack) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onAdd(t) }}
      aria-label={`Add ${t.title} at the end`}
      className="btn btn-ghost btn-circle size-11 shrink-0 text-primary sm:size-8 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
    >{icon(PLUS)}</button>
  )
}

function TrackRow({ t, s, inList, onAdd }: { t: MusicTrack; s?: Summary; inList: boolean; onAdd: (t: MusicTrack) => void }) {
  return (
    <li {...targetProps(t)} className="group flex min-h-12 cursor-grab items-center gap-2 rounded-xl pl-3 pr-1 hover:bg-white/5">
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{t.title}</span>
        <span className="block truncate text-xs text-base-content/55">{t.artist || 'Unknown artist'}{inList && <span className="text-success"> · in playlist</span>}</span>
      </span>
      <Meta s={s} bpm={t.bpm} />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-base-content/50">{formatDuration(t.duration)}</span>
      <AddButton t={t} onAdd={onAdd} />
    </li>
  )
}

function NavRow({ label, line, count, d, onClick }: { label: string; line?: string; count: number | string; d: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-white/5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/6 text-base-content/70">{icon(d)}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{label}</span>
          {line && <span className="block truncate text-xs text-base-content/50">{line}</span>}
        </span>
        <span className="text-xs tabular-nums text-base-content/50">{count}</span>
        <span className="text-base-content/30">{icon(CHEV)}</span>
      </button>
    </li>
  )
}

const Label = ({ children }: { children: ReactNode }) => <li className="px-2 pb-1 pt-3 text-[11px] font-semibold tracking-wider text-base-content/45">{children}</li>

function Library({ all, byId, nodeId, inList, onAdd }: Props) {
  const tree = useTree(all)
  const playlists = usePlaylists().filter(n => n.kind === 'playlist' && n.id !== nodeId)
  /** [] for the root, [library, ...folders], or ['pl', id] for another playlist. */
  const [path, setPath] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const go = (p: string[]) => { setPath(p); setFilter('') }
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (t: MusicTrack) => words.every(w => `${t.title} ${t.artist}`.toLowerCase().includes(w))

  let dir: Dir | undefined
  let crumbs: string[] = []
  let tracks: MusicTrack[] = []
  const pl = path[0] === 'pl' ? playlists.find(n => n.id === path[1]) : undefined
  if (pl) {
    crumbs = [pl.name]
    tracks = itemsOf(pl).flatMap(i => byId.get(i.track_id) ?? [])
  } else if (path.length) {
    const lib = tree.get(path[0])
    dir = lib?.root
    for (const p of path.slice(1)) dir = dir?.dirs.get(p)
    crumbs = [lib?.label ?? path[0], ...path.slice(1)]
    tracks = dir ? (words.length ? tracksUnder(dir) : dir.tracks) : []
  } else if (words.length) {
    tracks = all.filter(t => t.library !== 'online')
  }
  const shown = useMemo(() => tracks.filter(match).slice(0, SHOWN), [tracks, filter]) // eslint-disable-line react-hooks/exhaustive-deps
  const { get } = useSummaries(useMemo(() => shown.map(t => t.id), [shown]))

  return (
    <>
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 px-3 text-[12.5px]">
        {path.length ? <button onClick={() => go([])} className="rounded px-1 text-base-content/60 hover:bg-white/8">Libraries</button> : <span className="px-1 font-semibold">Libraries</span>}
        {crumbs.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="text-base-content/30">›</span>
            {i === crumbs.length - 1
              ? <span className="px-1 font-semibold">{c}</span>
              : <button onClick={() => go(path.slice(0, i + 1))} className="rounded px-1 text-base-content/60 hover:bg-white/8">{c}</button>}
          </span>
        ))}
      </nav>
      <div className="px-3 pt-2">
        <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder={path.length ? 'Filter this folder' : 'Search all libraries'} aria-label="Filter" className="input input-sm w-full" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {!path.length && !words.length && (
          <>
            <Label>LIBRARIES</Label>
            {[...tree].map(([id, lib]) => {
              const n = lib.root.dirs.size
              return <NavRow key={id} label={lib.label} line={n ? `${n} ${n === 1 ? 'folder' : 'folders'}` : undefined} count={countOf(lib.root)} d={DRIVE} onClick={() => go([id])} />
            })}
            {playlists.length > 0 && <Label>OTHER PLAYLISTS</Label>}
            {playlists.map(n => <NavRow key={n.id} label={n.name} count={itemsOf(n).length} d={LIST} onClick={() => go(['pl', n.id])} />)}
          </>
        )}
        {dir && !words.length && [...dir.dirs].map(([name, d]) => <NavRow key={name} label={name} count={countOf(d)} d={FOLDER} onClick={() => go([...path, name])} />)}
        {shown.length > 0 && <Label>{tracks.filter(match).length} TRACKS</Label>}
        {shown.map(t => <TrackRow key={`${t.library}/${t.id}`} t={t} s={get(t.id)} inList={inList.has(songKey(t))} onAdd={onAdd} />)}
        {(path.length > 0 || words.length > 0) && !shown.length && !dir?.dirs.size && <li className="px-3 py-6 text-center text-sm text-base-content/55">Nothing here{words.length ? ' matches' : ''}.</li>}
      </ul>
    </>
  )
}

function Thumb({ h }: { h: OnlineHit }) {
  return h.thumb ? <img src={h.thumb} alt="" loading="lazy" className="size-11 shrink-0 rounded-md object-cover" /> : <span className="size-11 shrink-0 rounded-md bg-white/8" />
}

function OnlineRow({ h, s, inList, onAdd }: { h: OnlineHit; s?: Summary; inList: boolean; onAdd: (t: MusicTrack) => void }) {
  const t = trackOfHit(h)
  const run = useRun(h.track_id)
  const analysed = !!(s?.harmony || s?.bpm)
  const running = run?.state === 'run' && !analysed
  return (
    <li {...targetProps(t)} className="group flex cursor-grab items-center gap-2.5 rounded-xl py-1.5 pl-2 pr-1 hover:bg-white/5">
      <Thumb h={h} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{h.title}</span>
        <span className="block truncate text-xs text-base-content/55">{h.artist || 'Unknown artist'}{h.duration ? ` · ${formatDuration(h.duration)}` : ''}{inList && <span className="text-success"> · in playlist</span>}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px]">
          {analysed ? <Meta s={s} /> : running ? (
            <span className="inline-flex items-center gap-2 text-primary">
              <span className="loading loading-spinner loading-xs" />
              {run.bpm ? <>Tempo {Math.round(run.bpm)} · key…</> : <>Tempo… {Math.round(run.progress * 100)}%</>}
            </span>
          ) : (
            <>
              <span className="text-base-content/45">Not analysed</span>
              <button onClick={e => { e.stopPropagation(); void analyseOnline(h.track_id) }} className="relative hit inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary hover:bg-primary/25">{icon(WAVE, 'size-3.5')}Analyse</button>
            </>
          )}
        </span>
      </span>
      <AddButton t={t} onAdd={onAdd} />
    </li>
  )
}

function Online({ byId, inList, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SearchSource>('ytmusic')
  const q = query.trim()
  const search = useMusicSearch(q, source)
  const hits = useMemo(() => {
    const seen = new Set<string>()
    return (search?.res.online ?? []).filter(h => (h.kind === 'track' || h.kind === 'video') && !seen.has(h.track_id) && seen.add(h.track_id))
  }, [search])
  const local = useMemo(() => (search?.res.library ?? []).flatMap(h => byId.get(h.track_id) ?? []), [search, byId])
  const ids = useMemo(() => [...hits.map(h => h.track_id), ...local.map(t => t.id)], [hits, local])
  const { get } = useSummaries(ids)
  const pending = q && (!search || search.pending.length > 0)
  const error = search && Object.values(search.res.errors)[0]
  const toAnalyse = hits.filter(h => !get(h.track_id)?.bpm)
  return (
    <>
      <div className="px-3">
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search YouTube, SoundCloud…" aria-label="Search online" className="input input-sm w-full" autoFocus />
      </div>
      <div role="group" aria-label="Source" className="flex gap-1.5 overflow-x-auto px-3 pt-2 [scrollbar-width:none]">
        {ONLINE.map(s => (
          <button key={s.id} onClick={() => setSource(s.id)} aria-pressed={source === s.id} className={`relative hit h-8 shrink-0 rounded-full px-3 text-xs font-medium ${source === s.id ? 'bg-primary/20 text-primary' : 'bg-white/6 text-base-content/70 hover:bg-white/10'}`}>{s.label}</button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2">
        {!q && <li className="px-3 py-6 text-center text-sm text-base-content/55">Search for a track you don't have. Analyse it to see where it fits.</li>}
        {pending && <li className="flex justify-center py-6"><span className="loading loading-spinner loading-sm text-primary" /></li>}
        {!pending && error && <li className="px-3 py-4 text-center text-sm text-error">{error}</li>}
        {source === 'library'
          ? local.map(t => <TrackRow key={t.id} t={t} s={get(t.id)} inList={inList.has(songKey(t))} onAdd={onAdd} />)
          : hits.map(h => <OnlineRow key={h.track_id} h={h} s={get(h.track_id)} inList={inList.has(songKey(h))} onAdd={onAdd} />)}
        {q && !pending && !error && !(source === 'library' ? local : hits).length && <li className="px-3 py-6 text-center text-sm text-base-content/55">No result on this source.</li>}
        {source !== 'library' && toAnalyse.length > 1 && (
          <li className="px-2 pt-2"><button onClick={() => toAnalyse.forEach(h => void analyseOnline(h.track_id))} className="btn btn-sm btn-soft btn-primary gap-1.5">{icon(WAVE)}Analyse all {toAnalyse.length} shown</button></li>
        )}
      </ul>
    </>
  )
}

interface Props {
  all: MusicTrack[]
  byId: ReadonlyMap<string, MusicTrack>
  /** The playlist being edited, left out of the other playlists. */
  nodeId: string
  /** Songs already in it (songKey). */
  inList: ReadonlySet<string>
  /** Add at the end. */
  onAdd: (t: MusicTrack) => void
}

/** Add from: Library | Online, with the body of the picked tab. */
export default function Sources({ tab, onTab, ...p }: Props & { tab: SourceTab; onTab: (t: SourceTab) => void }) {
  return (
    <section aria-label="Add from" className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
      <header className="flex items-center gap-2 px-3">
        <h2 className="flex-1 text-base font-semibold tracking-tight">Add from</h2>
        <div role="group" aria-label="Source" className="inline-flex rounded-full bg-white/6 p-0.5">
          {([['lib', 'Library'], ['online', 'Online']] as const).map(([v, label]) => (
            <button key={v} onClick={() => onTab(v)} aria-pressed={tab === v} className={`relative hit h-8 rounded-full px-3 text-xs font-medium ${tab === v ? 'bg-primary/20 text-primary' : 'text-base-content/70 hover:text-base-content'}`}>{label}</button>
          ))}
        </div>
      </header>
      {tab === 'lib' ? <Library {...p} /> : <Online {...p} />}
    </section>
  )
}
