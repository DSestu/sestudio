import { useSyncExternalStore } from 'react'
import { deleteWatchEntry, putWatchEntry } from './api'
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

/**
 * Record playback progress for an episode. Positions under MIN_POSITION are
 * ignored; crossing WATCHED_THRESHOLD marks the episode watched (sticky).
 */
export function saveProgress(ep: PlayableEpisode, position: number, duration: number): void {
  if (!isFinite(position) || position < MIN_POSITION) return
  const key = keyOf(ep)
  const prev = store[key]
  const watched = (prev?.watched ?? false) || (duration > 0 && position / duration >= WATCHED_THRESHOLD)
  store = {
    ...store,
    [key]: {
      series: ep.series_name,
      season: ep.season,
      number: ep.number,
      title: ep.title,
      poster_url: ep.poster_url,
      page_url: ep.page_url,
      lang: ep.lang,
      position,
      duration,
      watched,
      updatedAt: Date.now(),
    },
  }
  persist()
  void putWatchEntry(key, store[key]).catch(() => {})
}

export function markWatched(ep: PlayableEpisode): void {
  const key = keyOf(ep)
  const prev = store[key]
  store = {
    ...store,
    [key]: {
      series: ep.series_name,
      season: ep.season,
      number: ep.number,
      title: ep.title,
      poster_url: ep.poster_url,
      page_url: ep.page_url,
      lang: ep.lang,
      position: prev?.duration ?? 0,
      duration: prev?.duration ?? 0,
      watched: true,
      updatedAt: Date.now(),
    },
  }
  persist()
  void putWatchEntry(key, store[key]).catch(() => {})
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

/** In-progress entries (not watched), most recent first. */
export function continueWatching(state: Store = store): WatchEntry[] {
  return Object.values(state)
    .filter(e => !e.watched)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export interface NextUpSuggestion {
  series: string
  season: number
  /** The next episode number to watch (last watched + 1). */
  nextNumber: number
  poster_url: string
  page_url: string
  lang: string
  updatedAt: number
}

/**
 * Per series: if the most recently touched episode is watched, suggest the
 * next episode number. (Whether it exists is resolved when the season opens.)
 */
export function nextUp(state: Store = store): NextUpSuggestion[] {
  const latestBySeries = new Map<string, WatchEntry>()
  for (const e of Object.values(state)) {
    const cur = latestBySeries.get(e.series)
    if (!cur || e.updatedAt > cur.updatedAt) latestBySeries.set(e.series, e)
  }
  return [...latestBySeries.values()]
    .filter(e => e.watched && e.season > 0) // films have no "next episode"
    .map(e => ({
      series: e.series,
      season: e.season,
      nextNumber: e.number + 1,
      poster_url: e.poster_url,
      page_url: e.page_url,
      lang: e.lang,
      updatedAt: e.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
