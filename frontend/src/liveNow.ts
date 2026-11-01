// Which followed channels are live, shared by Home's strip and the sidebar's
// Twitch row so the two never disagree and only one of them polls.

import { useEffect, useSyncExternalStore } from 'react'
import type { LiveStream } from './api'
import { fetchLive } from './api'

/** How often to check again while something shows it. */
const REFRESH_MS = 120_000

let live: LiveStream[] = []
let timer: ReturnType<typeof setInterval> | null = null
// Components showing it; the polling stops when the last one goes.
let users = 0
const listeners = new Set<() => void>()

function check(): void {
  fetchLive().then(next => {
    live = next
    listeners.forEach(l => l())
  })
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** The followed channels live now. *follows* (how many are followed) re-checks
 *  when it changes, and skips asking at all when it is 0. */
export function useLive(follows: number): LiveStream[] {
  useEffect(() => {
    if (!follows) return
    check()
    users += 1
    if (!timer) timer = setInterval(check, REFRESH_MS)
    return () => {
      users -= 1
      if (!users && timer) { clearInterval(timer); timer = null }
    }
  }, [follows])
  const value = useSyncExternalStore(subscribe, () => live)
  return follows ? value : []
}
