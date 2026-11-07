import { useSyncExternalStore } from 'react'
import type { PlayableEpisode } from './providers'
import { getCastQueue } from './castQueue'
import { saveProgress } from './watchState'

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

/** Hand an episode on the TV back to this browser, resuming where the TV is:
 *  "Watch here" in the Now Casting bar, "Bring it back here" on the watch page. */
export function pullBackEpisode(ep: PlayableEpisode, position: number, duration: number, stop: () => unknown): void {
  saveProgress(ep, position, duration)
  requestPullback(getCastQueue() ?? { episodes: [ep], index: 0 })
  void stop()
}
