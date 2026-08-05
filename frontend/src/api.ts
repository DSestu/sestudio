import type { CollectionEntry, ListName } from './collections'
import type { PlayerPrefs } from './playerPrefs'
import type { WatchEntry } from './watchState'

export interface SeasonCard {
  newsid: string
  title: string
  series_name: string
  season_number: number
  poster_url: string
  page_url: string
  is_film: boolean
  is_anime: boolean
  /** Release year parsed from the search title, 0 when absent. */
  year?: number
  /** Other source pages for this same title (other languages or mirrors), set
   *  by mergeCards. The detail view unions their languages. */
  alt_page_urls?: string[]
  /** The same alternates whole, so the card can list them and open one on its
   *  own when the merge was wrong. `alt_page_urls` is their flattened form. */
  alts?: SeasonCard[]
}

export interface EpisodeDetail {
  number: number
  title: string
  filename: string
  providers: string[]
  embed_urls: Record<string, string>
}

export interface SeasonDetail {
  season: number
  is_film: boolean
  available_langs: string[]
  episodes: EpisodeDetail[]
}

export type DownloadDestination = 'server' | 'device'

export interface AppSettings {
  output_root: string
  lang: string
  download_destination: DownloadDestination
  /** Whether a TMDB key is set — the key itself is never sent to the client. */
  tmdb_configured: boolean
  /** Use the resolved TMDB id as a title's identity when merging search
   *  results, instead of its name. Needs a key; off by default. */
  tmdb_merge: boolean
  /** Show TMDB posters, ratings and years on result cards. Needs a key; on by
   *  default. Off falls back to the source's own posters. */
  tmdb_cards: boolean
  /** Write-only: sent when saving a new key, never returned. */
  tmdb_api_key?: string
}

export interface TmdbCast {
  id: number
  name: string
  character: string
  profile_url: string
}

export interface TmdbPersonRef {
  id: number
  name: string
}

export interface TmdbMeta {
  tmdb_id: number
  kind: string
  title: string
  overview: string
  year: number
  rating: number
  vote_count: number
  poster_url: string
  backdrop_url: string
  genres: string[]
  cast: TmdbCast[]
  directors: TmdbPersonRef[]
  recommendations: TrendingCard[]
  trailer_key: string
}

export interface TrendingCard {
  tmdb_id: number
  kind: string
  title: string
  year: number
  rating: number
  poster_url: string
}

export type TmdbKind = 'movie' | 'tv'

export interface DiscoverFilters {
  kind: TmdbKind
  sortBy: string
  /** TMDB genre ids. */
  genres: number[]
  minScore: number
  /** 10 = no ceiling. A low ceiling finds enjoyably bad films. */
  maxScore: number
  minVotes: number
}

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  kind: 'movie',
  sortBy: 'popularity.desc',
  genres: [],
  minScore: 0,
  maxScore: 10,
  minVotes: 0,
}

export interface DiscoverPage {
  page: number
  total_pages: number
  results: TrendingCard[]
}

export interface TmdbGenre {
  id: number
  name: string
}

export interface TmdbCredit extends TrendingCard {
  /** Character(s) played and/or crew job, e.g. "Cameo · Director". */
  role: string
}

export interface TmdbPerson {
  id: number
  name: string
  biography: string
  known_for_department: string
  profile_url: string
  birthday: string
  credits: TmdbCredit[]
}

/** TMDB names date/title sort fields differently per media type. */
function sortParam(kind: TmdbKind, sortBy: string): string {
  if (sortBy.startsWith('date.')) {
    return (kind === 'movie' ? 'primary_release_date' : 'first_air_date') + sortBy.slice('date'.length)
  }
  if (sortBy.startsWith('title.')) {
    return (kind === 'movie' ? 'title' : 'name') + sortBy.slice('title'.length)
  }
  return sortBy
}

/** One page of the TMDB catalogue under the given sort/filters. */
export async function discoverTitles(filters: DiscoverFilters, page: number): Promise<DiscoverPage> {
  const params = new URLSearchParams({
    kind: filters.kind,
    sort_by: sortParam(filters.kind, filters.sortBy),
    page: String(page),
  })
  if (filters.genres.length) params.set('genres', filters.genres.join(','))
  if (filters.minScore > 0) params.set('min_score', String(filters.minScore))
  if (filters.maxScore < 10) params.set('max_score', String(filters.maxScore))
  if (filters.minVotes > 0) params.set('min_votes', String(filters.minVotes))
  const res = await fetch(`${BASE}/tmdb/discover?${params}`)
  if (!res.ok) return { page: 1, total_pages: 1, results: [] }
  return res.json()
}

export async function getGenres(kind: TmdbKind): Promise<TmdbGenre[]> {
  const res = await fetch(`${BASE}/tmdb/genres?kind=${kind}`)
  if (!res.ok) return []
  return res.json()
}

/** A person's profile and filmography, or null when unknown / TMDB disabled. */
export async function getPerson(id: number): Promise<TmdbPerson | null> {
  const res = await fetch(`${BASE}/tmdb/person/${id}`)
  if (!res.ok) return null
  return res.json()
}

/** Metadata for a title, or null when TMDB has no match / is disabled. */
export async function enrichTitle(
  title: string,
  year: number,
  isFilm: boolean,
): Promise<TmdbMeta | null> {
  const params = new URLSearchParams({
    title,
    year: String(year || 0),
    is_film: String(isFilm),
  })
  const res = await fetch(`${BASE}/tmdb/enrich?${params}`)
  if (!res.ok) return null  // 503 = no key configured; enrichment is optional
  return res.json()
}

export async function getTrending(): Promise<TrendingCard[]> {
  const res = await fetch(`${BASE}/tmdb/trending`)
  if (!res.ok) return []
  return res.json()
}

export interface DownloadItem {
  embed_url: string
  provider: string
  episode_name: string
  series_name: string
  season: number
  lang: string
  all_providers: Record<string, string>
  /** Download to a temp dir for the browser to collect, not into the library. */
  to_device?: boolean
}

export interface DownloadJob {
  id: string
  episode_name: string
  status: 'queued' | 'downloading' | 'done' | 'failed' | 'skipped' | 'cancelled'
  progress: number
  speed: string
  eta: string
  error: string | null
  /** What the job is doing beyond the percentage. */
  phase?: string        // downloading | processing | retrying
  detail?: string       // human-readable note for the current phase
  total_size?: string   // e.g. "412.53MiB"
  fragment?: string     // HLS fragment counter, e.g. "42/318"
  provider?: string     // host currently being downloaded from
  /** Staged on the server for this browser to collect once done. */
  to_device?: boolean
}

/** URL serving a finished device-bound job's file as an attachment. */
export function jobFileUrl(jobId: string): string {
  return `${BASE}/downloads/${jobId}/file`
}

const BASE = '/api'

export interface StreamSource {
  proxy_url: string
  kind: 'hls' | 'mp4'
  provider: string
}

/**
 * Resolve an episode's providers to a playable proxy URL, falling back across
 * providers server-side. `preferKind` keeps looking for a provider of that kind
 * (e.g. 'mp4' for device downloads) before settling for another.
 */
export async function resolveStream(
  embedUrls: Record<string, string>,
  signal?: AbortSignal,
  preferKind?: StreamSource['kind'],
): Promise<StreamSource> {
  const res = await fetch(`${BASE}/stream/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embed_urls: embedUrls, prefer_kind: preferKind }),
    signal,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `Stream resolve failed: ${res.status}`)
  }
  return res.json()
}

export interface Renderer {
  name: string
  udn: string
}

/** The direct HTTP port cast devices should fetch media on (bypasses any HTTPS front). */
export async function getCastHttpPort(): Promise<number> {
  const res = await fetch(`${BASE}/cast/http-port`)
  if (!res.ok) throw new Error(`http-port fetch failed: ${res.status}`)
  return (await res.json()).http_port
}

/** Discover DLNA MediaRenderers on the LAN (a ~4s SSDP scan). */
export async function listRenderers(): Promise<Renderer[]> {
  const res = await fetch(`${BASE}/cast/dlna/renderers`)
  if (!res.ok) throw new Error(`Renderer scan failed: ${res.status}`)
  return res.json()
}

/** Push a resolved proxy URL to a DLNA renderer and start playback. */
export async function dlnaPlay(
  rendererUdn: string,
  proxyUrl: string,
  title: string,
  kind: string,
): Promise<void> {
  const res = await fetch(`${BASE}/cast/dlna/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ renderer_udn: rendererUdn, proxy_url: proxyUrl, title, kind }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `Cast failed: ${res.status}`)
  }
}

/**
 * URL that streams an already-resolved source to the browser as a file
 * download. The proxy URL carries the signed token; the server relays the
 * bytes with a Content-Disposition attachment header (MP4 only for now).
 */
export function deviceDownloadUrl(proxyUrl: string, filename: string): string {
  const token = new URLSearchParams(proxyUrl.split('?')[1] ?? '').get('token') ?? ''
  return `${BASE}/downloads/stream?${new URLSearchParams({ token, filename })}`
}

export async function searchSeasons(q: string): Promise<SeasonCard[]> {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}

export async function getSeason(url: string, lang: string): Promise<SeasonDetail> {
  const res = await fetch(`${BASE}/season?url=${encodeURIComponent(url)}&lang=${lang}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail ?? `HTTP ${res.status}`
    throw new Error(detail)
  }
  return res.json()
}

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`)
  if (!res.ok) throw new Error('Settings fetch failed')
  return res.json()
}

export async function putSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Settings save failed')
  return res.json()
}

// --- Library (server-side watch state / collections / preferences, #24) ----- #

export interface LibrarySnapshot {
  watch: Record<string, WatchEntry>
  collections: { watchlist: Record<string, CollectionEntry>; favourites: Record<string, CollectionEntry> }
  player: PlayerPrefs | null
  playlist_collapsed: boolean
  /** Per-tab library layout, or null before anything was ever set (#26). */
  library_layout: unknown
}

/** The whole library, for hydrating the client stores on load. */
export async function getLibrary(): Promise<LibrarySnapshot> {
  const res = await fetch(`${BASE}/library`)
  if (!res.ok) throw new Error('Library fetch failed')
  return res.json()
}

// Mutators are fire-and-forget from the store's perspective (callers .catch()).
// Keys can contain "|" and "/", so they're percent-encoded into the path.

export async function putWatchEntry(key: string, entry: WatchEntry): Promise<void> {
  await fetch(`${BASE}/library/watch/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
}

export async function deleteWatchEntry(key: string): Promise<void> {
  await fetch(`${BASE}/library/watch/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

export async function putCollectionEntry(list: ListName, key: string, entry: CollectionEntry): Promise<void> {
  await fetch(`${BASE}/library/collections/${list}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
}

export async function deleteCollectionEntry(list: ListName, key: string): Promise<void> {
  await fetch(`${BASE}/library/collections/${list}/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

/** Deletes and puts applied server-side in one transaction. Keys travel in the
 *  body, so unlike the single-entry mutators they need no percent-encoding. */
export interface LibraryBatch {
  watch_delete?: string[]
  watch_put?: { key: string; entry: WatchEntry }[]
  collections_delete?: { list: ListName; key: string }[]
  collections_put?: { list: ListName; key: string; entry: CollectionEntry }[]
}

/**
 * Apply many library mutations at once. Unlike the single-entry mutators this
 * reports failure, because callers apply optimistically and need to roll back.
 */
export async function batchLibrary(batch: LibraryBatch): Promise<void> {
  const res = await fetch(`${BASE}/library/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  })
  if (!res.ok) throw new Error('Library batch failed')
}

export type PreferenceKey = 'player' | 'playlist_collapsed' | 'library_layout'

export async function putPreference(key: PreferenceKey, value: unknown): Promise<void> {
  await fetch(`${BASE}/library/preferences/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
}

export async function importLibrary(snapshot: LibrarySnapshot): Promise<{ imported: boolean }> {
  const res = await fetch(`${BASE}/library/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!res.ok) return { imported: false }
  return res.json()
}

export async function checkDownloads(items: DownloadItem[]): Promise<string[]> {
  const res = await fetch(`${BASE}/downloads/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error('Check request failed')
  return res.json()
}

export async function postDownloads(items: DownloadItem[]): Promise<DownloadJob[]> {
  const res = await fetch(`${BASE}/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!res.ok) throw new Error('Download request failed')
  return res.json()
}

export async function cancelJob(id: string): Promise<void> {
  const res = await fetch(`${BASE}/downloads/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Cancel failed: ${res.status}`)
}

export async function clearHistory(): Promise<void> {
  const res = await fetch(`${BASE}/downloads`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Clear failed: ${res.status}`)
}

export async function getJobs(): Promise<DownloadJob[]> {
  const res = await fetch(`${BASE}/downloads`)
  if (!res.ok) throw new Error('Jobs fetch failed')
  return res.json()
}

export function subscribeJobProgress(
  jobId: string,
  onEvent: (data: Partial<DownloadJob>) => void,
  onDone: () => void,
): () => void {
  const es = new EventSource(`${BASE}/downloads/${jobId}/progress`)
  es.onmessage = (e) => {
    const data = JSON.parse(e.data)
    onEvent(data)
    if (data.status === 'done' || data.status === 'failed' || data.status === 'cancelled') {
      es.close()
      onDone()
    }
  }
  es.onerror = () => { es.close(); onDone() }
  return () => es.close()
}
