import { useMemo, useState } from 'react'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import { itemsOf, playlistApi, type PlaylistNode } from '../../../musicPlaylists'
import ResponsiveModal from '../../ResponsiveModal'
import { keyLabel } from '../../../musicMeta'
import { useAnalyses } from '../mix/analysis'
import { GENRES, rankFill, type SetTrack } from './setBuilder'

const field = 'input input-bordered input-sm w-full'
const MAX_POOL = 600

interface Props {
  node: PlaylistNode
  byId: ReadonlyMap<string, MusicTrack>
  /** A track as the set builder sees it (with its analysis). */
  toSet: (id: string, track?: MusicTrack) => SetTrack
  onClose: () => void
}

/** "Fill from library": propose tracks by genre, tempo and length, ordered by how well they follow the part's last track. */
export default function FillDialog({ node, byId, toSet, onClose }: Props) {
  const parts = node.parts ?? []
  const [part, setPart] = useState(parts[parts.length - 1]?.id ?? '')
  const [genres, setGenres] = useState<string[]>([])
  const [bpmMin, setBpmMin] = useState('')
  const [bpmMax, setBpmMax] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const lo = bpmMin ? Number(bpmMin) : undefined
  const hi = bpmMax ? Number(bpmMax) : undefined
  const inSet = useMemo(() => new Set(itemsOf(node).map(i => i.track_id)), [node])
  // Only tracks with a known tempo and in range can match, so only those are analysed.
  const candidates = useMemo(
    () => [...byId.values()].filter(t => t.bpm && !inSet.has(t.id) && (lo === undefined || t.bpm >= lo) && (hi === undefined || t.bpm <= hi)).slice(0, MAX_POOL),
    [byId, inSet, lo, hi],
  )
  const [tick] = useAnalyses(candidates.map(t => t.id))

  const bucket = part ? parts.find(p => p.id === part)?.items ?? [] : itemsOf(node)
  const lastItem = bucket[bucket.length - 1]
  const proposal = useMemo(
    () => rankFill(
      candidates.map(t => toSet(t.id, t)),
      { genres, bpmMin: lo, bpmMax: hi, length: (Number(minutes) || 0) * 60, after: lastItem && toSet(lastItem.track_id, byId.get(lastItem.track_id)) },
      inSet,
    ),
    [candidates, genres, lo, hi, minutes, lastItem, tick, inSet], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const chosen = proposal.filter(t => !off.has(t.id))

  const add = () => {
    setBusy(true)
    playlistApi.add(node.id, chosen.map(t => ({ library: byId.get(t.id)!.library, track_id: t.id })), part || undefined)
      .then(onClose, e => { setBusy(false); window.alert((e as Error).message) })
  }
  const toggle = (g: string) => setGenres(s => (s.includes(g) ? s.filter(x => x !== g) : [...s, g]))

  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-w-lg">
      <h3 className="mb-3 font-semibold">Fill from library</h3>
      <div className="flex flex-col gap-3">
        {parts.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">Add to
            <select className="select select-bordered select-sm w-full" value={part} onChange={e => setPart(e.target.value)}>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Genre">
          {GENRES.map(g => (
            <button key={g} onClick={() => toggle(g)} aria-pressed={genres.includes(g)} className={`btn btn-xs rounded-full ${genres.includes(g) ? 'btn-primary' : 'btn-ghost border-white/15'}`}>{g}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs">BPM from<input className={field} inputMode="numeric" value={bpmMin} onChange={e => setBpmMin(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">to<input className={field} inputMode="numeric" value={bpmMax} onChange={e => setBpmMax(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">Minutes<input className={field} inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {proposal.map(t => {
            const m = byId.get(t.id)!
            return (
              <li key={t.id}>
                <label className="flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-white/5">
                  <input type="checkbox" className="checkbox checkbox-xs" checked={!off.has(t.id)} onChange={() => setOff(s => { const n = new Set(s); if (!n.delete(t.id)) n.add(t.id); return n })} />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.title} <span className="text-base-content/50">{m.artist}</span></span>
                  <span className="text-[11px] tabular-nums text-base-content/50">{keyLabel(t.key, t.camelot) ?? ''} {Math.round(t.bpm!)}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-base-content/60">{formatDuration(t.duration)}</span>
                </label>
              </li>
            )
          })}
          {!proposal.length && <li className="px-2 py-6 text-center text-sm text-base-content/60">No analysed track fits yet. Widen the tempo range or pick other genres.</li>}
        </ul>
        <div className="modal-action mt-0">
          <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
          <button onClick={add} disabled={!chosen.length || busy} className="btn btn-primary btn-sm">
            Add {chosen.length} {chosen.length === 1 ? 'track' : 'tracks'} · {formatDuration(chosen.reduce((s, t) => s + t.duration, 0))}
          </button>
        </div>
      </div>
    </ResponsiveModal>
  )
}
