export interface SeasonCard {
  newsid: string
  title: string
  series_name: string
  season_number: number
  poster_url: string
  page_url: string
  is_film: boolean
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

export interface AppSettings {
  output_root: string
  lang: string
}

export interface DownloadItem {
  embed_url: string
  provider: string
  episode_name: string
  series_name: string
  season: number
  all_providers: Record<string, string>
}

export interface DownloadJob {
  id: string
  episode_name: string
  status: 'queued' | 'downloading' | 'done' | 'failed' | 'skipped' | 'cancelled'
  progress: number
  speed: string
  eta: string
  error: string | null
}

const BASE = '/api'

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
    if (data.status === 'done' || data.status === 'failed') {
      es.close()
      onDone()
    }
  }
  es.onerror = () => { es.close(); onDone() }
  return () => es.close()
}
