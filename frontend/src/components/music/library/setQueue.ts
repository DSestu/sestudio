import type { MusicTrack } from '../../../musicLibrary'
import type { Summary } from '../../../musicMeta'
import { addPayload, post, queueActions, type QueueItem } from '../../../musicQueue'
import { bestGap } from '../gaps'
import { playAll, startPlayback } from '../player'
import { refreshFlows } from '../../../musicFlows'
import { proxOfId } from '../queueGaps'
import { toast } from '../toast'
import { addToSet } from '../../../musicSet'
import { analyseOnline } from '../edit/onlineAnalysis'

// The set into the queue (SPEC-music-library §2.6 Queue). Neither moves the playing track;
// Undo puts the queue back as it was.

interface Snapshot { items: QueueItem[]; current: number }

async function readQueue(): Promise<Snapshot> {
  const q = await (await fetch('/api/music/queue')).json() as { items: QueueItem[]; current_item?: string | null }
  return { items: q.items, current: q.items.findIndex(i => i.item_id === q.current_item) }
}

const refOf = (i: QueueItem) => ({ library: i.library, track_id: i.track_id, source: i.source, title: i.title, artist: i.artist, duration: i.duration })

/** Remove what an action added, and put back what it removed (at the end, in order). */
async function undoTo(before: Snapshot) {
  const now = await readQueue()
  const had = new Set(before.items.map(i => i.item_id))
  for (const i of now.items) if (!had.has(i.item_id)) await queueActions.remove(i.item_id)
  const left = new Set(now.items.map(i => i.item_id))
  const gone = before.items.filter(i => !left.has(i.item_id))
  if (gone.length) await post({ tracks: gone.map(refOf) })
}

const withUndo = (msg: string, before: Snapshot) =>
  toast(msg, () => void undoTo(before).catch((e: Error) => toast(e.message)))

/** Everything after the playing track becomes the set, in its order; nothing playing: play it. */
export async function playSetNext(tracks: MusicTrack[]) {
  const before = await readQueue()
  if (before.current < 0) {
    await playAll(tracks)
    return
  }
  for (const i of before.items.slice(before.current + 1)) await queueActions.remove(i.item_id)
  await post(addPayload(tracks, 'append'))
  withUndo(`Your set plays after ${before.items[before.current].title ?? 'this track'}`, before)
}

/** Each track goes where it blends best among what is queued after the playing track. */
export async function queueSetBlended(tracks: MusicTrack[], get: (id: string) => Summary | undefined) {
  const before = await readQueue()
  const list = before.items.map(i => proxOfId(i.track_id, get(i.track_id)))
  const from = Math.max(0, before.current)
  for (const t of tracks) {
    const p = proxOfId(t.id, get(t.id))
    const at = list.length ? bestGap(p, list, from, list.length)?.at ?? list.length : 0
    list.splice(at, 0, p)
    await post({ ...addPayload([t], 'append'), index: at })
  }
  withUndo(`${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} slotted into the queue`, before)
}

/** The set as a flow: its shape read from its tracks, played leaning on them (SPEC-music-library §2.6). */
export const playSetAsFlow = (tracks: MusicTrack[], name: string) =>
  startPlayback(async () => {
    const res = await fetch('/api/music/set/flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: tracks.map(t => t.id), name }) })
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `flow: ${res.status}`)
    await refreshFlows()
  })

/** Into the set; an online track starts its analysis on add, so its joins fill in (§2.3). */
export function addTracksToSet(tracks: MusicTrack[], label: string, at?: number, shown?: MusicTrack[]) {
  const landed = addToSet(tracks, label, at, shown)
  for (const t of tracks) if (t.library === 'online' && landed.ids.includes(t.id)) void analyseOnline(t.id)
  return landed
}
