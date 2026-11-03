import { describe, expect, it } from 'vitest'
import { albumsOfTracks } from './musicLibrary'
import { libraryAudioUrl, stateLine, toMusicTrack, type LibraryStatus } from './musicLibraries'
import { addPayload } from './musicQueue'

const lib = (over: Partial<LibraryStatus>): LibraryStatus => ({
  id: 'f1', kind: 'local_folder', label: 'NAS', state: 'online', since: null, error: '', count: 40, indexed: 40, indexing: false, ...over,
})

describe('library state line', () => {
  it('says indexing progress, offline since, needs sign-in, or the kind', () => {
    expect(stateLine(lib({ indexing: true, indexed: 12 }))).toBe('indexing 12/40')
    expect(stateLine(lib({ state: 'needs_signin', kind: 'ytmusic_account' }))).toBe('needs sign-in')
    expect(stateLine(lib({ state: 'offline', since: new Date(2026, 10, 3, 14, 5).getTime() / 1000 }), 'en-GB')).toBe('offline since 14:05')
    expect(stateLine(lib({ state: 'offline' }))).toBe('offline')
    expect(stateLine(lib({}))).toBe('folder')
  })
})

describe('tracks of other libraries', () => {
  const server = (id: string, library: string, crate: string, folder: string) => ({
    id, library, crate, library_label: 'NAS', source: 'file', title: id, artist: '', album: '', duration: 60, folder, name: folder,
  })

  it('group into one album per library and folder, and keep a missing artist unknown', () => {
    const tracks = [server('a', 'f1', 'f1', 'X'), server('b', 'f1', 'f1', 'X'), server('c', 'f2', 'f2', 'X')].map(toMusicTrack)
    expect(albumsOfTracks(tracks).map(a => a.tracks.map(t => t.id))).toEqual([['a', 'b'], ['c']])
    expect(tracks[0].artist).toBe('Unknown artist')
  })

  it('play from their own library route', () => {
    expect(libraryAudioUrl({ library: 'r1', id: 'r1-abc' })).toBe('/api/music/libraries/r1/tracks/r1-abc/audio')
  })

  it('queue as a streamed item when they are online likes, else as a bare reference', () => {
    const like = toMusicTrack({ ...server('yt:x', 'online', 'y1', 'y1'), source: 'ytmusic', title: 'Song' })
    const file = toMusicTrack(server('a', 'f1', 'f1', 'X'))
    expect(addPayload([like, file], 'append').tracks).toEqual([
      { library: 'online', track_id: 'yt:x', source: 'ytmusic', title: 'Song', artist: 'Unknown artist', duration: 60 },
      { library: 'f1', track_id: 'a' },
    ])
  })
})
