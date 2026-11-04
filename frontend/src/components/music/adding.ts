import { getQueue, post, queueActions, type AddPayload, type QueueItem } from '../../musicQueue'
import { sourceLabel } from '../../musicSearch'
import { toast } from './toast'

// Adding to and removing from the queue, each with an Undo (SPEC-music-player §5.5).

export type Ref = AddPayload['tracks'][number]

/** The index right after the playing track ("play next"), or the end when nothing plays. */
export const nextIndex = () => {
  const c = getQueue().current
  return c >= 0 ? c + 1 : undefined
}

/** Queue `refs` at `index` (the end when undefined); Undo removes exactly what this added. */
export async function addTracks(refs: Ref[], index: number | undefined, label: string) {
  const before = new Set(getQueue().items.map(i => i.item_id))
  // A streamed track takes the server a moment to look up: say so at once.
  const online = refs.find(r => r.library === 'online')
  if (online) toast(`Adding from ${online.source ? sourceLabel(online.source) : 'online'}…`)
  try {
    await post({ tracks: refs, ...(index !== undefined && { index }) })
  } catch {
    toast('Could not add to the queue')
    return
  }
  toast(label, () => {
    for (const i of getQueue().items) if (!before.has(i.item_id)) void queueActions.remove(i.item_id)
  })
}

export const refOf = (i: QueueItem): Ref => i.library === 'online'
  ? { library: i.library, track_id: i.track_id, source: i.source, title: i.title, artist: i.artist, duration: i.duration }
  : { library: i.library, track_id: i.track_id }

/** Remove a queue row; Undo puts the track back where it was. */
export function removeItem(item: QueueItem, title: string) {
  const at = getQueue().items.findIndex(i => i.item_id === item.item_id)
  void queueActions.remove(item.item_id)
  toast(`Removed ${title}`, () => { void post({ tracks: [refOf(item)], ...(at >= 0 && { index: at }) }) })
}
