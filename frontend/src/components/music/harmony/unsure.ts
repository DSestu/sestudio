import { useSyncExternalStore } from 'react'

// The track whose unsure mode is being settled by ear: any row calls openUnsure(),
// the one <UnsureMode /> mounted in App shows it.

let open: { id: string; title: string } | null = null
const listeners = new Set<() => void>()
const set = (v: typeof open) => { open = v; listeners.forEach(l => l()) }

export const openUnsure = (id: string, title: string) => set({ id, title })
export const closeUnsure = () => set(null)
export const useUnsure = () =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => open)

/** Settle a track's tonic and mode (PUT /api/music/tracks/{id}/mode). */
export async function saveMode(id: string, tonic: string, mode: string) {
  const res = await fetch(`/api/music/tracks/${encodeURIComponent(id)}/mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tonic, mode }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `HTTP ${res.status}`)
}
