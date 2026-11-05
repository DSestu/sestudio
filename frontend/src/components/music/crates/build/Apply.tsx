import { useState } from 'react'
import type { MusicTrack } from '../../../../musicLibrary'
import { itemsOf, playlistApi, usePlaylists } from '../../../../musicPlaylists'
import { toast } from '../../toast'
import { flowApi, newFlow, refOf, useFlows } from '../../builder/flows'
import { closeBuildSet, useBuildSet } from './store'

/**
 * What to do with a built set: another one, then add it after the open set, replace
 * it, or start a new playlist. Nothing is overwritten without the button saying so.
 */
export default function Apply({ ids, byId, onAnother }: { ids: string[]; byId: ReadonlyMap<string, MusicTrack>; onAnother?: () => void }) {
  const nodes = usePlaylists()
  const target = useBuildSet()?.node
  const node = nodes.find(n => n.id === target)
  const flowId = useBuildSet()?.flow
  const flow = useFlows().flows.find(f => f.id === flowId)
  const [busy, setBusy] = useState(false)
  const found = ids.flatMap(id => byId.get(id) ?? [])
  const tracks = found.map(t => ({ library: t.library, track_id: t.id }))

  const run = (job: () => Promise<unknown>, done: string) => {
    setBusy(true)
    job().then(() => { closeBuildSet(); toast(done) }, (e: Error) => { setBusy(false); window.alert(e.message) })
  }
  const after = () => run(() => playlistApi.add(node!.id, tracks), `Added ${tracks.length} tracks after ${node!.name}`)
  // The new tracks go in first, so a failure never leaves the set empty.
  const replace = () => run(async () => {
    const old = itemsOf(node!)
    await playlistApi.add(node!.id, tracks)
    for (const i of old) await playlistApi.removeItem(node!.id, i.item_id)
  }, `${node!.name} replaced`)
  const fill = () => run(() => flowApi.patch(flow!.id, { items: found.map(refOf) }), `${flow!.name} filled with ${found.length} tracks`)
  const inNewFlow = () => run(
    () => newFlow('mix', { items: found.map(refOf) }).then(f => { window.location.hash = `#/mixes?f=${f.id}` }),
    'Created a new flow',
  )
  const fresh = () => {
    const name = window.prompt('New playlist', 'Built set')
    if (name?.trim()) run(() => playlistApi.create('playlist', name).then(n => playlistApi.add(n.id, tracks)), `Created ${name.trim()}`)
  }

  return (
    <>
      {onAnother && <button onClick={onAnother} disabled={busy} className="btn btn-ghost btn-sm mr-auto">Try another</button>}
      {node && <button onClick={after} disabled={busy} className="btn btn-sm"><span className="sm:hidden">Append</span><span className="max-sm:hidden">Add after {node.name}</span></button>}
      {node && <button onClick={replace} disabled={busy} className="btn btn-sm"><span className="sm:hidden">Replace</span><span className="max-sm:hidden">Replace {node.name}</span></button>}
      {flow && <button onClick={fill} disabled={busy} className="btn btn-primary btn-sm"><span className="sm:hidden">Fill</span><span className="max-sm:hidden">Fill {flow.name}</span></button>}
      <button onClick={inNewFlow} disabled={busy} className="btn btn-sm">New flow</button>
      <button onClick={fresh} disabled={busy} className={`btn btn-sm ${flow ? '' : 'btn-primary'}`}><span className="sm:hidden">New</span><span className="max-sm:hidden">New playlist</span></button>
    </>
  )
}
