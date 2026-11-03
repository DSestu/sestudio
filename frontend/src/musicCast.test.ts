import { describe, expect, it } from 'vitest'
import { castingNow, stepVolume } from './musicCast'

const idleCast = { connected: false, mediaUrl: '', deviceName: '', volume: 1, muted: false }
const idleDlna = { connected: false, mediaUrl: '', volume: 1, muted: false }
const STATION = 'http://192.168.1.5:8090/api/music/station'

describe('castingNow', () => {
  it('is null with no session', () => {
    expect(castingNow(idleCast, idleDlna)).toBeNull()
  })
  it('is null while a video is cast', () => {
    const video = { ...idleCast, connected: true, mediaUrl: 'http://x/api/downloaded/hls?path=a' }
    expect(castingNow(video, { ...idleDlna, connected: true, mediaUrl: '/api/downloaded/tv?path=a' })).toBeNull()
  })
  it('reads a Chromecast playing the station, volume as percent', () => {
    const cast = { connected: true, mediaUrl: `${STATION}/hls/live.m3u8`, deviceName: 'Salon', volume: 0.42, muted: true }
    expect(castingNow(cast, idleDlna)).toEqual({ kind: 'chromecast', device: 'Salon', volume: 42, muted: true })
  })
  it('reads a DLNA renderer playing the station, with the name it was sent to', () => {
    const dlna = { connected: true, mediaUrl: '/api/music/station/stream', volume: 0.3, muted: false }
    expect(castingNow(idleCast, dlna, 'LG TV')).toEqual({ kind: 'dlna', device: 'LG TV', volume: 30, muted: false })
    expect(castingNow(idleCast, dlna)?.device).toBe('the TV')
  })
})

describe('stepVolume', () => {
  it('moves by 5 and lands on multiples of 5', () => {
    expect(stepVolume(40, 1)).toBe(45)
    expect(stepVolume(42, 1)).toBe(45)
    expect(stepVolume(42, -1)).toBe(35)
  })
  it('stays within 0 to 100', () => {
    expect(stepVolume(98, 1)).toBe(100)
    expect(stepVolume(100, 1)).toBe(100)
    expect(stepVolume(2, -1)).toBe(0)
    expect(stepVolume(0, -1)).toBe(0)
  })
})
