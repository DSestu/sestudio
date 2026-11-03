import { useMemo } from 'react'
import ResponsiveModal from '../../ResponsiveModal'
import { addPayload } from '../../../musicQueue'
import type { MusicTrack } from '../../../musicLibrary'
import { buildTree, playlistApi, usePlaylists, visibleRows } from '../../../musicPlaylists'

/** Pick the playlist a track goes into (a set gets it at the end of its last part). */
export default function AddToPlaylist({ track, onClose }: { track: MusicTrack; onClose: () => void }) {
  const nodes = usePlaylists()
  const rows = useMemo(() => visibleRows(buildTree(nodes), new Set()).filter(r => r.node.kind !== 'smart'), [nodes])
  const add = (id: string) => {
    playlistApi.add(id, addPayload([track], 'append').tracks).then(onClose, (e: Error) => window.alert(e.message))
  }
  const create = () => {
    const name = window.prompt('New playlist')
    if (name?.trim()) playlistApi.create('playlist', name).then(n => add(n.id), (e: Error) => window.alert(e.message))
  }
  return (
    <ResponsiveModal onClose={onClose}>
      <h3 className="font-semibold mb-1">Add to playlist</h3>
      <p className="truncate text-xs text-base-content/60 mb-3">{track.title}</p>
      <ul className="flex flex-col gap-0.5 max-h-72 overflow-y-auto">
        {rows.map(({ node, depth }) => (
          <li key={node.id} style={{ paddingLeft: depth * 14 }}>
            {node.kind === 'folder' ? (
              <p className="px-3 h-9 flex items-center text-xs text-base-content/50">{node.name}</p>
            ) : (
              <button onClick={() => add(node.id)} className="w-full text-left rounded-xl px-3 h-10 text-sm hover:bg-white/5 truncate">{node.name}</button>
            )}
          </li>
        ))}
      </ul>
      <div className="modal-action">
        <button className="btn btn-ghost btn-sm" onClick={create}>New playlist…</button>
        <button className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
    </ResponsiveModal>
  )
}
