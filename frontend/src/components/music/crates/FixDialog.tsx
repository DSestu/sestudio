import { useEffect, useState, type ReactNode } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import ResponsiveModal from '../../ResponsiveModal'
import { useModalBack } from '../../../useModalBack'
import { fetchBridges } from './harmonyApi'
import type { Join } from './proximity'
import type { Reorder } from './setBuilder'

interface Bridge { id: string; before: Join; after: Join }

const label = (j: Join) => j.kindLabel ?? 'Key not known'

function Option({ title, note, action }: { title: ReactNode; note: ReactNode; action: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2">
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-xs text-base-content/60">{note}</div>
      </div>
      {action}
    </div>
  )
}

const heading = (text: string) => <h3 className="text-xs text-base-content/50">{text}</h3>

/** The ways to settle a join: a bridge track between the two, a swap or a move that cuts clashes, or keeping the tension. Without a clash it only offers bridges, to put a track between. */
export default function FixDialog({ a, b, titleA, titleB, clash, exclude, library, swap, move, onInsert, onReorder, onKeep, onClose }: {
  /** The two tracks' library ids. */
  a: string
  b: string
  titleA: string
  titleB: string
  clash: boolean
  /** Library ids already in the set, never offered as a bridge. */
  exclude: string[]
  library: ReadonlyMap<string, MusicTrack>
  swap?: Reorder & { text: string }
  move?: Reorder & { text: string }
  onInsert: (id: string) => void
  onReorder: (r: Reorder) => void
  onKeep: () => void
  onClose: () => void
}) {
  useModalBack(true, onClose)
  const [bridges, setBridges] = useState<Bridge[]>()
  useEffect(() => {
    let live = true
    fetchBridges(a, b, { exclude, limit: 6 }).then(r => live && setBridges(r.results.filter(x => library.has(x.id)).slice(0, 3)), () => live && setBridges([]))
    return () => { live = false }
  }, [a, b]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = (f: () => void) => () => { onClose(); f() }
  const count = (r: Reorder) => `${r.before} → ${r.after} ${r.after === 1 ? 'clash' : 'clashes'}`
  return (
    <ResponsiveModal onClose={onClose} boxClassName="flex max-w-xl flex-col gap-3">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-base font-semibold leading-snug">{clash ? 'Fix' : 'Between'} {titleA} <span className="text-base-content/50">→</span> {titleB}</h2>
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-circle">✕</button>
      </div>
      {heading('Put a bridge between them')}
      {bridges === undefined && <p className="text-sm text-base-content/60">Looking for bridges…</p>}
      {bridges?.length === 0 && <p className="text-sm text-base-content/60">No single track joins well on both sides.</p>}
      {bridges?.map(x => (
        <Option
          key={x.id}
          title={library.get(x.id)!.title}
          note={`${label(x.before)} · then ${label(x.after)}`}
          action={<button onClick={done(() => onInsert(x.id))} className="btn btn-primary btn-sm">Insert</button>}
        />
      ))}
      {clash && (swap || move) && heading('Or reorder')}
      {clash && swap && <Option title={swap.text} note={count(swap)} action={<button onClick={done(() => onReorder(swap))} className="btn btn-sm">Swap</button>} />}
      {clash && move && <Option title={move.text} note={count(move)} action={<button onClick={done(() => onReorder(move))} className="btn btn-sm">Move</button>} />}
      {clash && heading('Or keep the tension')}
      {clash && <Option title="Keep this join" note="It stops being flagged" action={<button onClick={done(onKeep)} className="btn btn-sm">Keep</button>} />}
    </ResponsiveModal>
  )
}
