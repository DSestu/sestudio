import type { Filters, Join } from './proximity'

// The server's proximity and set-builder endpoints (src/sestudio/music/proximity.py,
// builder.py). Screens that already hold the tracks' analyses can rank locally with
// proximity.ts instead; these rank over the whole library (or a `pool` of ids).

/** Mood arc -3..3, energy arc 0..1: evenly spaced points over the set; genre: segments ending at x1 (0..1). */
export interface Arc {
  energy: number[]
  mood: number[]
  genre: { g: string; x1: number }[]
}

export interface BuiltSet {
  /** `join` is from the previous slot; null for the first. */
  slots: { id: string; join: Join | null }[]
  duration: number
  genreChanges: number
  clashes: number
  tempoJumps: number
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/music/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `HTTP ${res.status}`)
  return res.json()
}

export const fetchFitsAfter = (track: string, o: { filters?: Filters; pool?: string[]; exclude?: string[]; limit?: number } = {}) =>
  post<{ track: string; results: { id: string; join: Join }[] }>('proximity/fits-after', { track, ...o })

export const fetchBridges = (a: string, b: string, o: { pool?: string[]; exclude?: string[]; limit?: number } = {}) =>
  post<{ results: { id: string; before: Join; after: Join }[] }>('proximity/bridges', { a, b, ...o })

/** `path` is the in-between ids, [] when a to b is already safe, null when no path exists. */
export const fetchBridgePath = (a: string, b: string, o: { steps?: number; pool?: string[]; exclude?: string[] } = {}) =>
  post<{ path: string[] | null }>('proximity/bridge-path', { a, b, ...o })

export const fetchJoin = async (a: string, b: string): Promise<Join> =>
  (await fetch(`/api/music/proximity/join?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)).json()

export const fetchPresets = async (): Promise<Record<string, Arc>> => (await fetch('/api/music/set/presets')).json()

/** Give `arc` or the name of a `preset`; `length` is in seconds; a new `seed` is "Try another". */
export const buildSet = (o: { arc?: Arc; preset?: string; length: number; seed?: number; start?: string; pool?: string[]; skip?: string[] }) =>
  post<BuiltSet>('set/build', o)
