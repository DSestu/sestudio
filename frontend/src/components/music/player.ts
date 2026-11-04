import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MusicTrack } from '../../musicLibrary'
import { addPayload, type AddPayload, onQueueEvent, post, positionNow, queueActions, clockSkew, useMusicQueue, type QueueState, useTrackInfo } from '../../musicQueue'
import { BLEND, claimSound, engine, isSoundTab } from './engine'
import { glideToItem, takeBlend } from './scrub'
import { useMusicCastSync } from '../../musicCast'
import { loadAnalyses, RETRY_MS } from './mix/analysis'

// Whether the full-screen player layer is up, and the entry points that start
// playback: they claim the sound for this tab and wake the audio engine
// (browsers allow it only inside a press). They leave the layer as it is, so
// playing from a list keeps you browsing; the player bar opens it.

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  open = v
  listeners.forEach(l => l())
}

export const openPlayer = () => set(true)
export const closePlayer = () => set(false)
export const useLayerOpen = () => useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l) }, () => open)

// The player bar's memory of this visit. The queue lives on the server, so a
// paused track is still current on every load: the bar keeps a paused track
// only once this visit has played or paused it, and Stop hides it until the next play.
let bar = { heard: false, stopped: false }
const barListeners = new Set<() => void>()
const setBar = (b: typeof bar) => {
  bar = b
  barListeners.forEach(l => l())
}
export const useBarMemory = () => useSyncExternalStore(l => { barListeners.add(l); return () => barListeners.delete(l) }, () => bar)
export function stopFromBar(playing: boolean, position: number) {
  setBar({ heard: false, stopped: true })
  if (playing) void queueActions.transport('pause', { position })
}

export function startPlayback(action: () => Promise<void>): Promise<void> {
  setBar({ heard: true, stopped: false })
  claimSound()
  engine.unlock()
  return action()
}

/** A track of a list (album, artist, playlist, search): the list replaces the queue and plays from that track. */
export const playFrom = (list: MusicTrack[], t: MusicTrack) =>
  startPlayback(() => post(addPayload(list, 'replace', list.findIndex(x => x.id === t.id))))
/** Streamed tracks (a pasted link): they replace the queue and play from the first. */
export const playPayload = (tracks: AddPayload['tracks']) => startPlayback(() => post({ tracks, replace: true }))
export const playAll = (ts: MusicTrack[]) => startPlayback(() => post(addPayload(ts, 'replace')))
/** A row of the queue: the timeline glides to it and plays it. */
export const playItem = (itemId: string) => startPlayback(async () => { if (!glideToItem(itemId)) await queueActions.play(itemId) })
/** Play / pause from the transport or the bar. */
export function togglePlay(playing: boolean, position: number) {
  if (playing) {
    setBar({ heard: true, stopped: false })
    void queueActions.transport('pause', { position })
  } else void startPlayback(() => queueActions.transport('play', { position }))
}

/** Keeps the sound following the queue. Mount once. */
export function useMusicHost() {
  useMusicCastSync()
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  useEffect(() => {
    // A beat sync enters mid-track, so the server is told where once the queue has moved on.
    engine.onAdvance = sync => void queueActions.transport('next').then(() => { if (sync) engine.resync() })
    engine.onResync = position => void queueActions.transport('seek', { position })
    // A next/prev (its event says whether it keeps playing) blends over 3 s, anything else .6 s.
    return onQueueEvent(ev => { engine.blend = ev.op === 'go' ? ('playing' in ev ? BLEND.skip : takeBlend() ?? BLEND.glide) : BLEND.glide })
  }, [])
  // Playback started anywhere (another device too) brings a stopped bar back.
  useEffect(() => onQueueEvent((_ev, before, after) => { if (after.playing && !before.playing) setBar({ heard: true, stopped: false }) }), [])
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

/** The TV page's sound, for its light only: it follows the station and never moves the queue. Mount once. */
export function useTvSound() {
  const q = useMusicQueue()
  const info = useTrackInfo(q)
  useEffect(() => { engine.unlock() }, [])
  useEffect(() => {
    engine.follow(q, info)
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
