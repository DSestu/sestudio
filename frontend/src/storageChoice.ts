import { useSyncExternalStore } from 'react'
import { getStorages, type DownloadedTitle, type NearbyRow, type StorageInfo } from './api'

// Storages (SPEC-storage §8.1): the places files live, and which one the Media
// page is on. The list is held once for the app; the choice is per device, like
// the layout, and starts on the storage that takes downloads.

export const ALL_STORAGES = 'all'
const CHOICE_KEY = 'sestudio.mediaStorage.v1'

let storages: StorageInfo[] = []
let loaded = false
let inflight: Promise<void> | null = null
let choice: string | null = readChoice()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

function readChoice(): string | null {
  try { return localStorage.getItem(CHOICE_KEY) } catch { return null }
}

export function refreshStorages(): Promise<void> {
  if (inflight) return inflight
  inflight = getStorages()
    .then(next => { storages = next; loaded = true; notify() })
    .catch(() => { /* keep what was listed */ })
    .finally(() => { inflight = null })
  return inflight
}

const onFocus = () => { void refreshStorages() }

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1) window.addEventListener('focus', onFocus)
  if (!loaded) void refreshStorages()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('focus', onFocus)
  }
}

/** Every storage, `local` first. */
export function useStorages(): StorageInfo[] {
  return useSyncExternalStore(subscribe, () => storages)
}

/** FTP, SFTP and SMB servers, read in the app (SPEC-storage §9). */
export const NETWORK_KINDS = ['ftp', 'sftp', 'smb']

/** The folders and servers that hold video: what the Media page can be on. */
export function videoStorages(list: StorageInfo[]): StorageInfo[] {
  // Another sestudio holds video too, once its Video is turned on (SPEC-storage §9, X3).
  return list.filter(s => (s.kind === 'folder' || s.kind === 'remote_sestudio' || NETWORK_KINDS.includes(s.kind)) && s.roles.includes('video'))
}

/** Where a storage is, as shown under its name: a path, or `sftp://host/path`. */
export function whereOf(s: Pick<StorageInfo, 'kind' | 'path' | 'url'> & { host?: string; share?: string }): string {
  if (NETWORK_KINDS.includes(s.kind)) {
    const share = s.share ? `/${s.share}` : ''
    return `${s.kind}://${s.host ?? ''}${share}${s.path && s.path !== '/' ? s.path : ''}`
  }
  return s.path ?? s.url ?? ''
}

/** What the Media page shows: one storage's id, or `all`. A choice whose
 *  storage is gone falls back to the download target. */
export function effectiveChoice(list: StorageInfo[], picked: string | null): string {
  const video = videoStorages(list)
  if (picked === ALL_STORAGES) return ALL_STORAGES
  if (picked && video.some(s => s.id === picked)) return picked
  return video.find(s => s.download)?.id ?? video[0]?.id ?? ALL_STORAGES
}

export function useStorageChoice(): string {
  const list = useStorages()
  const picked = useSyncExternalStore(subscribe, () => choice)
  return effectiveChoice(list, picked)
}

export function setStorageChoice(id: string): void {
  choice = id
  try { localStorage.setItem(CHOICE_KEY, id) } catch { /* per-device nicety only */ }
  notify()
}

/**
 * The listing narrowed to one storage: titles with no file there drop out, and
 * the rest keep only their files there, with size and languages to match.
 */
export function onStorage(titles: DownloadedTitle[], id: string): DownloadedTitle[] {
  if (id === ALL_STORAGES) return titles
  const out: DownloadedTitle[] = []
  for (const t of titles) {
    const files = t.files.filter(f => (f.storage ?? 'local') === id)
    if (!files.length) continue
    if (files.length === t.files.length) { out.push(t); continue }
    out.push({
      ...t,
      files,
      storages: [id],
      size: files.reduce((n, f) => n + f.size, 0),
      mtime: Math.max(...files.map(f => f.mtime)),
      langs: [...new Set(files.map(f => f.lang).filter(Boolean))].sort(),
    })
  }
  return out
}

/** How many titles each storage holds, for the switcher. */
export function titleCounts(titles: DownloadedTitle[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of titles) {
    for (const id of t.storages ?? ['local']) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/** "21:04", or "12 Nov, 21:04" when it was not today: when a storage went away. */
export function sinceLabel(since: number | null | undefined, now = new Date()): string {
  if (!since) return ''
  const at = new Date(since * 1000)
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}

/** The storages that are away, by id. */
export function offlineIds(list: StorageInfo[]): Set<string> {
  return new Set(list.filter(s => s.state === 'offline').map(s => s.id))
}

/** Which icon a storage gets: this machine, a network share, or another folder. */
export function storageIcon(s: Pick<StorageInfo, 'id' | 'path'> & { kind?: string; bridge?: boolean }): 'pc' | 'share' | 'folder' | 'phone' {
  if (s.id === 'local') return 'pc'
  if (s.bridge) return 'phone'
  if (s.kind && (NETWORK_KINDS.includes(s.kind) || s.kind === 'remote_sestudio')) return 'share'
  return /^(\\\\|\/\/)/.test(s.path ?? '') ? 'share' : 'folder'
}

/** `smb://nas/films`, `ftp://seedbox`, or a bare address (taken as SMB). */
export function parseAddress(text: string): NearbyRow | null {
  const t = text.trim()
  if (!t) return null
  const m = /^(smb|ftp|sftp):\/\/([^/:\s]+)(?::(\d+))?/i.exec(t)
  if (m) return { name: m[2], kind: m[1].toLowerCase() as NearbyRow['kind'], host: m[2], port: m[3] ? Number(m[3]) : null }
  const bare = t.replace(/^\\\\/, '').split(/[\\/]/)[0]
  return /^[\w.-]+$/.test(bare) ? { name: bare, kind: 'smb', host: bare, port: null } : null
}
