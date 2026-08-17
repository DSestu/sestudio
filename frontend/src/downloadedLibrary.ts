import { useSyncExternalStore } from 'react'
import { getDownloadedLibrary, type DownloadedFile, type DownloadedTitle } from './api'

// What has been downloaded, held once for the whole app: the watch view reads it
// to prefer a local copy, and the library surfaces render it. A shared store
// rather than a per-caller hook, so several consumers cost one request — and so
// a delete can refresh every surface at once.

let titles: DownloadedTitle[] = []
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

const onFocus = () => { void refreshDownloadedLibrary() }

/** Refetch the listing. Concurrent callers share the one request in flight. */
export function refreshDownloadedLibrary(): Promise<void> {
  if (inflight) return inflight
  inflight = getDownloadedLibrary()
    .then(next => {
      titles = next
      loaded = true
      listeners.forEach(l => l())
    })
    .catch(() => {
      // Server down: keep whatever was listed rather than blanking the view.
    })
    .finally(() => { inflight = null })
  return inflight
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Downloads land minutes after they are queued and only the server knows
  // when, so returning to the tab is when it is worth looking again.
  if (listeners.size === 1) window.addEventListener('focus', onFocus)
  if (!loaded) void refreshDownloadedLibrary()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('focus', onFocus)
  }
}

export function useDownloadedLibrary(): DownloadedTitle[] {
  return useSyncExternalStore(subscribe, () => titles)
}

/** The listing outside React — for callbacks that run after a render, such as
 *  the cast queue picking the next episode. */
export function downloadedSnapshot(): DownloadedTitle[] {
  return titles
}

/**
 * The filename a title is stored under: the name with the characters a
 * filesystem rejects folded to dashes. Mirrors `sanitize_path_component`
 * server-side, and is lossy in the same way — ':' and '/' both become '-'.
 */
export function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').trim()
}

/** Bytes as a short human size — these files run to hundreds of MB or a few GB. */
export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

/** The downloaded title matching a series+season, by real or on-disk name. */
export function titleFor(
  all: DownloadedTitle[],
  series: string,
  season: number,
): DownloadedTitle | undefined {
  const folder = sanitizeName(series)
  return all.find(
    t => t.season === season && (t.series === series || t.series === folder),
  )
}

/**
 * The stored file for one episode in one language, if there is one.
 *
 * A film is matched on language alone: it is the only file in its title, and
 * its name carries no episode number to match on.
 */
export function fileFor(
  all: DownloadedTitle[],
  series: string,
  season: number,
  number: number,
  lang: string,
): DownloadedFile | undefined {
  const title = titleFor(all, series, season)
  if (!title) return undefined
  return title.files.find(
    f => f.lang === lang && (title.is_film || f.number === number),
  )
}

/** Languages an episode is stored in, for the playlist's downloaded badges. */
export function langsFor(title: DownloadedTitle | undefined, number: number): string[] {
  if (!title) return []
  return title.files
    .filter(f => (title.is_film || f.number === number) && f.lang)
    .map(f => f.lang)
}
