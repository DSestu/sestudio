import { useEffect, useRef } from 'react'
import { getCastHttpPort } from './api'
import { castSetVolume, castStop, castToChromecast, castToggleMute, useCastState, type CastState } from './cast'
import { dlnaSetVolume, dlnaStarted, dlnaStop, dlnaToggleMute, useDlnaState, type DlnaState } from './dlnaControl'
import { dlnaPlay } from './api'
import { claimSound, engine, setSoundOnTv } from './components/music/engine'
import { getQueue, queueActions, serverNow, stationClock } from './musicQueue'
import { isLanHost, isLoopback } from './serverLan'

// Sending the queue to a TV (SPEC-music §7): the server's station mixes it into
// one stream; a Chromecast plays its HLS, a DLNA renderer its MPEG-TS. While it
// plays there the browser is silent, and the TV's own volume is driven from here.

const STATION = '/api/music/station'
const TITLE = 'sestudio music'

export interface TvCasting {
  kind: 'chromecast' | 'dlna'
  device: string
  /** 0..100 */
  volume: number
  muted: boolean
}

/** Whether a cast session is playing the station, and on what. A video cast is not. */
export function castingNow(
  cast: Pick<CastState, 'connected' | 'mediaUrl' | 'deviceName' | 'volume' | 'muted'>,
  dlna: Pick<DlnaState, 'connected' | 'mediaUrl' | 'volume' | 'muted'>,
  dlnaDevice = '',
): TvCasting | null {
  if (dlna.connected && dlna.mediaUrl.includes(STATION)) {
    return { kind: 'dlna', device: dlnaDevice || 'the TV', volume: Math.round(dlna.volume * 100), muted: dlna.muted }
  }
  if (cast.connected && cast.mediaUrl.includes(STATION)) {
    return { kind: 'chromecast', device: cast.deviceName || 'the Chromecast', volume: Math.round(cast.volume * 100), muted: cast.muted }
  }
  return null
}

/** The next volume (percent) one step up or down; steps land on multiples of *step*. */
export function stepVolume(percent: number, direction: 1 | -1, step = 5): number {
  return Math.max(0, Math.min(100, Math.round(percent / step) * step + direction * step))
}

let dlnaDevice = ''

export function useMusicCasting(): TvCasting | null {
  return castingNow(useCastState(), useDlnaState(), dlnaDevice)
}

/** Mount once: the browser goes silent while casting, and the TV page is told of volume changes (from here or the TV's remote). */
export function useMusicCastSync() {
  const casting = useMusicCasting()
  const on = !!casting
  useEffect(() => { setSoundOnTv(on) }, [on])
  const seen = useRef(false)
  useEffect(() => {
    if (!on) { seen.current = false; return }
    // The first reading is what the TV already had: no pill for it.
    if (!seen.current) { seen.current = true; return }
    void fetch(`${STATION}/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: casting.volume / 100, muted: casting.muted }),
    })
  }, [on, casting?.volume, casting?.muted])
}

// --- sending ---------------------------------------------------------------------

/** Start the station and wait for its first picture: the receiver loads the stream once. */
async function startStation(): Promise<void> {
  const res = await fetch(`${STATION}/start`, { method: 'POST' })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `station: ${res.status}`)
  for (let i = 0; i < 90; i++) {
    const s = await (await fetch(`${STATION}/status`)).json()
    if (s.error) throw new Error(s.error)
    if (s.live) return
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('The station did not start drawing.')
}

/** What a Chromecast fetches from: plain HTTP on the LAN address when the page is on one (see OutputSwitcher). */
async function lanBase(): Promise<string> {
  const { port, lanHost } = await getCastHttpPort()
  const host = isLoopback(window.location.hostname) && lanHost ? lanHost : window.location.hostname
  return port !== null && isLanHost(host) ? `http://${host}:${port}` : window.location.origin
}

function subtitle(): string {
  const q = getQueue()
  return q.items[q.current]?.artist ?? ''
}

export async function sendToChromecast(onStep: (text: string) => void = () => {}): Promise<void> {
  const base = await lanBase()
  await castToChromecast(
    `${base}${STATION}/hls/live.m3u8`, 'application/x-mpegurl', TITLE, [], onStep,
    startStation, subtitle(),
  )
  engine.unlock()
}

export async function sendToDlna(udn: string, name: string): Promise<void> {
  await startStation()
  dlnaDevice = name
  await dlnaPlay(udn, `${STATION}/stream`, TITLE, 'ts')
  dlnaStarted()
}

// --- while it plays --------------------------------------------------------------

export function setTvVolume(c: TvCasting, percent: number) {
  const level = Math.max(0, Math.min(100, percent)) / 100
  if (c.muted && percent > 0) toggleTvMute(c)
  return c.kind === 'dlna' ? dlnaSetVolume(level) : castSetVolume(level)
}

export function toggleTvMute(c: TvCasting) {
  return c.kind === 'dlna' ? dlnaToggleMute() : castToggleMute()
}

/** Back to this browser: it takes the queue where the station is, and the TV lets go. */
export async function pullBackFromTv(c: TvCasting): Promise<void> {
  const clock = stationClock()
  const q = getQueue()
  if (clock?.item_id) {
    const position = clock.position + (clock.playing ? Math.max(0, serverNow() - clock.at) : 0)
    if (q.items[q.current]?.item_id === clock.item_id) await queueActions.transport('seek', { position })
    else await queueActions.play(clock.item_id, position)
  }
  claimSound()
  engine.unlock()
  void fetch(`${STATION}/stop`, { method: 'POST' })
  await (c.kind === 'dlna' ? dlnaStop() : castStop())
}
