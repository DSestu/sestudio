export interface SeasonCard {
  newsid: string
  title: string
  series_name: string
  season_number: number
  poster_url: string
  page_url: string
  is_film: boolean
  is_anime: boolean
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
