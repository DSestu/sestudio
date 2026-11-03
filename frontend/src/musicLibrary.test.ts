import { describe, expect, it } from 'vitest'
import type { DownloadedFile, DownloadedTitle } from './api'
import { albumsOf, artistsOf, matchTracks } from './musicLibrary'
import { addPayload } from './musicQueue'

const file = (id: string, title: string, artist: string): DownloadedFile =>
  ({ path: `${id}.mp3`, number: 0, title, lang: '', size: 1, mtime: 0, id, artist, album: 'A', duration: 60, library: 'local' })

const folder = (name: string, kind: string, files: DownloadedFile[]): DownloadedTitle => ({
  key: name, kind, folder: name, series: name, season: 0, is_film: false,
  poster_url: '', page_url: '', source: '', langs: [], files, size: 1, mtime: 0,
})

const titles = [
  folder('Neuro', 'audio', [file('a', 'One', 'X'), file('b', 'Two', 'X'), file('c', 'Three', 'Y')]),
  folder('Mix', 'audio', [file('d', 'Four', 'P'), file('e', 'Five', 'Q')]),
  folder('Show', 'video', [file('v', 'Ep', '')]),
]

describe('albums', () => {
  const albums = albumsOf(titles)

  it('are one per audio folder and skip video', () => {
    expect(albums.map(a => a.name)).toEqual(['Neuro', 'Mix'])
    expect(albums[0].tracks.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('take the majority artist, else Various artists', () => {
    expect(albums.map(a => a.artist)).toEqual(['X', 'Various artists'])
  })
})

describe('artists', () => {
  it('group tracks by name, sorted', () => {
    const artists = artistsOf(albumsOf(titles).flatMap(a => a.tracks))
    expect(artists.map(a => [a.name, a.tracks.length])).toEqual([['P', 1], ['Q', 1], ['X', 2], ['Y', 1]])
  })
})

describe('search', () => {
  const tracks = albumsOf(titles).flatMap(a => a.tracks)
  it('needs every word in title, artist or album', () => {
    expect(matchTracks(tracks, 'x tw').map(t => t.id)).toEqual(['b'])
    expect(matchTracks(tracks, '  ')).toHaveLength(5)
  })
})

describe('queue payloads', () => {
  const [t] = albumsOf(titles)[0].tracks
  it('play now', () => {
    expect(addPayload([t], 'play_now')).toEqual({ tracks: [{ library: 'local', track_id: 'a' }], play_now: true })
  })
  it('replace for play all', () => {
    expect(addPayload([t], 'replace')).toEqual({ tracks: [{ library: 'local', track_id: 'a' }], replace: true })
  })
  it('append is just the tracks', () => {
    expect(addPayload([t], 'append')).toEqual({ tracks: [{ library: 'local', track_id: 'a' }] })
  })
})
