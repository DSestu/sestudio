import { useSyncExternalStore } from 'react'
import type { PlayableEpisode } from './providers'

// Two INDEPENDENT playback slots, because a cast can run on the TV while the
// browser plays a *different* episode locally (issue #19). The in-browser
// player owns the `browser` slot; the cast controllers own the `cast` slot.
// Keeping them separate means neither clobbers the other's "what's playing"
// state — the single-session model could only ever track one at a time.

export type CastTarget = 'chromecast' | 'dlna'

/** Whether two references point at the same playable episode (across targets). */
export function sameEpisode(
  a: PlayableEpisode | undefined | null,
  b: PlayableEpisode | undefined | null,
): boolean {
  return !!a && !!b && a.page_url === b.page_url && a.number === b.number && a.lang === b.lang
}

/** The episode playing in the in-browser player, with its live position. */
export interface BrowserSession {
  episode: PlayableEpisode
  position: number
  duration: number
}

/** The episode currently cast to a TV. Identity only — live transport state
 *  (position/volume/paused) lives in the cast controllers themselves. */
export interface CastSession {
  episode: PlayableEpisode
  target: CastTarget
}

let browser: BrowserSession | null = null
let cast: CastSession | null = null

const browserListeners = new Set<() => void>()
const castListeners = new Set<() => void>()
function emitBrowser() { browserListeners.forEach(l => l()) }
function emitCast() { castListeners.forEach(l => l()) }

// --- Browser (local player) session ---------------------------------------- #

export function useBrowserSession(): BrowserSession | null {
  return useSyncExternalStore(
    cb => { browserListeners.add(cb); return () => browserListeners.delete(cb) },
    () => browser,
  )
}
export function getBrowserSession(): BrowserSession | null { return browser }

export function startBrowserPlayback(episode: PlayableEpisode): void {
  browser = { episode, position: 0, duration: 0 }
  emitBrowser()
}
export function updateBrowserPlayback(position: number, duration: number): void {
  if (!browser) return
  browser = { ...browser, position, duration }
  emitBrowser()
}
export function endBrowserPlayback(): void {
  if (!browser) return
  browser = null
  emitBrowser()
}

// --- Cast (TV) session ------------------------------------------------------ #

export function useCastSession(): CastSession | null {
  return useSyncExternalStore(
    cb => { castListeners.add(cb); return () => castListeners.delete(cb) },
    () => cast,
  )
}
export function getCastSession(): CastSession | null { return cast }

export function startCastSession(episode: PlayableEpisode, target: CastTarget): void {
  cast = { episode, target }
  emitCast()
}
/** Advance the casting episode (autoplay-next) without changing the target. */
export function updateCastEpisode(episode: PlayableEpisode): void {
  if (!cast) return
  cast = { ...cast, episode }
  emitCast()
}
export function endCastSession(target: CastTarget): void {
  if (cast?.target !== target) return
  cast = null
  emitCast()
}
