import { useEffect, useState, useSyncExternalStore } from 'react'
import { onQueueEvent, positionNow, queueActions, clockSkew, useMusicQueue, type QueueState, useTrackInfo } from '../../musicQueue'
import { BLEND, claimSound, engine, isSoundTab } from './engine'

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

function start(action: () => Promise<void>) {
  claimSound()
  engine.unlock()
  openPlayer()
  void action()
}

/** Play tracks now: `replace` makes them the queue (a folder), else the first is inserted and played. */
export const playTracks = (ids: string[], replace = true) => start(() => queueActions.playTracks(ids, replace))
/** Play a row of the queue. */
export const playItem = (itemId: string) => start(() => queueActions.play(itemId))
/** Play / pause from the transport or the bar. */
export function togglePlay(playing: boolean, position: number) {
  if (playing) void queueActions.transport('pause', { position })
  else start(() => queueActions.transport('play', { position }))
}

/** Keeps the sound following the queue. Mount once, while the lab is on. */
export function useMusicHost() {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  useEffect(() => {
    engine.onAdvance = () => void queueActions.transport('next')
    // A next/prev (its event says whether it keeps playing) blends over 3 s, anything else .6 s.
    return onQueueEvent(ev => { engine.blend = ev.op === 'go' && 'playing' in ev ? BLEND.skip : BLEND.glide })
  }, [])
  useEffect(() => {
    engine.follow(q, info)
  })
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
