import { useEffect, useState } from 'react'
import type { TmdbMeta } from './api'
import { enrichTitle } from './api'

// Metadata lookups are shared process-wide: the same title appears in search
// results, the season header and the library rows, and the server caches them
// anyway — this just avoids duplicate in-flight requests.
const cache = new Map<string, TmdbMeta | null>()
const inflight = new Map<string, Promise<TmdbMeta | null>>()

function key(title: string, year: number, isFilm: boolean): string {
  return `${isFilm ? 'movie' : 'tv'}:${title.toLowerCase()}:${year}`
}

// The in-memory map dies with the page, so opening a folder of downloads asked
// the server again for every title on every load — one request each, however
// cheap the server's own cache makes them. Keeping the answers in localStorage
// makes the second visit cost nothing at all.
//
// Bounded on purpose: a full entry carries the synopsis, cast and
// recommendations, so the whole listing would not fit in the ~5 MB a browser
// allows. The most recent MAX_STORED are kept — the titles being browsed now —
// and the rest fall back to a request, which still hits the server's cache.
const STORE_KEY = 'tmdb-cache-v1'
const MAX_STORED = 200
const TTL_MS = 7 * 24 * 60 * 60 * 1000

interface StoredEntry {
  at: number
  meta: TmdbMeta | null
}

/** Off after a write is refused (quota, private mode): memory still works. */
let persisting = true

function hydrate(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return
    const stored: Record<string, StoredEntry> = JSON.parse(raw)
    const fresh = Date.now() - TTL_MS
    for (const [k, entry] of Object.entries(stored)) {
      if (entry && entry.at > fresh) cache.set(k, entry.meta)
    }
  } catch {
    // A corrupt or unreadable store must never keep the app from starting.
    persisting = false
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Write the cache out, coalescing the burst of sets a listing produces. */
function persist(): void {
  if (!persisting || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const keys = [...cache.keys()].slice(-MAX_STORED)
      const at = Date.now()
      const out: Record<string, StoredEntry> = {}
      for (const k of keys) out[k] = { at, meta: cache.get(k) ?? null }
      localStorage.setItem(STORE_KEY, JSON.stringify(out))
    } catch {
      // Out of quota: drop what is there and stay in memory for this session.
      try { localStorage.removeItem(STORE_KEY) } catch { /* nothing to do */ }
      persisting = false
    }
  }, 1000)
}

hydrate()

/**
 * The same lookup the hook uses, for callers that need metadata outside render
 * (result merging). Shares the cache, so an already-enriched title is free.
 */
export function lookupTmdb(
  title: string,
  year: number,
  isFilm: boolean,
): Promise<TmdbMeta | null> {
  return lookup(title, year, isFilm)
}

function lookup(title: string, year: number, isFilm: boolean): Promise<TmdbMeta | null> {
  const k = key(title, year, isFilm)
  if (cache.has(k)) return Promise.resolve(cache.get(k) ?? null)
  const existing = inflight.get(k)
  if (existing) return existing
  const p = enrichTitle(title, year, isFilm)
    .catch(() => null)
    .then(meta => {
      cache.set(k, meta)
      inflight.delete(k)
      persist()
      return meta
    })
  inflight.set(k, p)
  return p
}

/**
 * Metadata for a title, fetched lazily. Returns null until it resolves and
 * stays null when TMDB is disabled or has no match, so callers can simply
 * fall back to the source's own poster/title.
 */
export function useTmdb(
  title: string | null,
  year = 0,
  isFilm = false,
  enabled = true,
): TmdbMeta | null {
  const [meta, setMeta] = useState<TmdbMeta | null>(
    () => (title && enabled ? cache.get(key(title, year, isFilm)) ?? null : null),
  )

  useEffect(() => {
    if (!title || !enabled) return
    let cancelled = false
    lookup(title, year, isFilm).then(m => { if (!cancelled) setMeta(m) })
    return () => { cancelled = true }
  }, [title, year, isFilm, enabled])

  // Disabled or no title: report nothing without touching state in an effect.
  if (!title || !enabled) return null
  return meta
}
