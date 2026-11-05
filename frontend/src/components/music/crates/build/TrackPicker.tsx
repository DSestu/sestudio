import { useMemo, useState } from 'react'
import { formatDuration, matchTracks, type MusicTrack } from '../../../../musicLibrary'

/** Search the library and pick one track. */
export default function TrackPicker({ byId, value, onPick }: { byId: ReadonlyMap<string, MusicTrack>; value?: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => matchTracks([...byId.values()], q).slice(0, 30), [byId, q])
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input className="input input-bordered input-sm w-full" placeholder="Search a track…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search a track" />
      <ul className="min-h-0 flex-1 overflow-y-auto sm:max-h-72">
        {shown.map(t => (
          <li key={t.id}>
            <button onClick={() => onPick(t.id)} aria-pressed={t.id === value} className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-white/5 ${t.id === value ? 'bg-white/10' : ''}`}>
              <span className="min-w-0 flex-1 truncate text-sm">{t.title} <span className="text-base-content/50">{t.artist}</span></span>
              <span className="w-10 text-right text-xs tabular-nums text-base-content/60">{formatDuration(t.duration)}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-3 py-6 text-center text-sm text-base-content/60">No track matches.</li>}
      </ul>
    </div>
  )
}
