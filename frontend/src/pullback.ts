import { useSyncExternalStore } from 'react'
import type { PlayableEpisode } from './providers'

// TV → browser handoff ("watch here"): a cast controller requests that the
// app open the in-browser player on a playlist. App renders the PlayerModal;
// the saved watch-state position makes it resume where the TV was.

export interface PullbackRequest {
  episodes: PlayableEpisode[]
  index: number
}

let request: PullbackRequest | null = null
const listeners = new Set<() => void>()

function emit() { listeners.forEach(l => l()) }

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function usePullback(): PullbackRequest | null {
  return useSyncExternalStore(subscribe, () => request)
}

export function requestPullback(r: PullbackRequest): void {
  request = r
  emit()
}

export function clearPullback(): void {
  request = null
  emit()
}
