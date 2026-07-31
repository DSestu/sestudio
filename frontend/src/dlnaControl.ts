import { useSyncExternalStore } from 'react'
import { castEnded, clearCastQueue } from './castQueue'

// Control state for an active DLNA cast session. Unlike Chromecast (which has a
// client-side RemotePlayer), DLNA state lives on the renderer, so we poll the
// backend's /cast/dlna/status while a session is active. The session is held
// server-side, so it survives a page reload as long as the server runs.

export interface DlnaState {
  connected: boolean
  title: string
  isPaused: boolean
  position: number
  duration: number
  volume: number
}

const EMPTY: DlnaState = { connected: false, title: '', isPaused: false, position: 0, duration: 0, volume: 1 }
let snapshot: DlnaState = EMPTY
const listeners = new Set<() => void>()

function emit(next: DlnaState) {
  snapshot = next
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: subscribe to the live DLNA session state. */
export function useDlnaState(): DlnaState {
  return useSyncExternalStore(subscribe, () => snapshot)
}

let timer: number | null = null
function startPolling() { if (timer === null) timer = window.setInterval(refreshDlna, 2000) }
function stopPolling() { if (timer !== null) { window.clearInterval(timer); timer = null } }

// Track whether the current media actually started, so a STOPPED state only
// counts as "ended" (autoplay next) after it has been playing — not at startup.
let sawPlaying = false

/** Fetch current status; keeps polling while connected, stops when not. */
export async function refreshDlna(): Promise<void> {
  try {
    const res = await fetch('/api/cast/dlna/status')
    const d = await res.json()
    if (!d.connected) { emit(EMPTY); stopPolling(); return }
    const state: string = typeof d.state === 'string' ? d.state : ''
    emit({
      connected: true,
      title: d.title ?? '',
      isPaused: state.includes('PAUSED'),
      position: Number(d.position) || 0,
      duration: Number(d.duration) || 0,
      volume: typeof d.volume === 'number' ? d.volume : 1,
    })
    startPolling()
    // End-of-media detection for autoplay: the renderer reports STOPPED /
    // NO_MEDIA while our session is still active (user-stop clears the session
    // server-side, so we wouldn't be connected here).
    if (state.includes('PLAYING')) sawPlaying = true
    else if (sawPlaying && (state.includes('STOPPED') || state.includes('NO_MEDIA'))) {
      sawPlaying = false
      castEnded()
    }
  } catch {
    emit(EMPTY)
    stopPolling()
  }
}

async function post(path: string, body?: unknown) {
  try {
    await fetch(`/api/cast/dlna/${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } finally {
    refreshDlna()
  }
}

/** Call after a successful DLNA cast to begin tracking the session. */
export function dlnaStarted() { refreshDlna() }

export const dlnaPause = () => post('pause')
export const dlnaResume = () => post('resume')
export const dlnaSeek = (seconds: number) => post('seek', { seconds })
export const dlnaSetVolume = (level: number) => post('volume', { level })
export const dlnaStop = () => { clearCastQueue(); return post('stop') }

export function dlnaSeekBy(delta: number) {
  const max = snapshot.duration || Number.MAX_SAFE_INTEGER
  return dlnaSeek(Math.max(0, Math.min(snapshot.position + delta, max)))
}
