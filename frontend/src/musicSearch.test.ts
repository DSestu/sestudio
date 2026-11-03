import { describe, expect, it } from 'vitest'
import type { MusicTrack } from './musicLibrary'
import { groupResults, hitPayload, type OnlineHit } from './musicSearch'

const hit = (source: string, id: string): OnlineHit => ({
  library: 'online', source, track_id: id, title: id, artist: 'A', duration: 1, kind: 'track', thumb: '', url: '',
})
const track = (id: string) => ({ id, library: 'local' }) as MusicTrack

describe('groupResults', () => {
  it('maps library hits to known tracks and drops the vanished ones', () => {
    const g = groupResults(
      { top: null, errors: {}, online: [], library: [{ library: 'local', track_id: 'a' }, { library: 'local', track_id: 'gone' }] },
      new Map([['a', track('a')]]),
    )
    expect(g.library.map(t => t.id)).toEqual(['a'])
    expect(g.counts.library).toBe(1)
  })

  it('counts per source and removes repeats', () => {
    const g = groupResults(
      { top: null, errors: {}, library: [], online: [hit('youtube', 'yt:1'), hit('youtube', 'yt:1'), hit('soundcloud', 'sc:2'), hit('ytmusic', 'yt:3')] },
      new Map(),
    )
    expect(g.online).toHaveLength(3)
    expect(g.counts).toEqual({ library: 0, youtube: 1, soundcloud: 1, ytmusic: 1 })
  })
})

it('hitPayload keeps what the queue shows', () => {
  expect(hitPayload(hit('soundcloud', 'sc:2'))).toEqual({
    library: 'online', track_id: 'sc:2', source: 'soundcloud', title: 'sc:2', artist: 'A', duration: 1,
  })
})
