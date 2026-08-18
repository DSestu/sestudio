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
import { endCastSession, getCastSession } from './playbackSession'
import { saveProgress } from './watchState'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Cast SDK is untyped
type Cast = any

const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

/** A sidecar subtitle to side-load with the media. */
export interface CastTextTrack {
  /** Absolute URL the *receiver* fetches — must be plain HTTP on the LAN. */
  url: string
  lang: string
  label: string
  default?: boolean
}

/** A side-loaded track as the UI sees it, once the receiver has it. */
export interface CastTrackOption {
  id: number
  label: string
  lang: string
}

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
  /** Subtitles sent with the current media; empty when it has none. */
  textTracks: CastTrackOption[]
  /** Which of them is showing, or null for off. */
  activeTextTrackId: number | null
}

const state: CastState = {
  available: false, connected: false, title: '', isPaused: false,
  currentTime: 0, duration: 0, volume: 1, muted: false,
  canSeek: false, canControlVolume: false,
  textTracks: [], activeTextTrackId: null,
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

      // Watch-state: persist progress (throttled) for the casting episode
      // while this cast owns the cast session.
      const session = getCastSession()
      if (session?.target === 'chromecast' && state.connected && state.duration > 0) {
        const now = Date.now()
        if (now - lastProgressSave >= 5000) {
          lastProgressSave = now
          saveProgress(session.episode, state.currentTime, state.duration)
        }
      }

      // Autoplay-next: fire once the media reaches IDLE after having played.
      const ps = player.playerState  // 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE'
      if (ps === 'PLAYING') sawPlaying = true
      else if (sawPlaying && ps === 'IDLE' && player.isConnected) {
        sawPlaying = false
        castEnded()
      }
      if (!state.connected) endCastSession('chromecast')
    },
  )
}

let sawPlaying = false
let lastProgressSave = 0

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
/**
 * Build the receiver's Track objects for our sidecar subtitles.
 *
 * Ids are assigned here (1-based) rather than taken from the source: the Cast
 * API keys `activeTrackIds` and every later edit on them, so they only have to
 * be stable within one load.
 */
function buildTextTracks(w: Cast, subs: CastTextTrack[]): Cast[] {
  return subs.map((sub, index) => {
    const track = new w.chrome.cast.media.Track(index + 1, w.chrome.cast.media.TrackType.TEXT)
    track.trackContentId = sub.url
    track.trackContentType = 'text/vtt'
    track.subtype = w.chrome.cast.media.TextTrackType.SUBTITLES
    track.language = sub.lang
    track.name = sub.label
    return track
  })
}

/**
 * Show one of the side-loaded subtitle tracks, or null to turn them off.
 *
 * Applies to the media already playing on the receiver, so it takes effect
 * without reloading and losing position.
 */
export function castSetTextTrack(trackId: number | null): void {
  const w = window as Cast
  const session = w.cast?.framework?.CastContext?.getInstance()?.getCurrentSession()
  const media = session?.getMediaSession?.()
  if (!media) return
  const request = new w.chrome.cast.media.EditTracksInfoRequest(
    trackId === null ? [] : [trackId],
  )
  media.editTracksInfo(
    request,
    () => { state.activeTextTrackId = trackId; emit() },
    // A failed edit leaves the receiver as it was, so the UI must not move.
    () => {},
  )
}

export async function castToChromecast(
  url: string,
  contentType: string,
  title: string,
  subtitles: CastTextTrack[] = [],
): Promise<void> {
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

  const tracks = buildTextTracks(w, subtitles)
  const request = new w.chrome.cast.media.LoadRequest(mediaInfo)
  if (tracks.length) {
    mediaInfo.tracks = tracks
    // Enable whichever the host marked default, else the first — the point of
    // sending them is that they show without hunting through the TV's menus.
    const wanted = subtitles.findIndex(s => s.default)
    request.activeTrackIds = [(wanted === -1 ? 0 : wanted) + 1]
  }
  await session.loadMedia(request)

  state.textTracks = subtitles.map((sub, index) => ({
    id: index + 1,
    label: sub.label,
    lang: sub.lang,
  }))
  state.activeTextTrackId = tracks.length ? (request.activeTrackIds?.[0] ?? null) : null
  emit()
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

/** Nudge the receiver volume by *delta* (e.g. ±0.05), clamped to 0..1. */
export function castVolumeBy(delta: number) {
  if (!player) return
  castSetVolume(Math.max(0, Math.min(1, (player.volumeLevel ?? 0) + delta)))
}

/** Stop playback and end the session (disconnects the receiver). */
export function castStop() {
  clearCastQueue()
  const w = window as Cast
  w.cast?.framework?.CastContext?.getInstance()?.endCurrentSession(true)
}
