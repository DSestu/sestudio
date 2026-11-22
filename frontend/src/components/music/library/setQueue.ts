import type { PlaylistItem } from '../../../musicPlaylists'
import { post, queueActions, type QueueItem } from '../../../musicQueue'

/** A playing playlist was edited: everything after the playing track becomes its new order after that track. */
export async function followPlaylist(items: PlaylistItem[]) {
  const q = await (await fetch('/api/music/queue')).json() as { items: QueueItem[]; current: number }
  const playing = q.items[q.current]
  const at = playing ? items.findIndex(i => i.track_id === playing.track_id) : -1
  if (at < 0) return
  for (const i of q.items.slice(q.current + 1)) await queueActions.remove(i.item_id)
  const rest = items.slice(at + 1)
  if (rest.length) await post({ tracks: rest.map(i => ({ library: i.library, track_id: i.track_id, source: i.source, title: i.title, artist: i.artist, duration: i.duration })) })
}
