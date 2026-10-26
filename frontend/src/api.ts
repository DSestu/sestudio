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
  /** Whether the downloaded browser may delete files from disk. Off by default. */
  allow_file_deletion?: boolean
  /** Offer frame rates above the source's, drawn by AI. On by default; off,
   *  the server neither fetches nor offers them. */
  frame_interpolation?: boolean
  /** Drawings held up to this many frames are drawn across as one by AI
   *  (anime); 0, off. */
  ai_max_hold?: number
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
  /** The site's front page ("" when unknown). */
  url: string
  is_anime: boolean
  enabled: boolean
}

/** A link that opens a title's page on its own site, in the browser. */
export function siteLink(source: string, pageUrl: string): string {
  return `${BASE}/sites/${encodeURIComponent(source)}/open?url=${encodeURIComponent(pageUrl)}`
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
// Answers kept for the session, so switching between Everything and People
// doesn't ask TMDB again. Failures aren't kept, so Retry really retries.
const peopleCache = new Map<string, PersonHit[]>()

/** People named like the query, or null when TMDB didn't answer. */
export async function searchPeople(q: string): Promise<PersonHit[] | null> {
  const cached = peopleCache.get(q)
  if (cached) return cached
  try {
    const res = await fetch(`${BASE}/tmdb/people?q=${encodeURIComponent(q)}`)
    if (!res.ok) return null
    const hits: PersonHit[] = await res.json()
    peopleCache.set(q, hits)
    return hits
  } catch {
    return null
  }
}

/** A person's profile and filmography, or null when unknown / TMDB disabled. */
/** The title a mistyped search most likely meant ("dnue" → Dune), or null.
 *  Asked only once a search has come back empty. */
export async function suggestTitle(q: string): Promise<TrendingCard | null> {
  try {
    const res = await fetch(`${BASE}/tmdb/suggest?q=${encodeURIComponent(q)}`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

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

/** A browsable catalogue (a site's own, or TMDB's). */
export interface CatalogInfo {
  id: string
  label: string
  description: string
  /** The catalogue's own website ("" when it has none). */
  url: string
}

/** One filter a catalogue offers. Values travel as strings: a multi is
 *  comma-joined, a range is "lo,hi"; a range bound at its extreme is open. */
export interface FilterField {
  key: string
  label: string
  type: 'select' | 'multi' | 'range'
  options: { value: string; label: string }[]
  default: string
  min: number
  max: number
  step: number
  /** Other fields' options depend on this one: refetch the schema on change. */
  reload: boolean
  /** How many a multi can combine (0 = unlimited). */
  max_selected: number
  /** Shown as one-click chips where there is room (genres). */
  quick: boolean
}

/** Non-default filter values, by field key. */
export type CatalogValues = Record<string, string>

export interface CatalogCard {
  key: string
  title: string
  year: number
  poster_url: string
  rating: number
  overview: string
  /** A date to show over the poster (an announced release, a next airing). */
  badge: string
  genres: string[]
  /** A site's own title opens directly; a TMDB title is searched for. */
  open: { card?: SeasonCard; search?: { term: string; year: number } }
}

export interface Shelf {
  id: string
  title: string
  cards: CatalogCard[]
  /** The filters listing this shelf in full ("See all"). */
  values: CatalogValues
}

export interface CatalogPage {
  cards: CatalogCard[]
  page: number
  has_more: boolean
  /** Set when the catalogue had to ignore part of the request. */
  note: string
}

/** The server's `detail` for a failed request, or its status. */
async function errorDetail(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return body?.detail ?? `HTTP ${res.status}`
}

export async function getCatalogs(): Promise<CatalogInfo[]> {
  const res = await fetch(`${BASE}/catalogs`)
  if (!res.ok) return []
  return res.json()
}

/** A Home row a content site offers on its own (no TMDB needed). */
export interface BrowseRow {
  source: string
  title: string
  cards: SeasonCard[]
}

export async function getBrowseRows(): Promise<BrowseRow[]> {
  const res = await fetch(`${BASE}/browse`)
  if (!res.ok) return []
  return res.json()
}

export async function getCatalogSchema(id: string, values: CatalogValues): Promise<FilterField[]> {
  const res = await fetch(`${BASE}/catalogs/${id}/schema?${new URLSearchParams(values)}`)
  if (!res.ok) throw new Error(await errorDetail(res))
  return res.json()
}

export async function getShelves(id: string): Promise<Shelf[]> {
  const res = await fetch(`${BASE}/catalogs/${id}/shelves`)
  if (!res.ok) throw new Error(await errorDetail(res))
  return res.json()
}

export async function discoverCatalog(id: string, values: CatalogValues, page: number): Promise<CatalogPage> {
  const params = new URLSearchParams({ ...values, page: String(page) })
  const res = await fetch(`${BASE}/catalogs/${id}/discover?${params}`)
  if (!res.ok) throw new Error(await errorDetail(res))
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
  /** What a DLNA TV is sent instead of `proxy_url`, when they differ. A
   *  downloaded file the browser needs HLS for goes to the TV as the file
   *  itself: TVs decode AVI and AC-3 on their own, few play HLS, and the
   *  playlist route answers their HEAD probe with 405 — UPnP 716. */
  dlna_url?: string
  /** A provider's stream re-encoded by the server as it plays, at every
   *  quality from the source down (an HLS master). Absent for a stored file. */
  transcode_url?: string
  /** The same video untouched — the host's own stream, or the file as it is —
   *  when `proxy_url` is the server's re-encoding of it. Played at the
   *  source's quality and frame rate, which need no encode at all. */
  direct?: { url: string; kind: 'hls' | 'mp4' }
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

/** Change the quality and frame rate of a cast in progress without restarting
 *  it. *id* is "dlna" for the TV, else a Chromecast load's `live=` id. True when
 *  the TV was restarted anyway (it was playing the file itself): seek it back. */
export async function castLive(id: string, quality: number, fps: number): Promise<boolean> {
  const res = await fetch(`${BASE}/cast/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, quality, fps }),
  })
  if (!res.ok) throw new Error(`Could not change the cast: ${res.status}`)
  return Boolean((await res.json()).restarted)
}

/** What a video can be played at. */
export interface MediaOptions {
  /** Heights, the source's own first; empty when unknown. */
  heights: number[]
  /** Bits a second each of those needs at the source's rate. */
  bandwidths: number[]
  /** The source's own frame rate, 0 when unknown. */
  fps: number
  /** Frame rates on offer; those above `fps` are drawn by AI. */
  frame_rates: number[]
  /** The server is still fetching the AI runtime: ask again for its rates. */
  preparing?: boolean
}

const NO_OPTIONS: MediaOptions = { heights: [], bandwidths: [], fps: 0, frame_rates: [] }

/** The options for *url*; without it, for what was last sent to a DLNA TV. */
export async function mediaOptions(url?: string): Promise<MediaOptions> {
  const query = url ? `?url=${encodeURIComponent(url)}` : ''
  try {
    const res = await fetch(`${BASE}/media/options${query}`)
    return res.ok ? await res.json() : NO_OPTIONS
  } catch {
    return NO_OPTIONS
  }
}

/** What the server's machine is doing, and how far ahead it has a video ready. */
export interface MediaMetrics {
  /** CPU load, percent. */
  cpu: number
  /** Memory in use and installed, bytes. */
  memory: { used: number; total: number }
  /** Load (percent) and memory (bytes) of an NVIDIA GPU; null for any other. */
  gpu: { load: number; used: number; total: number } | null
  /** Seconds ready past the position given, at the source's rate; null when
   *  it cannot be told. For a DLNA TV, what it has been sent past it. */
  ahead: number | null
  /** The same, drawn by AI. */
  ai_ahead: number | null
  /** Seconds of the player's buffer that were sent drawn by AI. */
  client_ai: number | null
}

/** The metrics while *url* plays at *position*, the player holding *buffered*
 *  seconds past it; without *url*, the DLNA TV's. */
export async function mediaMetrics(
  url: string | undefined, position: number, buffered = 0,
): Promise<MediaMetrics | null> {
  const query = new URLSearchParams({ position: String(position), buffered: String(buffered) })
  if (url) query.set('url', url)
  try {
    const res = await fetch(`${BASE}/media/metrics?${query}`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Whether the frames at *position* of *url* were sent drawn by AI: what a
 *  Chromecast shows, which it does not say itself. */
export async function mediaAiShown(url: string, position: number): Promise<boolean> {
  const query = new URLSearchParams({ url, position: String(position) })
  try {
    const res = await fetch(`${BASE}/media/ai-shown?${query}`)
    return res.ok ? Boolean((await res.json()).shown) : false
  } catch {
    return false
  }
}

/** Tell the server where *url* plays, so it draws AI frames from just past
 *  there. `swap` when the next ones are ready: fetch them again to show them;
 *  `ready`, seconds drawn past the segment playing, one after another;
 *  `shown`, the segment playing was sent drawn — AI frames on screen. */
export async function mediaPlayhead(
  url: string, position: number,
): Promise<{ swap: boolean; ready: number; shown: boolean }> {
  const none = { swap: false, ready: 0, shown: false }
  try {
    const res = await fetch(`${BASE}/media/playhead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, position }),
    })
    return res.ok ? await res.json() : none
  } catch {
    return none
  }
}

/** The audio and caption tracks of the stored file being cast, and those
 *  playing. */
export interface CastTracks {
  audio: { index: number; label: string }[]
  subtitles: { lang: string; label: string }[]
  audio_now: number
  /** The language of the captions burnt into a TV's picture; null for none. */
  lang_now: string | null
}

/** The tracks of what a Chromecast plays (*url*, its playlist) or, without
 *  it, of what was sent to the DLNA TV. Empty for a provider's stream. */
export async function castTracks(url?: string): Promise<CastTracks> {
  const query = url ? `?url=${encodeURIComponent(url)}` : ''
  const none = { audio: [], subtitles: [], audio_now: 0, lang_now: null }
  try {
    const res = await fetch(`${BASE}/cast/tracks${query}`)
    return res.ok ? await res.json() : none
  } catch {
    return none
  }
}

/** Change a cast's audio track, or the captions burnt into a TV's picture
 *  ("" for none), in place. True when the TV was restarted for it, to be put
 *  back where it was. */
export async function castSetTracks(
  id: string, change: { audio?: number; lang?: string },
): Promise<boolean> {
  const res = await fetch(`${BASE}/cast/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...change }),
  })
  if (!res.ok) throw new Error(`Could not change the cast: ${res.status}`)
  return Boolean((await res.json()).restarted)
}

/** How a restart starts the server again: the uv command it was launched
 *  with, run again; uvx on the latest release; or the same Python. */
export type RestartWay = 'launcher' | 'uvx' | 'python'

/** How the server would restart, and the command it would run; null while it
 *  does not answer. */
export async function serverRestartWay(): Promise<{ restart: RestartWay; command: string } | null> {
  try {
    const res = await fetch(`${BASE}/server`, { cache: 'no-store' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Restart the server on newer code. It is gone for a few seconds after. */
export async function restartServer(): Promise<void> {
  const res = await fetch(`${BASE}/server/restart`, { method: 'POST' })
  if (!res.ok) throw new Error(`Could not restart: ${res.status}`)
}

/** Push a resolved proxy URL to a DLNA renderer and start playback. */
export async function dlnaPlay(
  rendererUdn: string,
  proxyUrl: string,
  title: string,
  kind: string,
  /** Burnt into the picture when this is a stored file with a track in it. */
  subtitleLang?: string | null,
  /** A lighter height for a stored file, re-encoded down to it; 0 for the best. */
  quality = 0,
  /** A frame rate, 0 for the source's own. */
  fps = 0,
): Promise<void> {
  const res = await fetch(`${BASE}/cast/dlna/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      renderer_udn: rendererUdn, proxy_url: proxyUrl, title, kind, subtitle_lang: subtitleLang ?? null,
      quality,
      fps,
    }),
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

/** How one site fared for a search: a slow site is cut off as `timeout`. */
export interface SourceReport {
  id: string
  name: string
  status: 'ok' | 'empty' | 'failed' | 'timeout'
  count: number
  ms: number
}

export interface SearchResponse {
  cards: SeasonCard[]
  sources: SourceReport[]
}

async function searchAll(q: string, sites: string[] = []): Promise<SearchResponse> {
  const only = sites.length ? `&sites=${encodeURIComponent(sites.join(','))}` : ''
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}${only}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}

export async function searchSeasons(q: string): Promise<SeasonCard[]> {
  return (await searchAll(q)).cards
}

// Session-scoped, so returning to a search (browser back from a title) restores
// instantly, and the search bar and the source picker never scrape twice.
const searchCache = new Map<string, SearchResponse>()

/** A search already answered this session, if any. */
export function cachedSearch(q: string): SeasonCard[] | undefined {
  return searchCache.get(q)?.cards
}

export async function searchSeasonsCached(q: string): Promise<SeasonCard[]> {
  const hit = searchCache.get(q)
  if (hit) return hit.cards
  const results = await searchAll(q)
  searchCache.set(q, results)
  return results.cards
}

/** How each source fared for a search already answered this session. */
export function cachedSearchSources(q: string): SourceReport[] {
  return searchCache.get(q)?.sources ?? []
}

/** Search `sites` again for `q` and fold their fresh answer into the cached
 *  one, replacing what they returned before. Sites that fail again stay failed. */
export async function retrySearchSources(q: string, sites: string[]): Promise<SearchResponse> {
  const before = searchCache.get(q) ?? { cards: [], sources: [] }
  let fresh: SearchResponse
  try {
    fresh = await searchAll(q, sites)
  } catch {
    return before
  }
  const redone = new Set(fresh.sources.map(s => s.id))
  const merged: SearchResponse = {
    cards: [...before.cards.filter(c => !c.source || !redone.has(c.source)), ...fresh.cards],
    sources: before.sources.map(s => fresh.sources.find(f => f.id === s.id) ?? s),
  }
  searchCache.set(q, merged)
  return merged
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

/** Where the AI frame interpolation setup is, and what it found. */
export interface AiSetup {
  enabled: boolean
  /** "idle" before it ever ran; "starting", "runtime", "model" or "measure"
   *  while it runs; then "ready" or "failed". */
  step: string
  /** 0..1 where the step can tell (the model download), else null. */
  progress: number | null
  error: string | null
  /** The NVIDIA GPU's name; null without one (another GPU may still serve). */
  nvidia_gpu: string | null
  /** The ONNX Runtime loaded, e.g. "onnxruntime 1.22.0"; null before. */
  runtime: string | null
  /** Execution providers of the session, the one in use first. */
  providers: string[]
  /** Frames drawn a second at 720p; null until measured. */
  speed: number | null
}

export async function getAiSetup(): Promise<AiSetup> {
  const res = await fetch(`${BASE}/settings/ai`)
  if (!res.ok) throw new Error('AI status fetch failed')
  return res.json()
}

/** Run the AI setup again, from scratch. */
export async function runAiSetup(): Promise<AiSetup> {
  const res = await fetch(`${BASE}/settings/ai/setup`, { method: 'POST' })
  if (!res.ok) throw new Error('AI setup failed to start')
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
 * `audioIndex` asks for the copy the server builds around one audio track. No
 * browser can choose a track itself, so a track other than the first always
 * needs one; the first needs one only when its codec would not play (AC-3 in a
 * rip). Left out, the original file is served as it is. A copy that has to be
 * re-encoded takes minutes, and the file route waits for it.
 */
export function downloadedFileUrl(path: string, audioIndex?: number): string {
  const base = `${BASE}/downloaded/file?path=${encodeURIComponent(path)}`
  return audioIndex !== undefined ? `${base}&audio=${audioIndex}` : base
}

/** Master playlist for a downloaded file, transcoded segment by segment as it
 *  plays, at every quality from the source down. `kind: 'hls'` — the player
 *  already speaks it, because every streaming host serves HLS too. `audioIndex`
 *  picks the track to encode into the segments, so switching one costs nothing
 *  but a new playlist. */
export function downloadedHlsUrl(path: string, audioIndex = 0): string {
  return `${BASE}/downloaded/hls?path=${encodeURIComponent(path)}&audio=${audioIndex}`
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
  /** A browser plays the file as it is, its first voice included. */
  playable?: boolean
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
