import { useEffect, useState, useSyncExternalStore } from 'react'
import type { MusicTrack } from '../../musicLibrary'
import { addPayload, type AddPayload, onQueueEvent, post, positionNow, queueActions, clockSkew, useMusicQueue, type QueueState, useTrackInfo } from '../../musicQueue'
import { BLEND, claimSound, engine, isSoundTab } from './engine'
import { glideToItem, takeBlend } from './scrub'
import { useMusicCastSync } from '../../musicCast'
import { loadAnalyses, RETRY_MS } from './mix/analysis'
import { Presence, settle } from './presence'

// Whether the full-screen player layer is up, and the entry points that start
// playback: they claim the sound for this tab and wake the audio engine
// (browsers allow it only inside a press). They leave the layer as it is, so
// playing from a list keeps you browsing; the player bar opens it.

// The layer grows out of the bar and shrinks back into it (SPEC-music-player-motion): `open` is where it is
// going, `mounted` whether it is in the page (also while it closes or follows a drag from the bar), and
// `covered` whether it has settled open over the bar.
let open = false
let mounted = false
let covered = false
export const presence = new Presence(0)
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
// The mounted layer's frame loop; every change to the presence wakes it.
let kickLayer = () => {}
export const setLayerKick = (f: () => void) => { kickLayer = f }
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
/** The player bar while it shows: where the layer grows from and lands. */
export const playerBar = () => document.querySelector<HTMLElement>('[aria-label="Open the player"]')

/** Opens the layer. A closing layer turns around; a new one starts growing on its first frame (Layer). */
export function openPlayer() {
  if (open) return
  open = true
  if (mounted) presence.go(1, performance.now(), false, reducedMotion())
  mounted = true
  notify()
  kickLayer()
}
export function closePlayer() {
  if (!open) return
  open = false
  covered = false
  presence.go(0, performance.now(), false, reducedMotion())
  notify()
  kickLayer()
}
/** A drag holds the presence; from the bar it puts the layer in the page without opening it yet. */
export function dragPlayer(p: number) {
  presence.hold(p)
  if (!mounted || covered) {
    mounted = true
    covered = false
    notify()
  }
  kickLayer()
}
/** A drag lets go with vertical speed `v` (px/ms, positive is down) after `travel` px: it finishes or springs back. */
export function releasePlayer(v: number, travel?: number) {
  if (!presence.holding()) return
  const now = performance.now()
  open = settle(presence.value(now), v, !open, travel)
  presence.go(open ? 1 : 0, now, true)
  notify()
  kickLayer()
}
/** A touch on the bar puts the layer in the page at once, invisible, so a drag that follows does not wait for the
 *  stage to mount. A tap's click then opens it; with no click and no drag, it leaves again. */
export function primePlayer() {
  if (mounted) return
  dragPlayer(0)
}
export function unprimePlayer() {
  setTimeout(() => { if (!open && presence.holding()) releasePlayer(0, 0) }, 350)
}
/** The layer reports a motion that has come to rest: closed at 0 it leaves the page, open at 1 it covers the bar. */
export function settled(p: number) {
  if (presence.holding()) return
  if (p === 0 && !open && mounted) {
    mounted = false
    notify()
  } else if (p === 1 && open && !covered) {
    covered = true
    notify()
  }
}
/** Closes the player, then runs `f` once the layer's Back entry is gone, so a navigation in `f` is not undone by it. */
export function closeThen(f: () => void) {
  let done = false
  const go = () => {
    if (done) return
    done = true
    window.removeEventListener('popstate', go)
    setTimeout(f)
  }
  window.addEventListener('popstate', go)
  setTimeout(go, 400)
  closePlayer()
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useLayerOpen = () => useSyncExternalStore(subscribe, () => open)
export const useLayerMounted = () => useSyncExternalStore(subscribe, () => mounted)
export const useLayerCovered = () => useSyncExternalStore(subscribe, () => covered)
export const isLayerOpen = () => open

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
