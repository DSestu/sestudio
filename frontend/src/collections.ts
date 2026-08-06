import { useSyncExternalStore } from 'react'
import { batchLibrary, deleteCollectionEntry, putCollectionEntry } from './api'

// Saved lists: "watchlist" (want to watch) and "favourites" (loved). Both hold
// whole titles only — an individual episode carries no "I want to watch this"
// intent, so starring one just filled the list with noise (#26). Films are a
// season of 0. Persisted server-side, with localStorage as the offline cache.

const STORAGE_KEY = 'sestudio.collections.v2'
/** Pre-#26 cache, which could hold episode-level entries. Folded once, then dropped. */
const LEGACY_STORAGE_KEY = 'sestudio.collections.v1'

export type ListName = 'watchlist' | 'favourites'

/** Identifies a saved title. */
export interface CollectionRef {
  series: string
  season: number
}

export interface CollectionEntry extends CollectionRef {
  /** Display label — the series or film name. */
  label: string
  poster_url: string
  page_url: string
  lang: string
  /** Id of the content site page_url belongs to; absent means 'fstream'. */
  source?: string
  addedAt: number
}

type Store = Record<ListName, Record<string, CollectionEntry>>

const EMPTY: Store = { watchlist: {}, favourites: {} }

export function refKey(ref: CollectionRef): string {
  return `${ref.series}|S${ref.season}`
}

/** An entry as stored before #26, when a list could hold single episodes. */
type LegacyEntry = CollectionEntry & { kind?: string; number?: number }

export interface FoldResult {
  entries: Record<string, CollectionEntry>
  /** Episode-level keys now superseded by a title entry, safe to delete. */
  staleKeys: string[]
}

/**
 * Collapse a stored list to title-level keys (#26).
 *
 * An episode entry becomes its series/season entry, deduped. A real title entry
 * wins outright over folded ones; between folded siblings the earliest `addedAt`
 * wins, since that is when the show was first wanted.
 *
 * Idempotent: a list that is already title-only comes back unchanged with no
 * stale keys, so this is safe to run on every load.
 */
export function foldToTitles(raw: Record<string, LegacyEntry>): FoldResult {
  const entries: Record<string, CollectionEntry> = {}
  const fromTitleEntry = new Set<string>()
  const staleKeys: string[] = []

  for (const [key, entry] of Object.entries(raw)) {
    const titleKey = refKey(entry)
    const isTitleLevel = key === titleKey
    if (!isTitleLevel) staleKeys.push(key)

    const folded: CollectionEntry = {
      series: entry.series,
      season: entry.season,
      // A folded episode's label was the episode title, which is wrong for a list of shows.
      label: isTitleLevel ? entry.label : entry.series,
      poster_url: entry.poster_url,
      page_url: entry.page_url,
      lang: entry.lang,
      addedAt: entry.addedAt,
    }

    const prev = entries[titleKey]
    if (!prev || isTitleLevel) {
      entries[titleKey] = folded
      if (isTitleLevel) fromTitleEntry.add(titleKey)
    } else if (!fromTitleEntry.has(titleKey) && folded.addedAt < prev.addedAt) {
      entries[titleKey] = folded
    }
  }

  return { entries, staleKeys }
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>
      return { watchlist: parsed.watchlist ?? {}, favourites: parsed.favourites ?? {} }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacy) return { ...EMPTY }
    // One-time upgrade of the pre-#26 cache, so a stale v1 can't reintroduce
    // episode-level entries after this session writes v2.
    const parsed = JSON.parse(legacy) as Partial<Record<ListName, Record<string, LegacyEntry>>>
    const upgraded: Store = {
      watchlist: foldToTitles(parsed.watchlist ?? {}).entries,
      favourites: foldToTitles(parsed.favourites ?? {}).entries,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return upgraded
  } catch {
    return { ...EMPTY } // corrupt or unavailable storage degrades to empty
  }
}

let store: Store = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // quota/unavailable — keep working in memory
  }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: re-renders when any saved list changes. */
export function useCollections(): Store {
  return useSyncExternalStore(subscribe, () => store)
}

export function isSaved(list: ListName, ref: CollectionRef, state: Store = store): boolean {
  return refKey(ref) in state[list]
}

export function save(list: ListName, entry: Omit<CollectionEntry, 'addedAt'>): void {
  const key = refKey(entry)
  store = {
    ...store,
    [list]: { ...store[list], [key]: { ...entry, addedAt: Date.now() } },
  }
  persist()
  void putCollectionEntry(list, key, store[list][key]).catch(() => {})
}

export function unsave(list: ListName, ref: CollectionRef): void {
  const key = refKey(ref)
  const next = { ...store[list] }
  delete next[key]
  store = { ...store, [list]: next }
  persist()
  void deleteCollectionEntry(list, key).catch(() => {})
}

/** Replace the whole store from a server snapshot (startup hydration, #24). */
export function hydrateCollections(snapshot: Store): void {
  store = { watchlist: snapshot.watchlist ?? {}, favourites: snapshot.favourites ?? {} }
  persist()
}

/**
 * Remove several entries at once, in one request (#26). Applies optimistically
 * and reverts the whole store if the server rejects it, since a half-applied
 * bulk removal is worse than none.
 */
export async function unsaveMany(list: ListName, keys: string[]): Promise<void> {
  if (!keys.length) return
  const previous = store
  const next = { ...store[list] }
  for (const key of keys) delete next[key]
  store = { ...store, [list]: next }
  persist()
  try {
    await batchLibrary({ collections_delete: keys.map(key => ({ list, key })) })
  } catch (err) {
    store = previous
    persist()
    throw err
  }
}

/** Move several entries between lists in one transaction, so it can't half-apply. */
export async function moveMany(from: ListName, to: ListName, keys: string[]): Promise<void> {
  if (!keys.length) return
  const previous = store
  const moving = keys.map(key => store[from][key]).filter(Boolean)
  const fromNext = { ...store[from] }
  for (const key of keys) delete fromNext[key]
  const toNext = { ...store[to] }
  for (const entry of moving) toNext[refKey(entry)] = entry
  store = { ...store, [from]: fromNext, [to]: toNext }
  persist()
  try {
    await batchLibrary({
      collections_delete: keys.map(key => ({ list: from, key })),
      collections_put: moving.map(entry => ({ list: to, key: refKey(entry), entry })),
    })
  } catch (err) {
    store = previous
    persist()
    throw err
  }
}

/** Add or remove, depending on whether it's already saved. */
export function toggle(list: ListName, entry: Omit<CollectionEntry, 'addedAt'>): void {
  if (isSaved(list, entry)) unsave(list, entry)
  else save(list, entry)
}

/** Saved entries, most recently added first. */
export function entries(list: ListName, state: Store = store): CollectionEntry[] {
  return Object.values(state[list]).sort((a, b) => b.addedAt - a.addedAt)
}
