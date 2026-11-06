import { createWithTracks } from '../../musicPlaylists'
import type { AddPayload } from '../../musicQueue'
import { toast } from './toast'

/** Any list (a library, an album, search results, a smart list, the queue) as a new playlist named after it, then open it. */
export async function saveAsPlaylist(name: string, tracks: AddPayload['tracks']): Promise<void> {
  if (!tracks.length) return
  try {
    const made = await createWithTracks(tracks, name)
    toast(`Saved ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} as ${made.name}`)
    window.location.hash = `#/music?pl=${encodeURIComponent(made.id)}`
  } catch (e) {
    toast(`Could not save the playlist: ${(e as Error).message}`)
  }
}
