import { useSyncExternalStore } from 'react'
import type { DownloadItem } from './api'
import { deviceDownloadUrl, postDownloads, resolveStream } from './api'

// Progress tracking for "download to this device". The browser owns the actual
// byte transfer (and shows it in its own download manager), so what we track
// here is the part the app controls: resolving each source and handing it off.

export type DeviceStatus = 'resolving' | 'saving' | 'failed'

export interface DeviceDownload {
  id: string
  name: string
  status: DeviceStatus
  error?: string
}

let items: DeviceDownload[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  items = [...items]
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: live list of device downloads. */
export function useDeviceDownloads(): DeviceDownload[] {
  return useSyncExternalStore(subscribe, () => items)
}

export function clearDeviceDownloads(): void {
  items = items.filter(i => i.status === 'resolving')
  emit()
}

function update(id: string, patch: Partial<DeviceDownload>) {
  items = items.map(i => (i.id === id ? { ...i, ...patch } : i))
  emit()
}

/** Drop an entry — used when it moves to the server job queue instead. */
function remove(id: string) {
  items = items.filter(i => i.id !== id)
  emit()
}

// What this browser has been handed, kept per device so Home can say what is
// saved here. shortcut: a record of hand-offs, not of the files themselves: a
// copy deleted from the OS downloads folder still counts, and a direct MP4's
// size is unknown (0). Upgrade if the app ever stores copies itself (OPFS).

export interface DeviceCopy {
  name: string
  poster_url: string
  /** Bytes; 0 when unknown. */
  size: number
}

const COPIES_KEY = 'sestudio.deviceCopies'

let copies: DeviceCopy[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(COPIES_KEY) ?? '[]') as DeviceCopy[]
  } catch {
    return []
  }
})()

/** React hook: copies handed to this device, newest first. */
export function useDeviceCopies(): DeviceCopy[] {
  return useSyncExternalStore(subscribe, () => copies)
}

/** Note a file handed to this device; the same name again replaces the old entry. */
export function recordDeviceCopy(copy: DeviceCopy): void {
  copies = [copy, ...copies.filter(c => c.name !== copy.name)]
  try {
    localStorage.setItem(COPIES_KEY, JSON.stringify(copies))
  } catch {
    // ignore
  }
  emit()
}

/** yt-dlp's size ("412.53MiB", "1.2GiB") in bytes; 0 when it can't say. */
export function parseSize(size?: string): number {
  const m = /([\d.]+)\s*([KMGT]?)i?B/i.exec(size ?? '')
  return m ? Number(m[1]) * 1024 ** ' KMGT'.indexOf(m[2].toUpperCase() || ' ') : 0
}

/**
 * Send items to this device. A direct MP4 is relayed straight to the browser
 * (instant, nothing stored server-side). HLS has no single file to relay, so
 * those run as a normal server job — real progress, provider fallback and
 * retries — and the browser collects the finished file (see DownloadQueue).
 *
 * Returns true if any item was queued as a server job.
 */
export async function downloadToDevice(downloads: DownloadItem[]): Promise<boolean> {
  const queued = downloads.map(item => {
    const entry: DeviceDownload = {
      id: `dev-${nextId++}`,
      name: item.episode_name,
      status: 'resolving',
    }
    items = [...items, entry]
    return { item, id: entry.id }
  })
  emit()

  const viaServer: DownloadItem[] = []
  for (const { item, id } of queued) {
    try {
      const src = await resolveStream(item.all_providers, undefined, 'mp4', item.source)
      if (src.kind !== 'mp4') {
        // No direct file to relay — hand it to the server job queue instead.
        viaServer.push({ ...item, to_device: true })
        remove(id)
        continue
      }
      const a = document.createElement('a')
      a.href = deviceDownloadUrl(src.proxy_url, item.episode_name)
      a.download = item.episode_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      recordDeviceCopy({ name: item.episode_name, poster_url: item.poster_url ?? '', size: 0 })
      update(id, { status: 'saving' })
      await new Promise(r => setTimeout(r, 800))
    } catch (err) {
      update(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Could not resolve a source',
      })
    }
  }

  if (viaServer.length) {
    await postDownloads(viaServer)
    return true
  }
  return false
}
