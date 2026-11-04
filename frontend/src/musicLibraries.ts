import { useEffect, useSyncExternalStore } from 'react'
import { UNKNOWN_ARTIST, type MusicTrack } from './musicLibrary'

// The music libraries (SPEC-music §13.1): this PC, other folders, another
// sestudio server, a YouTube Music account. A shared copy of their status and
// of the tracks of every library but this PC (that one is the downloads listing).

const BASE = '/api/music'

export type LibraryKind = 'local' | 'local_folder' | 'remote_sestudio' | 'ytmusic_account'

export interface LibraryStatus {
  id: string
  kind: LibraryKind
  label: string
  path?: string
  url?: string
  state: 'online' | 'offline' | 'needs_signin'
  /** Unix seconds of the first failed contact, while offline. */
  since: number | null
  error: string
  count: number
  /** Tracks analysed so far; null for a library the server does not analyse itself. */
  indexed: number | null
  indexing: boolean
}

export interface ShareToken {
  id: string
  label: string
  created: number
}

export interface NewLibrary {
  kind: Exclude<LibraryKind, 'local'>
  label?: string
  path?: string
  url?: string
  token?: string
}

export interface FolderRoot {
  label: string
  path: string
}

export interface FolderRow {
  name: string
  path: string
  readable: boolean
  has_children: boolean
  /** Audio files found under it; the count stops at a cap (then `capped`). */
  audio: number
  capped: boolean
}

export interface FolderListing {
  path: string
  /** Empty at the top of a drive. */
  parent: string
  crumbs: { name: string; path: string }[]
  readable: boolean
  folders: FolderRow[]
}

interface ServerTrack {
  id: string
  library: string
  crate: string
  library_label: string
  source: string
  title: string
  artist: string
  album: string
  duration: number
  folder: string
  name: string
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `libraries: ${res.status}`)
  return res.json()
}

export const toMusicTrack = (t: ServerTrack): MusicTrack => ({
  id: t.id,
  library: t.library,
  crate: t.crate,
  libraryLabel: t.library_label,
  source: t.source,
  title: t.title,
  artist: t.artist || UNKNOWN_ARTIST,
  album: t.album,
  duration: t.duration,
  folder: t.folder,
  albumName: t.name,
})

/** Where a track of a non-local library plays from. */
export const libraryAudioUrl = (t: Pick<ServerTrack, 'library' | 'id'>) =>
  `${BASE}/libraries/${encodeURIComponent(t.library)}/tracks/${encodeURIComponent(t.id)}/audio`

export const fetchLibraryTracks = () => call<ServerTrack[]>('/libraries/tracks')

/** "offline since 14:05", "needs sign-in", "indexing 12/40", else what kind of library it is. */
export function stateLine(l: LibraryStatus, locale?: string): string {
  if (l.state === 'needs_signin') return 'needs sign-in'
  if (l.state === 'offline') {
    const at = l.since ? new Date(l.since * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : ''
    return at ? `offline since ${at}` : 'offline'
  }
  if (l.indexing && l.indexed !== null) return `indexing ${l.indexed}/${l.count}`
  return KIND_LINE[l.kind]
}

const KIND_LINE: Record<LibraryKind, string> = {
  local: 'this machine',
  local_folder: 'folder',
  remote_sestudio: 'sestudio server',
  ytmusic_account: 'likes',
}

// --- shared copy -----------------------------------------------------------------

let libraries: LibraryStatus[] = []
let extra: MusicTrack[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

async function loadLibraries() {
  libraries = await call<LibraryStatus[]>('/libraries')
  emit()
}

async function loadExtra() {
  extra = (await fetchLibraryTracks()).map(toMusicTrack)
  emit()
}

/** Fetch both again, after a library was added or removed. */
export const reloadLibraries = () => Promise.all([loadLibraries(), loadExtra()])

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

/** The libraries with their status; polled while one is indexing or not online. */
export function useLibraries(): LibraryStatus[] {
  const list = useSyncExternalStore(subscribe, () => libraries)
  const busy = list.some(l => l.state !== 'online' || l.indexing)
  useEffect(() => {
    void loadLibraries().catch(() => {})
    if (!busy) return
    const id = window.setInterval(() => void loadLibraries().catch(() => {}), 10_000)
    return () => window.clearInterval(id)
  }, [busy])
  return list
}

/** The tracks of every library but this PC; fetched again when a library's count changes. */
export function useLibraryTracks(): MusicTrack[] {
  const list = useSyncExternalStore(subscribe, () => extra)
  const counts = useSyncExternalStore(subscribe, () => libraries.map(l => `${l.id}:${l.count}`).join())
  useEffect(() => { void loadExtra().catch(() => {}) }, [counts])
  return list
}

const reloaded = <T,>(p: Promise<T>) => p.then(async r => { await reloadLibraries(); return r })

export const foldersApi = {
  roots: () => call<{ roots: FolderRoot[] }>('/folders').then(r => r.roots),
  browse: (path: string) => call<FolderListing>(`/folders?path=${encodeURIComponent(path)}`),
}

/** GET /api/music/analysis/status: the background analysis, and its pass reading each track's tonic and mode. */
export interface AnalysisStatus {
  done: number
  total: number
  running: boolean
  modes: { done: number; total: number }
}

export const librariesApi = {
  analysisStatus: () => call<AnalysisStatus>('/analysis/status'),
  add: (lib: NewLibrary) => reloaded(call<LibraryStatus>('/libraries', 'POST', lib)),
  rename: (id: string, label: string) => reloaded(call<LibraryStatus>(`/libraries/${encodeURIComponent(id)}`, 'PATCH', { label })),
  remove: (id: string) => reloaded(call<{ ok: boolean }>(`/libraries/${encodeURIComponent(id)}`, 'DELETE')),
  /** Analyse a library's files again (every library's without an id); its row then shows the progress. */
  reanalyse: (id?: string) =>
    reloaded(call<{ tracks: number }>(id ? `/libraries/${encodeURIComponent(id)}/reanalyse` : '/libraries/reanalyse', 'POST')),
  tokens: () => call<ShareToken[]>('/share-tokens'),
  createToken: (label: string) => call<ShareToken & { token: string }>('/share-tokens', 'POST', { label }),
  revokeToken: (id: string) => call<{ ok: boolean }>(`/share-tokens/${encodeURIComponent(id)}`, 'DELETE'),
}
