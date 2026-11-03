import type { DownloadedFile, DownloadedTitle } from './api'

// The Music tab's views of the downloaded listing: audio folders are albums,
// and the same tracks regrouped by artist or filtered by a search.

export interface MusicTrack {
  id: string
  /** The queue's library: a folder or server id, or "online" for a streamed track. */
  library: string
  /** The library list it belongs to (differs from `library` for a YouTube Music like). */
  crate?: string
  libraryLabel: string
  source?: string
  /** The album card's name, when the server gives one. */
  albumName?: string
  title: string
  artist: string
  album: string
  duration: number
  bpm?: number
  /** The folder it lives in, the key of its album card. */
  folder: string
}

export interface MusicAlbum {
  folder: string
  name: string
  artist: string
  tracks: MusicTrack[]
}

export interface MusicArtist {
  name: string
  tracks: MusicTrack[]
}

export const UNKNOWN_ARTIST = 'Unknown artist'

function toTrack(f: DownloadedFile, folder: string): MusicTrack {
  return {
    id: f.id ?? f.path,
    library: f.library ?? 'local',
    libraryLabel: f.library_label ?? 'This PC',
    title: f.title,
    artist: f.artist || UNKNOWN_ARTIST,
    album: f.album ?? '',
    duration: f.duration ?? 0,
    bpm: f.bpm,
    folder,
  }
}

/** One album per audio folder, in the listing's order (newest first). */
export function albumsOf(titles: DownloadedTitle[]): MusicAlbum[] {
  const byFolder = new Map<string, MusicAlbum>()
  for (const t of titles) {
    if (t.kind !== 'audio') continue
    const album = byFolder.get(t.folder) ?? { folder: t.folder, name: t.series, artist: '', tracks: [] }
    album.tracks.push(...t.files.filter(f => f.id).map(f => toTrack(f, t.folder)))
    byFolder.set(t.folder, album)
  }
  const out = [...byFolder.values()].filter(a => a.tracks.length)
  for (const a of out) a.artist = topArtist(a.tracks)
  return out
}

/** Albums of tracks that did not come with the downloads listing: one per library and folder. */
export function albumsOfTracks(tracks: MusicTrack[]): MusicAlbum[] {
  const byFolder = new Map<string, MusicAlbum>()
  for (const t of tracks) {
    const key = `${t.crate ?? t.library}|${t.folder}`
    const album = byFolder.get(key) ?? { folder: t.folder, name: t.albumName || t.libraryLabel, artist: '', tracks: [] }
    album.tracks.push(t)
    byFolder.set(key, album)
  }
  const out = [...byFolder.values()]
  for (const a of out) a.artist = topArtist(a.tracks)
  return out
}

/** The artist on most of the tracks; 'Various artists' when none holds a majority. */
function topArtist(tracks: MusicTrack[]): string {
  const counts = new Map<string, number>()
  for (const t of tracks) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1)
  const [name, n] = [...counts].sort((a, b) => b[1] - a[1])[0]
  return n * 2 > tracks.length ? name : 'Various artists'
}

export function artistsOf(tracks: MusicTrack[]): MusicArtist[] {
  const byName = new Map<string, MusicArtist>()
  for (const t of tracks) {
    const a = byName.get(t.artist) ?? { name: t.artist, tracks: [] }
    a.tracks.push(t)
    byName.set(t.artist, a)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Tracks whose title, artist or album contains every word of the query. */
export function matchTracks(tracks: MusicTrack[], query: string): MusicTrack[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return tracks
  return tracks.filter(t => {
    const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

export function formatDuration(seconds: number): string {
  if (!seconds) return ''
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Initials for a generated cover: first letters of the first two words. */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0].toUpperCase()).join('')
}
