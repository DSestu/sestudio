import { useState } from 'react'
import type { MusicTrack } from '../../../../musicLibrary'
import { itemsOf, playlistApi, type PlaylistNode } from '../../../../musicPlaylists'
import { toast } from '../../toast'

/**
 * What to do with a built list of tracks: another one, then the buttons of the
 * place it goes: add after / replace an open playlist, or save it as the new
 * playlist. Nothing is overwritten without the button saying so.
 */
export default function Apply({ ids, byId, onAnother, onDone, node, onCreate }: {
  ids: string[]
  byId: ReadonlyMap<string, MusicTrack>
  onAnother?: () => void
  onDone?: () => void
  node?: PlaylistNode
  /** Save the ids as a new playlist (the New playlist page). */
  onCreate?: (ids: string[]) => Promise<unknown>
}) {
  const [busy, setBusy] = useState(false)
  const tracks = ids.flatMap(id => byId.get(id) ?? []).map(t => ({ library: t.library, track_id: t.id }))

  const run = (job: () => Promise<unknown>, done: string) => {
    setBusy(true)
    job().then(() => { onDone?.(); toast(done) }, (e: Error) => { setBusy(false); window.alert(e.message) })
  }
  const after = () => run(() => playlistApi.add(node!.id, tracks), `Added ${tracks.length} tracks after ${node!.name}`)
  // The new tracks go in first, so a failure never leaves the playlist empty.
  const replace = () => run(async () => {
    const old = itemsOf(node!)
    await playlistApi.add(node!.id, tracks)
    for (const i of old) await playlistApi.removeItem(node!.id, i.item_id)
  }, `${node!.name} replaced`)

  return (
    <>
      {onAnother && <button onClick={onAnother} disabled={busy} className="btn btn-ghost btn-sm mr-auto max-sm:min-h-11">Try another</button>}
      {node && <button onClick={after} disabled={busy} className="btn btn-sm max-sm:min-h-11"><span className="sm:hidden">Append</span><span className="max-sm:hidden">Add after the last track</span></button>}
      {node && <button onClick={replace} disabled={busy} className="btn btn-primary btn-sm max-sm:min-h-11"><span className="sm:hidden">Replace</span><span className="max-sm:hidden">Replace the tracks</span></button>}
      {onCreate && <button onClick={() => { setBusy(true); onCreate(ids).catch(() => setBusy(false)) }} disabled={busy || !ids.length} className="btn btn-primary btn-sm min-h-11">Create playlist</button>}
    </>
  )
}
