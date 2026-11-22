import { describe, expect, it } from 'vitest'
import type { OnlineHit } from '../../../musicSearch'
import { cleanTitle, mergeOnline } from './onlineMerge'

let n = 0
const hit = (source: string, title: string, duration: number, artist = '', kind: OnlineHit['kind'] = 'track'): OnlineHit =>
  ({ library: 'online', source, track_id: `t${n++}`, title, artist, duration, kind, thumb: '', url: '' })

// What the three sites answered for "deadmau5 strobe" (2026-11-22), trimmed.
const HITS = [
  hit('ytmusic', 'Strobe', 0),
  hit('ytmusic', 'Aural Psynapse', 0),
  hit('ytmusic', 'Strobe (Layton Giordani Remix)', 0),
  hit('ytmusic', 'DEADMAU5 said this Bassline is IMPOSSIBLE...', 0),
  hit('youtube', 'deadmau5 - Strobe', 637, '', 'video'),
  hit('youtube', 'deadmau5 "Strobe" Live in Toronto (Official HD)', 809, '', 'video'),
  hit('youtube', 'Strobe (Club Edit)', 382, '', 'video'),
  hit('youtube', 'deadmau5 - Strobe 1 HOUR', 3801, '', 'video'),
  hit('soundcloud', 'Strobe (Club Edit)', 30, 'deadmau5'),
  hit('soundcloud', 'Strobe (Layton Giordani Remix)', 30, 'deadmau5'),
  hit('soundcloud', 'Strobe', 30, 'deadmau5'),
  hit('soundcloud', 'Deadmau5 Strobe', 636.9, 'user2727940'),
  hit('soundcloud', 'Strobe (Radio Edit)', 30, 'deadmau5'),
]

describe('online merge', () => {
  const m = mergeOnline(HITS, ['deadmau5', 'strobe'])
  it('one row per song, full source first, previews never picked', () => {
    expect(m.songs.map(s => s.title)).toEqual(['Strobe', 'Strobe (Club Edit)', 'Strobe (Layton Giordani Remix)', 'Strobe · Live in Toronto'])
    const strobe = m.songs[0]
    expect(strobe.best.source).toBe('youtube')
    expect(strobe.hits.map(h => h.source)).toEqual(['youtube', 'soundcloud', 'ytmusic', 'soundcloud'])
    expect(strobe.duration).toBe(637)
    expect(m.songs[2].best.source).toBe('ytmusic')
  })
  it('videos only when every source is a video', () => {
    expect(m.songs.map(s => s.video)).toEqual([false, false, false, true])
  })
  it('loops, other songs and preview-only songs fold away', () => {
    expect(m.long.map(h => h.title)).toEqual(['deadmau5 - Strobe 1 HOUR'])
    expect(m.other.map(h => h.title)).toEqual(['Aural Psynapse', 'DEADMAU5 said this Bassline is IMPOSSIBLE...', 'Strobe (Radio Edit)'])
  })
  it('keys rows the same before and after the other sites answer', () => {
    const early = mergeOnline(HITS.filter(h => h.source === 'ytmusic').concat(hit('ytmusic', 'deadmau5 - Strobe (Official Video)', 0)), ['deadmau5', 'strobe'])
    expect(early.songs.map(s => s.key)).toEqual(['strobe', 'strobe layton giordani remix'])
    expect(m.songs[0].key).toBe('strobe')
  })
  it('strips a multi-word artist whole', () => {
    const aphex = mergeOnline([hit('youtube', 'Aphex Twin - Windowlicker (Official Music Video)', 368, '', 'video'), hit('soundcloud', 'Windowlicker', 367, 'Aphex Twin')], ['aphex', 'twin', 'windowlicker'])
    expect(aphex.songs.map(s => [s.title, s.hits.length])).toEqual([['Windowlicker', 2]])
  })
  it('an uploader named like the song does not strip it', () => {
    const t = mergeOnline([hit('youtube', 'Massive Attack - Teardrop (feat. Elizabeth Fraser)', 330, 'Teardrop Fan', 'video'), hit('soundcloud', 'Teardrop', 331, 'Massive Attack')], ['massive', 'attack', 'teardrop'])
    expect(t.songs.map(s => s.title)).toEqual(['Teardrop', 'Teardrop (feat. Elizabeth Fraser)'])
  })
  it('a few titles in "Song - Artist" order do not make the song an artist', () => {
    const a = mergeOnline([
      hit('youtube', 'Massive Attack - Angel (feat. Horace Andy)', 380, '', 'video'),
      hit('youtube', 'Massive Attack - Angel', 379, '', 'video'),
      hit('soundcloud', 'Angel', 380, 'Massive Attack'),
      hit('youtube', 'Angel - Massive Attack (Live 1998)', 263, '', 'video'),
    ], ['massive', 'attack', 'angel'])
    expect(a.songs.map(s => s.title)).toEqual(['Angel', 'Angel (feat. Horace Andy)', 'Angel - Massive Attack (Live 1998)'])
  })
  it('cleans titles', () => {
    expect(cleanTitle('deadmau5 - Strobe (Live at Earls Court / 2010) [4K Official Video]', ['deadmau5'])).toBe('Strobe (Live at Earls Court / 2010)')
    expect(cleanTitle('deadmau5', ['deadmau5'])).toBe('deadmau5')
  })
})
