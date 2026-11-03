import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MusicTrack } from '../../musicLibrary'
import { addPayload, type AddPayload, onQueueEvent, post, positionNow, queueActions, clockSkew, useMusicQueue, type QueueState, useTrackInfo } from '../../musicQueue'
import { BLEND, claimSound, engine, isSoundTab } from './engine'
import { loadAnalyses, RETRY_MS } from './mix/analysis'

// Whether the full-screen player layer is up, and the entry points that start
// playback: they claim the sound for this tab, wake the audio engine (browsers
// allow it only inside a press) and open the layer.

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  open = v
  listeners.forEach(l => l())
}

export const openPlayer = () => set(true)
export const closePlayer = () => set(false)
export const useLayerOpen = () => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => open)

export function startPlayback(action: () => Promise<void>): Promise<void> {
  claimSound()
  engine.unlock()
  openPlayer()
  return action()
}

/** The library views' buttons: the track (or the whole list, replacing the queue) plays now and the layer opens. */
export const playNow = (t: MusicTrack) => startPlayback(() => post(addPayload([t], 'play_now')))
/** Streamed tracks (a pasted link): they replace the queue and play from the first. */
export const playPayload = (tracks: AddPayload['tracks']) => startPlayback(() => post({ tracks, replace: true }))
export const playAll = (ts: MusicTrack[]) => startPlayback(() => post(addPayload(ts, 'replace')))
/** Play a row of the queue. */
export const playItem = (itemId: string) => startPlayback(() => queueActions.play(itemId))
/** Play / pause from the transport or the bar. */
export function togglePlay(playing: boolean, position: number) {
  if (playing) void queueActions.transport('pause', { position })
  else void startPlayback(() => queueActions.transport('play', { position }))
}

/** Keeps the sound following the queue. Mount once. */
export function useMusicHost() {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  useEffect(() => {
    // A beat sync enters mid-track, so the server is told where once the queue has moved on.
    engine.onAdvance = sync => void queueActions.transport('next').then(() => { if (sync) engine.resync() })
    engine.onResync = position => void queueActions.transport('seek', { position })
    // A next/prev (its event says whether it keeps playing) blends over 3 s, anything else .6 s.
    return onQueueEvent(ev => { engine.blend = ev.op === 'go' && 'playing' in ev ? BLEND.skip : BLEND.glide })
  }, [])
  useEffect(() => {
    engine.follow(q, info)
  })
  // The plan for the next handover needs both tracks' tempos.
  const around = q.items.slice(Math.max(0, q.current), q.current + 3).map(i => i.track_id).join(',')
  useEffect(() => {
    const run = () => { void loadAnalyses(around.split(',').filter(Boolean)) }
    run()
    const id = window.setInterval(run, RETRY_MS)
    return () => window.clearInterval(id)
  }, [around])
  useEffect(() => {
    // Another tab took the sound: go quiet.
    const onStorage = () => { if (!isSoundTab()) engine.follow(q, info) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  })
}

/** Seconds into the current track, re-read while it plays. */
export function usePosition(q: QueueState, duration: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!q.playing) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [q.playing])
  return positionNow(q, clockSkew(), now, duration || Infinity)
}
