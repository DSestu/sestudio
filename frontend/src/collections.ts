import { useSyncExternalStore } from 'react'

// Saved lists: "watchlist" (want to watch) and "favourites" (loved). Both can
// hold whole titles or individual episodes. Stored locally, same as watch
// state, behind a small interface so it can move server-side later.

const STORAGE_KEY = 'sestudio.collections.v1'

export type ListName = 'watchlist' | 'favourites'
export type EntryKind = 'title' | 'episode'

/** Identifies a saved item; `number` is present for episodes only. */
export interface CollectionRef {
  series: string
  season: number
  number?: number
}

export interface CollectionEntry extends CollectionRef {
  kind: EntryKind
  /** Display label — series name for titles, episode title for episodes. */
  label: string
  poster_url: string
  page_url: string
  lang: string
  addedAt: number
}

type Store = Record<ListName, Record<string, CollectionEntry>>

const EMPTY: Store = { watchlist: {}, favourites: {} }

export function refKey(ref: CollectionRef): string {
  const base = `${ref.series}|S${ref.season}`
  return ref.number === undefined ? base : `${base}|E${ref.number}`
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw) as Partial<Store>
    return { watchlist: parsed.watchlist ?? {}, favourites: parsed.favourites ?? {} }
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
  store = {
    ...store,
    [list]: { ...store[list], [refKey(entry)]: { ...entry, addedAt: Date.now() } },
  }
  persist()
}

export function unsave(list: ListName, ref: CollectionRef): void {
  const next = { ...store[list] }
  delete next[refKey(ref)]
  store = { ...store, [list]: next }
  persist()
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
