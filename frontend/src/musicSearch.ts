import { useEffect, useState } from 'react'
import { postDownloads } from './api'
import type { MusicTrack } from './musicLibrary'
import type { AddPayload } from './musicQueue'

// One music search across the libraries and the online sources (SPEC-music §13.4).
// The add panel's YouTube Music / SoundCloud tabs reuse searchMusic and the rows.

export type SearchSource = 'all' | 'library' | 'ytmusic' | 'youtube' | 'soundcloud'

export const SEARCH_SOURCES: { id: SearchSource; label: string }[] = [
  { id: 'all', label: 'Everywhere' },
  { id: 'library', label: 'Your libraries' },
  { id: 'ytmusic', label: 'YouTube Music' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'soundcloud', label: 'SoundCloud' },
]

export const sourceLabel = (source: string) =>
  SEARCH_SOURCES.find(s => s.id === source)?.label ?? source

/** An online hit, already shaped like a queue item. */
export interface OnlineHit {
  library: 'online'
  source: string
  track_id: string
  title: string
  artist: string
  duration: number
  kind: 'track' | 'video' | 'album' | 'playlist'
  thumb: string
  /** The page yt-dlp reads it from, for saving it. */
  url: string
}

export interface LibraryHit {
  library: string
  track_id: string
}

export type TopMatch =
  | { kind: 'artist'; name: string; thumb: string; tracks: (OnlineHit | LibraryHit)[] }
  | ({ kind: 'track' } & Partial<OnlineHit> & LibraryHit)

export interface SearchResponse {
  top: TopMatch | null
  library: LibraryHit[]
  online: OnlineHit[]
  /** Why a source gave nothing (timed out, blocked). */
  errors: Record<string, string>
}

export async function searchMusic(query: string, source: SearchSource = 'all', signal?: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(`/api/music/search?${new URLSearchParams({ q: query, source })}`, { signal })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `search: ${res.status}`)
  return res.json()
}

export interface Grouped {
  library: MusicTrack[]
  online: OnlineHit[]
  /** Hits per source, for the chips. */
  counts: Record<string, number>
}

/** The response as the results view shows it: library hits as the Music tab's own
 *  tracks (the ones that vanished from disk dropped), online hits without repeats. */
export function groupResults(res: SearchResponse, byId: Map<string, MusicTrack>): Grouped {
  const library = res.library.map(h => byId.get(h.track_id)).filter((t): t is MusicTrack => !!t)
  const seen = new Set<string>()
  const online = res.online.filter(h => !seen.has(h.track_id) && seen.add(h.track_id))
  const counts: Record<string, number> = { library: library.length }
  for (const h of online) counts[h.source] = (counts[h.source] ?? 0) + 1
  return { library, online, counts }
}

/** The results for a query once typing pauses; `undefined` while it is on its way. */
export function useMusicSearch(query: string, source: SearchSource, delay = 350) {
  const [state, setState] = useState<{ key: string; res?: SearchResponse; error?: string }>()
  const q = query.trim()
  const key = `${source}\0${q}`
  useEffect(() => {
    if (!q) return
    const ctl = new AbortController()
    const timer = window.setTimeout(() => {
      searchMusic(q, source, ctl.signal).then(
        res => setState({ key, res }),
        (e: Error) => { if (!ctl.signal.aborted) setState({ key, error: e.message }) },
      )
    }, delay)
    return () => { ctl.abort(); window.clearTimeout(timer) }
  }, [q, source, key, delay])
  return state?.key === key ? state : undefined
}

/** What the queue takes for an online hit. */
export const hitPayload = (h: OnlineHit): AddPayload['tracks'][number] => ({
  library: h.library, track_id: h.track_id, source: h.source, title: h.title, artist: h.artist, duration: h.duration,
})

/** Keep only the sound of a hit, as a music track in the local library. */
export async function saveHit(h: OnlineHit): Promise<void> {
  await postDownloads([{
    embed_url: h.url,
    provider: 'youtube',
    episode_name: h.artist ? `${h.artist} - ${h.title}` : h.title,
    series_name: h.artist || 'Music',
    season: 0,
    lang: '',
    all_providers: { youtube: h.url },
    source: 'youtube',
    poster_url: h.thumb,
    page_url: h.url,
    audio_only: true,
  }])
}
