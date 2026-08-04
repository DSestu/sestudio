export type ProviderStatus = 'idle' | 'loading' | 'ok' | 'failed'

export interface PlayableEpisode {
  number: number
  title: string
  embed_urls: Record<string, string>
  // Identity — keys the watch-state store and lets the library reopen the title.
  series_name: string
  /** Season number; 0 for films. */
  season: number
  poster_url: string
  page_url: string
  lang: string
  /** Highest episode number in the season, when the playlist is known. Recorded
   *  onto watch state so the library can tell a finished season from an ongoing one. */
  seasonEpisodes?: number
}

// Preferred order, mirroring the backend resolve fallback.
const ORDER = ['uqload', 'vidzy', 'premium', 'netu', 'luluvid', 'voe']

/** Sort a provider list into preference order (known providers first). */
export function orderProviders(list: string[]): string[] {
  const known = ORDER.filter(p => list.includes(p))
  return [...known, ...list.filter(p => !ORDER.includes(p))]
}
