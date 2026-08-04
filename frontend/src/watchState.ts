import { useSyncExternalStore } from 'react'
import { batchLibrary, deleteWatchEntry, putWatchEntry } from './api'
import type { PlayableEpisode } from './providers'

// Watch-state store: continue-watching positions and watched flags, persisted
// in localStorage. Kept behind this small module so it can later be swapped
// for a server-backed store (cross-device sync) without touching callers.

const STORAGE_KEY = 'sestudio.watch.v1'

/** Fraction of the duration at which an episode counts as watched. */
export const WATCHED_THRESHOLD = 0.9
/** Ignore positions below this (seconds) — accidental opens aren't progress. */
const MIN_POSITION = 30

export interface WatchEntry {
  series: string
  season: number
  number: number
  title: string
  poster_url: string
  page_url: string
  lang: string
  position: number
  duration: number
  watched: boolean
  updatedAt: number
  /**
   * Highest episode number in the season, when known. Lets `watching()` tell a
   * finished season from one with episodes left. For a normal 1..N season this
   * is also the episode count, which is what the UI shows as "4 of 20 watched".
   */
  seasonEpisodes?: number
  /**
   * Set when the user dismissed this series from Watching. A watermark rather
   * than a flag: later playback bumps `updatedAt` past it, so the series comes
   * back on its own without anything having to clear this.
   */
  dismissedAt?: number
  /**
   * Set when the user explicitly un-watched this episode. Honoured until
   * playback drops back below WATCHED_THRESHOLD — without it the next progress
   * tick would sit above the threshold and immediately re-mark the episode,
   * undoing the action.
   */
  watchedCleared?: boolean
}

export function watchKey(series: string, season: number, number: number): string {
  return `${series}|S${season}|E${number}`
}

function keyOf(ep: PlayableEpisode): string {
  return watchKey(ep.series_name, ep.season, ep.number)
}

type Store = Record<string, WatchEntry>

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {} // corrupt or unavailable storage degrades to empty
  }
}

let store: Store = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // quota/unavailable — keep the in-memory state working
  }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: re-renders when any watch-state changes. */
export function useWatchState(): Store {
  return useSyncExternalStore(subscribe, () => store)
}

export function getProgress(ep: PlayableEpisode): WatchEntry | undefined {
  return store[keyOf(ep)]
}

/** The identity fields every write carries, so the two writers can't drift. */
function identity(ep: PlayableEpisode, prev?: WatchEntry) {
  return {
    series: ep.series_name,
    season: ep.season,
    number: ep.number,
    title: ep.title,
    poster_url: ep.poster_url,
    page_url: ep.page_url,
    lang: ep.lang,
    // A caller without the playlist to hand shouldn't erase what we already know.
    seasonEpisodes: ep.seasonEpisodes ?? prev?.seasonEpisodes,
    dismissedAt: prev?.dismissedAt,
  }
}

function commit(key: string, entry: WatchEntry): void {
  store = { ...store, [key]: entry }
  persist()
  void putWatchEntry(key, entry).catch(() => {})
}

/**
 * Record playback progress for an episode. Positions under MIN_POSITION are
 * ignored; crossing WATCHED_THRESHOLD marks the episode watched, unless the user
 * has explicitly un-watched it and playback hasn't returned below the threshold.
 */
export function saveProgress(ep: PlayableEpisode, position: number, duration: number): void {
  if (!isFinite(position) || position < MIN_POSITION) return
  const key = keyOf(ep)
  const prev = store[key]
  const atEnd = duration > 0 && position / duration >= WATCHED_THRESHOLD
  // Hold an explicit un-watch while playback is still past the threshold; once
  // it drops below, normal auto-marking resumes.
  const holdCleared = (prev?.watchedCleared ?? false) && atEnd
  commit(key, {
    ...identity(ep, prev),
    position,
    duration,
    watched: holdCleared ? false : (prev?.watched ?? false) || atEnd,
    watchedCleared: holdCleared || undefined,
    updatedAt: Date.now(),
  })
}

/**
 * Mark an episode watched or un-watched. Un-watching rewinds to the start, since
 * the point of it is to offer the episode up again.
 */
export function setWatched(ep: PlayableEpisode, watched: boolean): void {
  const key = keyOf(ep)
  const prev = store[key]
  const duration = prev?.duration ?? 0
  commit(key, {
    ...identity(ep, prev),
    position: watched ? duration : 0,
    duration,
    watched,
    watchedCleared: watched ? undefined : true,
    updatedAt: Date.now(),
  })
}

/**
 * Drop a series from the Watching list until there's new activity on it. The
 * timestamp is compared against the series' newest `updatedAt`, so any later
 * playback brings it back.
 */
export function dismissSeries(series: string, season: number): void {
  const now = Date.now()
  for (const [key, entry] of Object.entries(store)) {
    if (entry.series !== series || entry.season !== season) continue
    // updatedAt is deliberately preserved — bumping it would out-date the
    // watermark on the spot and the series would never actually leave.
    commit(key, { ...entry, dismissedAt: now })
  }
}

export function removeEntry(entry: WatchEntry): void {
  const key = watchKey(entry.series, entry.season, entry.number)
  const next = { ...store }
  delete next[key]
  store = next
  persist()
  void deleteWatchEntry(key).catch(() => {})
}

/** Replace the whole store from a server snapshot (startup hydration, #24). */
export function hydrateWatch(snapshot: Store): void {
  store = snapshot
  persist()
}

/**
 * Dismiss several series at once, in one request (#26). Same watermark semantics
 * as `dismissSeries`, so bulk and single removal mean exactly the same thing.
 */
export async function dismissMany(series: { series: string; season: number }[]): Promise<void> {
  if (!series.length) return
  const wanted = new Set(series.map(s => `${s.series}|S${s.season}`))
  const now = Date.now()
  const previous = store

  const next = { ...store }
  const writes: { key: string; entry: WatchEntry }[] = []
  for (const [key, entry] of Object.entries(store)) {
    if (!wanted.has(`${entry.series}|S${entry.season}`)) continue
    const updated = { ...entry, dismissedAt: now }
    next[key] = updated
    writes.push({ key, entry: updated })
  }
  store = next
  persist()

  try {
    await batchLibrary({ watch_put: writes })
  } catch (err) {
    store = previous
    persist()
    throw err
  }
}

/** Forget several series entirely — history included. */
export async function forgetMany(series: { series: string; season: number }[]): Promise<void> {
  if (!series.length) return
  const wanted = new Set(series.map(s => `${s.series}|S${s.season}`))
  const previous = store

  const next = { ...store }
  const keys: string[] = []
  for (const [key, entry] of Object.entries(store)) {
    if (!wanted.has(`${entry.series}|S${entry.season}`)) continue
    delete next[key]
    keys.push(key)
  }
  store = next
  persist()

  try {
    await batchLibrary({ watch_delete: keys })
  } catch (err) {
    store = previous
    persist()
    throw err
  }
}

/** One series (or film) the user is working through. Derived, never stored. */
export interface WatchingItem {
  series: string
  season: number
  poster_url: string
  page_url: string
  lang: string
  /** The episode to resume or start next. `title` is empty for a fresh episode,
   *  whose name isn't known until the season is opened. */
  resume: { number: number; title: string; position: number; duration: number }
  /** True when `resume` is an episode not yet started, rather than a partial one. */
  isNextUp: boolean
  /** Episodes of this series marked watched, for the "4 of 20 watched" line. */
  watchedCount: number
  /** Season length when known, the denominator of that same line. */
  seasonEpisodes?: number
  updatedAt: number
}

/**
 * The Watching list: one entry per series, resolved to whatever the user should
 * play next. Replaces the old continueWatching/nextUp split, which showed the
 * same series twice and duplicated a poster per in-progress episode.
 *
 * Per series, looking only at the most recently touched episode:
 *   dismissed (updatedAt <= dismissedAt) → omitted
 *   not watched                          → resume it
 *   watched, and a next episode exists   → offer the next one (isNextUp)
 *   watched, season finished or a film    → omitted
 *
 * "A next episode exists" is unknowable without `seasonEpisodes`, so when it is
 * absent we offer the next number anyway — the old behaviour, now the fallback
 * rather than the rule.
 */
export function watching(state: Store = store): WatchingItem[] {
  const groups = new Map<string, WatchEntry[]>()
  for (const entry of Object.values(state)) {
    const key = `${entry.series}|S${entry.season}`
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }

  const items: WatchingItem[] = []
  for (const entries of groups.values()) {
    const latest = entries.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    const dismissedAt = Math.max(0, ...entries.map(e => e.dismissedAt ?? 0))
    if (latest.updatedAt <= dismissedAt) continue

    const common = {
      series: latest.series,
      season: latest.season,
      poster_url: latest.poster_url,
      page_url: latest.page_url,
      lang: latest.lang,
      watchedCount: entries.filter(e => e.watched).length,
      seasonEpisodes: latest.seasonEpisodes,
      updatedAt: latest.updatedAt,
    }

    if (!latest.watched) {
      items.push({
        ...common,
        resume: {
          number: latest.number,
          title: latest.title,
          position: latest.position,
          duration: latest.duration,
        },
        isNextUp: false,
      })
      continue
    }

    if (latest.season === 0) continue // a film has no next episode
    const next = latest.number + 1
    if (latest.seasonEpisodes !== undefined && next > latest.seasonEpisodes) continue
    items.push({
      ...common,
      resume: { number: next, title: '', position: 0, duration: 0 },
      isNextUp: true,
    })
  }

  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}
