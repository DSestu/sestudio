import { useSyncExternalStore } from 'react'
import type { PlayableEpisode } from './providers'

// Unified playback session: the single source of truth for "what is playing
// right now, where, and at what position". Fed by the in-browser player and
// by both cast controllers; read by the watch-state store (progress capture)
// and — later — by Web↔TV handoff to resume on another target.

export type PlaybackTarget = 'browser' | 'chromecast' | 'dlna'

export interface PlaybackSession {
  episode: PlayableEpisode
  target: PlaybackTarget
  position: number
  duration: number
}

let session: PlaybackSession | null = null
const listeners = new Set<() => void>()

function emit() { listeners.forEach(l => l()) }

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: the live playback session (null when nothing is playing). */
export function usePlaybackSession(): PlaybackSession | null {
  return useSyncExternalStore(subscribe, () => session)
}

export function getPlaybackSession(): PlaybackSession | null {
  return session
}

/** Start (or replace) the session for an episode on a target. */
export function startPlayback(episode: PlayableEpisode, target: PlaybackTarget): void {
  session = { episode, target, position: 0, duration: 0 }
  emit()
}

/** Update the live position/duration; ignored if no session is active. */
export function updatePlayback(position: number, duration: number): void {
  if (!session) return
  session = { ...session, position, duration }
  emit()
}

/** End the session (only if the given target still owns it). */
export function endPlayback(target: PlaybackTarget): void {
  if (session?.target !== target) return
  session = null
  emit()
}
