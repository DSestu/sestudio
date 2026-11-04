import { describe, expect, it } from 'vitest'
import type { MusicTrack } from './musicLibrary'
import { groupResults, hitPayload, mergeResults, type OnlineHit } from './musicSearch'

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

describe('mergeResults', () => {
  const res = (online: OnlineHit[]) => ({ res: { top: null, library: [], online, errors: {} } })

  it('shows the sources that answered, interleaved, and names the failed ones', () => {
    const m = mergeResults('a', ['library', 'ytmusic', 'youtube', 'soundcloud'], {
      ytmusic: res([hit('ytmusic', 'm1'), hit('ytmusic', 'm2')]),
      soundcloud: res([hit('soundcloud', 's1')]),
      youtube: { error: 'search: 500' },
    })
    expect(m.online.map(h => h.track_id)).toEqual(['m1', 's1', 'm2'])
    expect(m.errors).toEqual({ youtube: 'search: 500' })
    expect(m.top).toMatchObject({ kind: 'artist', name: 'A' })
  })

  it('puts a library track first as the top match', () => {
    const m = mergeResults('zz', ['library', 'youtube'], {
      library: { res: { top: null, online: [], errors: {}, library: [{ library: 'local', track_id: 'x', artist: 'B' }] } },
      youtube: res([hit('youtube', 'y1')]),
    })
    expect(m.top).toMatchObject({ kind: 'track', track_id: 'x' })
  })
})
