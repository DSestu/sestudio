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
  /** Id of the content site the episode came from; absent means 'fstream'. */
  source?: string
  /** Highest episode number in the season, when the playlist is known. Recorded
   *  onto watch state so the library can tell a finished season from an ongoing one. */
  seasonEpisodes?: number
}

// Fallback preference order, mirroring the backend's default. The season
// response carries the owning site's own order; prefer that when present.
const ORDER = ['uqload', 'vidzy', 'premium', 'netu', 'luluvid', 'filmoon', 'voe']

/** The downloaded copy, offered as a host alongside the scraped ones. It is
 *  never in `ORDER`: it comes from disk, not from a site's embeds. */
export const DOWNLOADED_PROVIDER = 'downloaded'

/** Sort a provider list into preference order (known providers first). */
export function orderProviders(list: string[], order?: string[]): string[] {
  const pref = order?.length ? order : ORDER
  const known = pref.filter(p => list.includes(p))
  return [...known, ...list.filter(p => !pref.includes(p))]
}
