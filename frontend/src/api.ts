import type { CollectionEntry, ListName } from './collections'
import type { ReleaseState } from './releaseDates'
import { effectiveWindow } from './releaseDates'
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
  /** Id of the content site this card came from; absent means 'fstream'. */
  source?: string
  /** Release year parsed from the search title, 0 when absent. */
  year?: number
  /** Other source pages for this same title (other languages or mirrors), set
   *  by mergeCards. The detail view unions their languages. */
  alt_page_urls?: string[]
  /** The same alternates whole, so the card can list them and open one on its
   *  own when the merge was wrong. `alt_page_urls` is their flattened form. */
  alts?: SeasonCard[]
  /** The show's other seasons, already merged themselves, when seasons are
   *  collapsed into one card. Never mixed into `alts`: those are other pages of
   *  *this* season, which the detail view unions, whereas these are separate
   *  titles that must stay separately openable. */
  seasons?: SeasonCard[]
}

export interface EpisodeDetail {
  number: number
  title: string
  filename: string
  providers: string[]
  embed_urls: Record<string, string>
  /** Every language this episode exists in site-wide, not just the fetched one.
   *  Absent or empty when the site cannot say. No embeds but a non-empty list
   *  means the episode exists only in another language. */
  langs?: string[]
}

export interface SeasonDetail {
  season: number
  is_film: boolean
  available_langs: string[]
  /** Id of the content site that served this page. */
  source?: string
  /** The site's provider preference order, for ranking provider chips. */
  provider_order?: string[]
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
  tmdb_posters: boolean
  /** Write-only: sent when saving a new key, never returned. */
  tmdb_api_key?: string
  /** Content sites excluded from search. Opt-out, so a new site is on by
   *  default; disabling one never stops its saved titles from playing. */
  disabled_sites?: string[]
  /** Site to favour when several carry the same title: listed first, and it
   *  wins the card when listings from different sites are merged. */
  preferred_site?: string
  /** Start playing as soon as a title is opened. Off means opening a title only
   *  browses it, leaving whatever is already playing alone until you press play. */
  autoplay_on_open?: boolean
  /** Show one card per show in search results instead of one per season, with
   *  the season count on the card. On by default. */
  collapse_seasons?: boolean
  /** Download preference, most-wanted first; empty means the built-in order.
   *  Unranked entries stay available as fallback. */
  preferred_hosts?: string[]
  preferred_sites?: string[]
  /** Send a message when a watcher finds something. Off unless a channel is
   *  configured, so nothing is ever sent by default. */
  notifications_enabled?: boolean
  /** CallMeBot number, international form without the leading '+'. Not secret. */
  callmebot_phone?: string
  /** Write-only: sent when saving, never returned. */
  callmebot_apikey?: string
  /** Whether a CallMeBot number and key are both stored. Read-only. */
  callmebot_configured?: boolean
  /** Concurrent downloads a watcher may run, kept below the interactive pool. */
  watcher_max_concurrent?: number
  /** Every host a download could use, for the ranking control. Read-only. */
  known_hosts?: string[]
  /** The shipped order, restored by "Reset". Read-only. */
  default_hosts?: string[]
}

export interface SiteInfo {
  id: string
  display_name: string
  is_anime: boolean
  enabled: boolean
}

/** The content sites this server knows about, for the source toggles. */
export async function getSites(): Promise<SiteInfo[]> {
  const res = await fetch(`${BASE}/sites`)
  if (!res.ok) return []
  return res.json()
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
  /** Full release date, ISO `YYYY-MM-DD`; '' when TMDB has none. Only the day
   *  separates what is out from what is merely announced. */
  release_date?: string
  rating: number
  poster_url: string
  /** For the browse list's detail layout. Empty when TMDB has none in `fr-FR`. */
  overview: string
  /** Ids, not names — the client already holds the id→name list for its chips. */
  genre_ids: number[]
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
  /** Release-date window as ISO `YYYY-MM-DD`; '' on either bound means "open". */
  fromDate: string
  toDate: string
  /** Which side of today to list. Defaults to released: an announced title
   *  can't be watched, and under a date sort they would fill every page. */
  releaseState: ReleaseState
}

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  kind: 'movie',
  sortBy: 'popularity.desc',
  genres: [],
  minScore: 0,
  maxScore: 10,
  minVotes: 0,
  fromDate: '',
  toDate: '',
  releaseState: 'out',
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
  // The released/incoming choice tightens the window at the request, not on
  // the response: under a date sort every title on page one can be an
  // announcement, and filtering those out client-side would leave the page
  // empty however far it paged.
  const window = effectiveWindow(
    { from: filters.fromDate, to: filters.toDate },
    filters.releaseState,
  )
  if (window.from) params.set('from_date', window.from)
  if (window.to) params.set('to_date', window.to)
  const res = await fetch(`${BASE}/tmdb/discover?${params}`)
  if (!res.ok) return { page: 1, total_pages: 1, results: [] }
  return res.json()
}

export async function getGenres(kind: TmdbKind): Promise<TmdbGenre[]> {
  const res = await fetch(`${BASE}/tmdb/genres?kind=${kind}`)
  if (!res.ok) return []
  return res.json()
}

export interface PersonHit {
  id: number
  name: string
  known_for_department: string
  profile_url: string
  /** A few titles they are known for, to tell namesakes apart. */
  known_for: string[]
}

/** People matching a name. Empty when TMDB is disabled or has no match. */
export async function searchPeople(q: string): Promise<PersonHit[]> {
  const res = await fetch(`${BASE}/tmdb/people?q=${encodeURIComponent(q)}`)
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
  /** Id of the content site that produced the embeds; absent means 'fstream'. */
  source?: string
  /** Recorded next to the finished file so the local library can show a poster
   *  and offer a way back to the title. Neither survives in the path. */
  poster_url?: string
  page_url?: string
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

/** A sidecar subtitle track served alongside a stream, proxied like the media. */
export interface StreamSubtitle {
  proxy_url: string
  /** Language code as the host wrote it ("fre", "fr", "en") — not normalised. */
  lang: string
  label: string
  /** The host marked this track as the one to enable on load. */
  default: boolean
}

export interface StreamSource {
  proxy_url: string
  kind: 'hls' | 'mp4'
  provider: string
  /** Empty for hardsubbed releases, which is most of them. */
  subtitles?: StreamSubtitle[]
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
  source?: string,
): Promise<StreamSource> {
  const res = await fetch(`${BASE}/stream/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embed_urls: embedUrls,
      prefer_kind: preferKind,
      source: source ?? 'fstream',
    }),
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

/**
 * The direct HTTP port cast devices should fetch media on (bypasses any HTTPS front).
 *
 * null when the server runs HTTPS-only (`serve --no-http`) and there is no such
 * port — callers must then keep the media on the page's own origin.
 */
export async function getCastHttpPort(): Promise<number | null> {
  const res = await fetch(`${BASE}/cast/http-port`)
  if (!res.ok) throw new Error(`http-port fetch failed: ${res.status}`)
  return (await res.json()).http_port ?? null
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

/** Site id for a title that lives only on disk — not a real content site. */
export const DOWNLOADED_SOURCE = 'downloaded'

/** URL that stands in for a title held only on disk, with no site page. */
export function downloadedPageUrl(series: string, season: number): string {
  return `downloaded:${series}|${season}`
}

export async function getSeason(url: string, lang: string, source?: string): Promise<SeasonDetail> {
  // A title that exists only on disk has no page to fetch, so its season is
  // built from the files instead. Same payload shape, so every caller — the
  // watch view, the playlist, the language switcher — is unaware of it.
  if (source === DOWNLOADED_SOURCE) {
    const [series, season] = url.replace(/^downloaded:/, '').split('|')
    const local = new URLSearchParams({ series, season: season ?? '0' })
    const res = await fetch(`${BASE}/downloaded/season?${local}`)
    if (!res.ok) throw new Error('That title is no longer on disk.')
    return res.json()
  }
  const params = new URLSearchParams({ url, lang })
  if (source) params.set('source', source)
  const res = await fetch(`${BASE}/season?${params}`)
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

// --- Local library (what has been downloaded) ------------------------------- #

export interface DownloadedFile {
  /** Path relative to the download root. The id for playing and deleting. */
  path: string
  /** 0 for a film, or a file whose name carries no SxxEyy prefix. */
  number: number
  title: string
  /** '' for a file stored without a language folder. */
  lang: string
  size: number
  mtime: number
}

export interface DownloadedTitle {
  key: string
  /** Directory that named this title, relative to the download root, with the
   *  season and language folders stripped. '' for a file loose in the root. */
  folder: string
  /** The real name when the download was recorded, else the (lossy) folder name. */
  series: string
  season: number
  is_film: boolean
  poster_url: string
  /** The page this came from, when known — lets the title open its full listing. */
  page_url: string
  source: string
  langs: string[]
  files: DownloadedFile[]
  size: number
  mtime: number
}

/** Everything on disk, grouped by title. Newest first. */
export async function getDownloadedLibrary(): Promise<DownloadedTitle[]> {
  const res = await fetch(`${BASE}/downloaded`)
  if (!res.ok) return []
  return res.json()
}

/** Playable URL for a downloaded file. Serves inline, with range support.
 *
 * `audioIndex` picks an audio track other than the file's first. No browser can
 * choose a track itself, so the server builds a copy carrying the wanted one —
 * about a second for a whole episode, cached, and longer only when the track's
 * codec has to be re-encoded to play at all.
 */
export function downloadedFileUrl(path: string, audioIndex?: number): string {
  const base = `${BASE}/downloaded/file?path=${encodeURIComponent(path)}`
  return audioIndex ? `${base}&audio=${audioIndex}` : base
}

/** One audio or subtitle track inside a downloaded file. */
export interface DownloadedTrack {
  index: number
  codec: string
  lang: string
  label: string
  default: boolean
  /** False for a picture-based subtitle (PGS/VOBSUB), which cannot be shown as text. */
  text: boolean
  /** Subtitles only: where to load the WebVTT from. */
  url?: string
  /** Subtitles only: inside the container, rather than a `.vtt` beside it. */
  embedded?: boolean
}

export interface DownloadedTracks {
  audio: DownloadedTrack[]
  subtitles: DownloadedTrack[]
}

/** What is inside a downloaded file.
 *
 * Costs an ffmpeg probe on the server the first time, so it is asked for when an
 * episode is opened rather than while drawing a shelf. Failure is not worth
 * surfacing — it only means no track menus — so this resolves to empty lists.
 */
export async function downloadedTracks(path: string): Promise<DownloadedTracks> {
  const empty = { audio: [], subtitles: [] }
  try {
    const res = await fetch(`${BASE}/downloaded/tracks?path=${encodeURIComponent(path)}`)
    return res.ok ? await res.json() : empty
  } catch {
    return empty
  }
}

/** A still extracted from the file itself, for a title TMDB has no poster for.
 *  404s when ffmpeg is unavailable, so callers treat it as a best effort. */
export function downloadedThumbUrl(path: string): string {
  return `${BASE}/downloaded/thumb?path=${encodeURIComponent(path)}`
}

export async function deleteDownloadedFile(path: string): Promise<void> {
  const res = await fetch(`${BASE}/downloaded/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Delete failed')
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

// --- watchers & notifications ---------------------------------------------- //

export type WatcherKind =
  | 'series_episodes'
  | 'title_lang'
  | 'film_available'
  | 'saved_search'
  | 'tmdb_criteria'

export interface Watcher {
  id: number
  kind: WatcherKind
  label: string
  /** Kind-specific and stored verbatim; the server validates its shape. */
  config: Record<string, unknown>
  enabled: boolean
  auto_download: boolean
  interval_seconds: number
  created_at: number
  next_poll_at: number
  last_polled_at: number | null
  last_ok_at: number | null
  last_error: string | null
  consecutive_failures: number
  /** Null until the first successful check, which records a baseline silently. */
  baselined_at: number | null
}

export interface WatcherEvent {
  id: number
  /** Null once the watcher that produced it was deleted; the row still stands. */
  watcher_id: number | null
  watcher_kind: string
  event_type: 'new_item' | 'watcher_error' | 'watcher_disabled'
  item_key: string
  title: string
  subtitle: string
  poster_url: string
  /** Enough to open or download the item without another lookup. */
  data: {
    page_url?: string
    source?: string
    lang?: string
    season?: number
    number?: number
    is_film?: boolean
    series_name?: string
    episode_name?: string
    kind?: string
    error?: string
  }
  created_at: number
  read_at: number | null
  job_id: string | null
  download_state: '' | 'queued' | 'skipped' | 'error'
}

export interface NotificationPage {
  events: WatcherEvent[]
  unread: number
}

export interface WatcherPollResult {
  events: WatcherEvent[]
  error: string | null
  failures: number
  disabled: boolean
}

export async function getWatchers(): Promise<Watcher[]> {
  const res = await fetch(`${BASE}/watchers`)
  if (!res.ok) return []
  return res.json()
}

export async function createWatcher(body: {
  kind: WatcherKind
  config: Record<string, unknown>
  label?: string
  auto_download?: boolean
  interval_seconds?: number
}): Promise<Watcher> {
  const res = await fetch(`${BASE}/watchers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Could not create watcher: ${res.status}`)
  return res.json()
}

export async function patchWatcher(
  id: number,
  patch: Partial<Pick<Watcher, 'label' | 'enabled' | 'auto_download' | 'interval_seconds'>> & {
    config?: Record<string, unknown>
  },
): Promise<Watcher> {
  const res = await fetch(`${BASE}/watchers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Could not update watcher: ${res.status}`)
  return res.json()
}

export async function deleteWatcher(id: number): Promise<void> {
  const res = await fetch(`${BASE}/watchers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Could not delete watcher: ${res.status}`)
}

/** Check one watcher now. A watcher's first check reports nothing by design. */
export async function pollWatcher(id: number): Promise<WatcherPollResult> {
  const res = await fetch(`${BASE}/watchers/${id}/poll`, { method: 'POST' })
  if (!res.ok) throw new Error(`Check failed: ${res.status}`)
  return res.json()
}

export async function getNotifications(
  opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
): Promise<NotificationPage> {
  const q = new URLSearchParams()
  if (opts.limit !== undefined) q.set('limit', String(opts.limit))
  if (opts.offset !== undefined) q.set('offset', String(opts.offset))
  if (opts.unreadOnly) q.set('unread_only', 'true')
  const res = await fetch(`${BASE}/notifications?${q}`)
  if (!res.ok) return { events: [], unread: 0 }
  return res.json()
}

export async function markNotificationsRead(
  target: { ids: number[] } | { all: true },
): Promise<{ marked: number; unread: number }> {
  const res = await fetch(`${BASE}/notifications/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target),
  })
  if (!res.ok) throw new Error(`Could not mark read: ${res.status}`)
  return res.json()
}
