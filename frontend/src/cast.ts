// Google Cast (Chromecast) Web Sender integration.
//
// The Cast framework only initialises in a *secure context* (HTTPS, or
// localhost) — over http://<lan-ip> it silently reports unavailable. When it
// works, the Chromecast fetches the media URL itself, so we hand it an absolute
// URL; Chromecast plays HLS natively (unlike most DLNA TVs).
//
// A RemotePlayer/RemotePlayerController mirrors the receiver's playback state
// (time, volume, paused) so the UI can control an active session — and, thanks
// to ORIGIN_SCOPED auto-join, that session is picked up again after a reload.

import { useSyncExternalStore } from 'react'
import { castEnded, clearCastQueue } from './castQueue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Cast SDK is untyped
type Cast = any

const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

export interface CastState {
  available: boolean   // SDK usable (secure context + framework loaded)
  connected: boolean   // an active receiver session exists
  title: string
  isPaused: boolean
  currentTime: number
  duration: number
  volume: number       // 0..1
  muted: boolean
  canSeek: boolean
  canControlVolume: boolean
}

const state: CastState = {
  available: false, connected: false, title: '', isPaused: false,
  currentTime: 0, duration: 0, volume: 1, muted: false,
  canSeek: false, canControlVolume: false,
}
let snapshot: CastState = { ...state }
const listeners = new Set<() => void>()

function emit() {
  snapshot = { ...state }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: subscribe to the live Cast session state. */
export function useCastState(): CastState {
  return useSyncExternalStore(subscribe, () => snapshot)
}

let player: Cast = null
let controller: Cast = null

function bindRemotePlayer(w: Cast) {
  if (controller) return
  player = new w.cast.framework.RemotePlayer()
  controller = new w.cast.framework.RemotePlayerController(player)
  controller.addEventListener(
    w.cast.framework.RemotePlayerEventType.ANY_CHANGE,
    () => {
      state.connected = !!player.isConnected
      state.title = player.mediaInfo?.metadata?.title ?? ''
      state.isPaused = !!player.isPaused
      state.currentTime = player.currentTime ?? 0
      state.duration = player.duration ?? 0
      state.volume = player.volumeLevel ?? 1
      state.muted = !!player.isMuted
      state.canSeek = !!player.canSeek
      state.canControlVolume = !!player.canControlVolume
      emit()

      // Autoplay-next: fire once the media reaches IDLE after having played.
      const ps = player.playerState  // 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE'
      if (ps === 'PLAYING') sawPlaying = true
      else if (sawPlaying && ps === 'IDLE' && player.isConnected) {
        sawPlaying = false
        castEnded()
      }
    },
  )
}

let sawPlaying = false

let castReady: Promise<boolean> | null = null

/** Load and initialise the Cast SDK once. Resolves false if unavailable. */
export function loadCast(): Promise<boolean> {
  if (castReady) return castReady
  castReady = new Promise<boolean>(resolve => {
    if (!window.isSecureContext) return resolve(false)
    const w = window as Cast
    w.__onGCastApiAvailable = (available: boolean) => {
      if (!available) return resolve(false)
      w.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      })
      // Binding now means an auto-rejoined session (after a page reload) is
      // reflected in state as soon as the framework restores it.
      bindRemotePlayer(w)
      state.available = true
      emit()
      resolve(true)
    }
    const s = document.createElement('script')
    s.src = CAST_SDK
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
  })
  return castReady
}

/** Open the Chromecast device picker and load the media onto the chosen device. */
export async function castToChromecast(url: string, contentType: string, title: string): Promise<void> {
  const ok = await loadCast()
  if (!ok) throw new Error('Chromecast is only available over HTTPS')
  const w = window as Cast
  const context = w.cast.framework.CastContext.getInstance()
  // Reuse an existing session (autoplay-next) instead of reopening the device
  // picker; only prompt when there is no active session yet.
  let session = context.getCurrentSession()
  if (!session) {
    await context.requestSession()
    session = context.getCurrentSession()
  }
  if (!session) throw new Error('No Chromecast session')
  const mediaInfo = new w.chrome.cast.media.MediaInfo(url, contentType)
  mediaInfo.metadata = new w.chrome.cast.media.GenericMediaMetadata()
  mediaInfo.metadata.title = title
  await session.loadMedia(new w.chrome.cast.media.LoadRequest(mediaInfo))
}

// --- Remote controls for the active session ------------------------------- #

export function castPlayPause() { controller?.playOrPause() }
export function castToggleMute() { controller?.muteOrUnmute() }

export function castSeek(seconds: number) {
  if (!player) return
  player.currentTime = seconds
  controller?.seek()
}

/** Seek by *delta* seconds relative to the current position, clamped to the media. */
export function castSeekBy(delta: number) {
  if (!player) return
  const target = Math.max(0, Math.min((player.currentTime ?? 0) + delta, player.duration ?? 0))
  player.currentTime = target
  controller?.seek()
}

export function castSetVolume(level: number) {
  if (!player) return
  player.volumeLevel = level
  controller?.setVolumeLevel()
}

/** Stop playback and end the session (disconnects the receiver). */
export function castStop() {
  clearCastQueue()
  const w = window as Cast
  w.cast?.framework?.CastContext?.getInstance()?.endCurrentSession(true)
}
