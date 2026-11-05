import { moodOf } from '../../../harmony'
import { itemsOf, type PlaylistNode } from '../../../musicPlaylists'
import type { Row } from './flows'

const Dot = ({ mode }: { mode?: string }) => <i aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: moodOf(mode)?.color ?? 'oklch(75% .02 265 / .4)' }} />

/** Branch mode, desktop: the set so far as a bar of its tracks, ending on the fork the branches start from. */
export function TrunkBar({ name, rows, onChange }: { name: string; rows: Row[]; onChange: () => void }) {
  return (
    <div className="hidden md:flex items-center gap-2 px-4 py-2 border-b border-white/8 text-xs">
      <span className="shrink-0 font-semibold tracking-wide text-base-content/50">SET SO FAR</span>
      <span className="shrink-0 font-medium">{name}</span>
      <ol className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {rows.length === 0 && <li className="text-base-content/50">empty: the branches start from nothing</li>}
        {rows.map((r, i) => (
          <li key={`${r.ref.track_id}:${i}`} className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 h-6 ${i === rows.length - 1 ? 'bg-primary/20 text-primary font-medium' : 'bg-white/6 text-base-content/70'}`}>
            <Dot mode={r.mode} />{r.title}
          </li>
        ))}
      </ol>
      <button onClick={onChange} className="shrink-0 btn btn-ghost btn-xs">Another set</button>
    </div>
  )
}

/** Branch mode, phone: where the branches start, above the flow tabs. */
export function ForkLine({ fork, before, onChange }: { fork?: Row; before: number; onChange: () => void }) {
  return (
    <div className="md:hidden flex items-center gap-2 px-3 pt-2 text-xs text-base-content/60">
      <span className="min-w-0 flex-1 truncate">
        {fork ? <>After <b className="font-semibold text-base-content">{fork.title}</b> · {before} {before === 1 ? 'track' : 'tracks'} before</> : 'Starting from an empty set'}
      </span>
      <button onClick={onChange} className="shrink-0 btn btn-ghost btn-xs">Another set</button>
    </div>
  )
}

/** Branch mode without a set yet: which set to branch from. */
export function SetChooser({ sets, onPick }: { sets: PlaylistNode[]; onPick: (set: PlaylistNode) => void }) {
  return (
    <div className="m-auto w-full max-w-sm p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Branch from which set?</h2>
      <p className="text-xs text-base-content/60">Every branch starts at the last track of the set. Keep the one you like and it joins the set.</p>
      {sets.length === 0 && <p className="text-sm text-base-content/60">You have no playlists yet.</p>}
      <ul className="flex flex-col gap-0.5 max-h-[50dvh] overflow-y-auto">
        {sets.map(s => (
          <li key={s.id}>
            <button onClick={() => onPick(s)} className="w-full flex items-center gap-2 rounded-xl px-3 min-h-11 text-sm text-left hover:bg-white/5">
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs tabular-nums text-base-content/50">{itemsOf(s).length}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
