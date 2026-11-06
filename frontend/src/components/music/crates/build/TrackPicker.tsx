import { useMemo, useState } from 'react'
import { formatDuration, matchTracks, type MusicTrack } from '../../../../musicLibrary'

/** Search the library and pick one track; the matches show once something is typed. */
export default function TrackPicker({ byId, label, onPick }: { byId: ReadonlyMap<string, MusicTrack>; label: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const typed = q.trim() !== ''
  const shown = useMemo(() => (typed ? matchTracks([...byId.values()], q).slice(0, 30) : []), [byId, q, typed])
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input type="search" className="input input-bordered h-11 w-full" placeholder={label} value={q} onChange={e => setQ(e.target.value)} aria-label={label} />
      {typed && (
        <ul className="max-h-72 overflow-y-auto">
          {shown.map(t => (
            <li key={t.id}>
              <button onClick={() => onPick(t.id)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-white/5 focus-visible:bg-white/10">
                <span className="min-w-0 flex-1 truncate text-sm">{t.title} <span className="text-base-content/50">{t.artist}</span></span>
                <span className="w-10 text-right text-xs tabular-nums text-base-content/60">{formatDuration(t.duration)}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-6 text-center text-sm text-base-content/60">No track matches.</li>}
        </ul>
      )}
    </div>
  )
}
