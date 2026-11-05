import { useEffect, useMemo, useState } from 'react'
import { postDownloads } from './api'
import type { MusicTrack } from './musicLibrary'
import type { AddPayload } from './musicQueue'
import type { Summary } from './musicMeta'
import { moodOf } from './harmony'

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
  artist?: string
}

export type TopMatch =
  | { kind: 'artist'; name: string; thumb: string; tracks: (OnlineHit | LibraryHit)[] }
  | ({ kind: 'track' } & Partial<Omit<OnlineHit, 'library'>> & LibraryHit)

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

/** What one source answered, or why its request failed. */
export interface Part { res?: SearchResponse; error?: string }

/** "Everywhere" asks each source on its own, so a fast one shows before a slow one. */
export const partsOf = (source: SearchSource): SearchSource[] =>
  source === 'all' ? ['library', 'ytmusic', 'youtube', 'soundcloud'] : [source]

/** The best single answer: an artist whose name holds every word of the query and
 *  who has at least two tracks in the results, else the first track (as search._top). */
export function topMatch(query: string, library: LibraryHit[], online: OnlineHit[]): TopMatch | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const byArtist = new Map<string, (OnlineHit | LibraryHit)[]>()
  for (const t of [...library, ...online]) {
    const name = (t.artist ?? '').trim()
    if (name && words.every(w => name.toLowerCase().includes(w))) byArtist.set(name, [...(byArtist.get(name) ?? []), t])
  }
  let best: [string, (OnlineHit | LibraryHit)[]] | undefined
  for (const e of byArtist) if (!best || e[1].length > best[1].length) best = e
  if (best && best[1].length >= 2) {
    const thumb = best[1].map(t => ('thumb' in t ? t.thumb : '')).find(Boolean) ?? ''
    return { kind: 'artist', name: best[0], thumb, tracks: best[1] }
  }
  const first = library[0] ?? online[0]
  return first ? { kind: 'track', ...first } : null
}

/** The answers so far as one response, online hits interleaved so no source buries another. */
export function mergeResults(query: string, sources: SearchSource[], parts: Record<string, Part>): SearchResponse {
  const library = parts.library?.res?.library ?? []
  const lists = sources.map(s => parts[s]?.res?.online ?? [])
  const longest = Math.max(0, ...lists.map(l => l.length))
  const online = Array.from({ length: longest }, (_, i) => lists.flatMap(l => (i < l.length ? [l[i]] : []))).flat()
  const errors: Record<string, string> = {}
  for (const s of sources) {
    Object.assign(errors, parts[s]?.res?.errors)
    const failed = parts[s]?.error
    if (failed) errors[s] = failed
  }
  return { top: topMatch(query, library, online), library, online, errors }
}

/** The results for a query once typing pauses, updated as each source answers;
 *  `undefined` until the first one does. `pending` lists the sources still on their way. */
export function useMusicSearch(query: string, source: SearchSource, delay = 350) {
  const [state, setState] = useState<{ key: string; parts: Record<string, Part> }>()
  const q = query.trim()
  const key = `${source}\0${q}`
  useEffect(() => {
    if (!q) return
    const ctl = new AbortController()
    const settle = (s: string, part: Part) => {
      if (!ctl.signal.aborted) setState(prev => ({ key, parts: { ...(prev?.key === key ? prev.parts : {}), [s]: part } }))
    }
    const timer = window.setTimeout(() => {
      for (const s of partsOf(source)) {
        searchMusic(q, s, ctl.signal).then(res => settle(s, { res }), (e: Error) => settle(s, { error: e.message }))
      }
    }, delay)
    return () => { ctl.abort(); window.clearTimeout(timer) }
  }, [q, source, key, delay])
  return useMemo(() => {
    if (state?.key !== key) return undefined
    const sources = partsOf(source)
    return { res: mergeResults(q, sources, state.parts), pending: sources.filter(s => !state.parts[s]) }
  }, [state, key, q, source])
}

/** The words a track answers to besides its title: key, tonic, mode, mood, energy level and genre. */
function analysisTokens(s: Summary): string[] {
  const r = s.harmony?.track
  const mode = r?.mode.toLowerCase() ?? ''
  return [s.key, s.camelot, r?.tonic, mode, moodOf(r?.mode)?.word, s.energyLevel, s.genre].flatMap(x => x?.toLowerCase().split(/\s+/) ?? [])
}

/** Whether each query word is in the haystack (title, artist, album), a prefix of an analysis word
 *  ("dark", "dors", "g minor", "intense", "dubstep"), or a tempo within 2 BPM ("150"). */
export function matchWords(words: string[], hay: string, s?: Summary): boolean {
  const tokens = s ? analysisTokens(s) : []
  return words.every(w =>
    hay.includes(w) || tokens.some(t => t.startsWith(w)) || (!!s?.bpm && /^\d{2,3}$/.test(w) && Math.abs(s.bpm - +w) <= 2))
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
