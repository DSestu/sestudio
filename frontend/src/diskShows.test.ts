import { describe, expect, it } from 'vitest'
import type { DownloadedFile, DownloadedTitle } from './api'
import { episodeCode, episodeHits, groupOnDisk, resumePoint } from './diskShows'
import type { WatchEntry } from './watchState'

const file = (path: string, number: number, size = 100, title = ''): DownloadedFile => ({ path, number, title, lang: 'other', size, mtime: 0 })
const title = (series: string, season: number, folder: string, files: DownloadedFile[], is_film = false): DownloadedTitle => ({
  key: `${series}|S${season}`, folder, series, season, is_film, poster_url: '', page_url: '', source: '',
  langs: ['other'], files, size: files.reduce((n, f) => n + f.size, 0), mtime: 0,
})

// Shaped like the real South Park on disk: two folder spellings, the same
// season in both, an episode stored twice in one of them.
const southPark = [
  title('south-park-la-serie-vf', 14, 'south-park-la-serie-vf', [
    file('south-park-la-serie-vf/South Park - 14x01 - Guérison Sexuelle.ia.mp4', 1),
    file('south-park-la-serie-vf/South Park - 14x01 - Guérison Sexuelle.mp4', 1),
    file('south-park-la-serie-vf/South Park - 14x02 - Scrotie.mp4', 2),
  ]),
  title('south_park', 14, 'south_park', [file('south_park/s14/s14e2.mp4', 2), file('south_park/s14/s14e3.mp4', 3)]),
  title('south_park', 1, 'south_park', [file('south_park/s1/s1e1.mp4', 1)]),
]

// Shaped like the real One Piece: one title per episode, two cuts in one folder.
const onePiece = [
  title('One Piece Kaï - 070 - Mégot - 1080p.VOSTFR.x264 [Sacha]', 0, 'One Piece Kaï/Saga 06', [file('One Piece Kaï/Saga 06/x.mkv', 0)], true),
  title('One Piece Yabai - 042 - Le bon rhum de Binks - 1080p.MULTI.x264 [Livaï]', 0, 'One Piece Kaï/Saga 05 - Thriller Bark', [file('One Piece Kaï/Saga 05/a.mkv', 0)], true),
  title('One Piece Yabai - 001 - Romance Dawn - 1080p.MULTI.x264 [Livaï]', 0, 'One Piece Kaï/Saga 01', [file('One Piece Kaï/Saga 01/b.mkv', 0)], true),
  title('One Piece Kaï - 069 - Arrivée - 1080p.VOSTFR.x264 [Sacha]', 0, 'One Piece Kaï/Saga 06', [file('One Piece Kaï/Saga 06/y.mkv', 0)], true),
]

const watch = (series: string, season: number, number: number, watched: boolean, updatedAt = 1) =>
  ({ series, season, number, watched, updatedAt }) as WatchEntry

describe('groupOnDisk', () => {
  it('folds folder spellings and copies of South Park into one show', () => {
    const [show, ...rest] = groupOnDisk(southPark)
    expect(rest).toEqual([])
    expect(show.key).toBe('south park')
    expect(show.name).toBe('South Park')
    expect(show.seasons.map(s => s.label)).toEqual(['Season 1', 'Season 14'])
    const s14 = show.seasons[1]
    expect(s14.episodes.map(e => [e.number, e.copies.length])).toEqual([[1, 2], [2, 2], [3, 1]])
    expect(show.episodes).toBe(4)
    expect(show.files).toBe(6)
  })

  it('makes One Piece one show whose two cuts are its seasons, in episode order', () => {
    const [show, ...rest] = groupOnDisk(onePiece)
    expect(rest).toEqual([])
    expect(show.key).toBe('one piece')
    expect(show.name).toBe('One Piece')
    expect(show.seasons.map(s => [s.label, s.episodes.map(e => e.number)])).toEqual([
      ['Yabai', [1, 42]],
      ['Kaï', [69, 70]],
    ])
  })

  it('keeps different shows apart', () => {
    const shows = groupOnDisk([
      title('Stargate SG-1', 1, 'Stargate SG-1', [file('a', 1)]),
      title('Stargate- Atlantis', 1, 'Stargate- Atlantis', [file('b', 1)]),
      title('Dune', 0, '', [file('Dune.mkv', 0)], true),
    ])
    expect(shows.map(s => [s.key, s.seasons[0].label])).toEqual([
      ['stargate sg 1', 'Season 1'],
      ['stargate atlantis', 'Season 1'],
      ['dune', 'Film'],
    ])
  })
})

describe('resumePoint', () => {
  const [sp] = groupOnDisk(southPark)
  const [op] = groupOnDisk(onePiece)

  it('starts at the first episode with no history', () => {
    const r = resumePoint(sp, [])!
    expect([episodeCode(r.season, r.episode), r.resume]).toEqual(['S01 E01', false])
  })

  it('resumes an unfinished episode, or moves past a finished one', () => {
    let r = resumePoint(sp, [watch('South Park', 14, 2, false)])!
    expect([episodeCode(r.season, r.episode), r.resume]).toEqual(['S14 E02', true])
    r = resumePoint(sp, [watch('South Park', 14, 1, true, 1), watch('South Park', 14, 2, true, 5)])!
    expect(episodeCode(r.season, r.episode)).toBe('S14 E03')
  })

  it('finds a cut episode by its number', () => {
    const r = resumePoint(op, [watch('One Piece', 1, 42, true)])!
    expect(episodeCode(r.season, r.episode)).toBe('Kaï E69')
  })
})

describe('episodeHits', () => {
  // Shaped like the real "myst" search: South Park episodes, a Loki episode, a film.
  const shows = groupOnDisk([
    title('South Park', 3, 'South Park', [file('sp/a', 10, 1, 'Chinpokomon'), file('sp/b', 11, 1, 'Starvin Marvin')]),
    title('South Park', 14, 'South Park', [file('sp/c', 12, 1, 'Mysterion Rises'), file('sp/c2', 12, 1, 'Mysterion Rises.ia')]),
    title('Loki', 1, 'Loki', [file('loki/e5', 5, 1, 'Journey Into Mystery')]),
    title('911 Mysteries', 0, '', [file('911.mkv', 0, 1, '911 Mysteries')], true),
    title('Mystery Men', 0, '', [file('mm.mkv', 0, 1, 'Mystery Men')], true),
  ])

  it('finds episodes by their own title, grouped by show, a copy counted once', () => {
    const hits = episodeHits(shows, 'myst')
    expect(hits.map(g => [g.show.name, g.hits.map(h => episodeCode(h.season, h.episode))])).toEqual([
      ['South Park', ['S14 E12']],
      ['Loki', ['S01 E05']],
      ['911 Mysteries', ['S00 E00']],
      ['Mystery Men', ['S00 E00']],
    ])
    expect(hits[0].hits[0].copy.file.title).toBe('Mysterion Rises')
  })

  it('leaves out the show the search names, and too-short searches', () => {
    expect(episodeHits(shows, 'Mystery Men').map(g => g.show.name)).toEqual([])
    expect(episodeHits(shows, 'my')).toEqual([])
  })
})
