import type { MusicTrack } from './musicLibrary'

// Client for the server queue (routes/music_queue.py). Revisions are optional
// on mutations, so a page that only adds tracks need not follow the feed.

export interface AddPayload {
  tracks: { library: string; track_id: string }[]
  play_now?: boolean
  replace?: boolean
}

export function addPayload(tracks: MusicTrack[], mode: 'play_now' | 'replace' | 'append'): AddPayload {
  return {
    tracks: tracks.map(t => ({ library: t.library, track_id: t.id })),
    ...(mode === 'play_now' && { play_now: true }),
    // The server starts at the first track of a replacement.
    ...(mode === 'replace' && { replace: true }),
  }
}

async function post(payload: AddPayload): Promise<void> {
  const res = await fetch('/api/music/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`queue: ${res.status}`)
}

export const playNow = (t: MusicTrack) => post(addPayload([t], 'play_now'))
export const playAll = (ts: MusicTrack[]) => post(addPayload(ts, 'replace'))
export const addToQueue = (t: MusicTrack) => post(addPayload([t], 'append'))
