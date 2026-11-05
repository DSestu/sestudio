import { useMemo, useState } from 'react'
import { formatDuration, matchTracks, type MusicTrack } from '../../../musicLibrary'
import { metaLine, type Summary } from '../../../musicMeta'

const LIMIT = 200

/** The library to pick from: a search over every track, listed with their tempo, key and genre. */
export default function Picker({ all, get }: { all: MusicTrack[]; get: (id: string) => Summary | undefined }) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => matchTracks(all, query), [all, query])
  return (
    <div className="flex flex-col min-h-0 flex-1 gap-2">
      <div className="px-3 pt-3">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search title or artist"
          aria-label="Search the library"
          className="input input-bordered input-sm w-full"
        />
      </div>
      <p className="px-3 text-xs text-base-content/60">{found.length} tracks</p>
      <ul className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-3">
        {found.slice(0, LIMIT).map(t => (
          <li key={t.id} className="flex items-center gap-2 rounded-xl px-2 min-h-12 py-1 hover:bg-white/5">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{t.title}</span>
              <span className="block truncate text-xs text-base-content/60">{[t.artist, metaLine(get(t.id), t.bpm)].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="text-xs tabular-nums text-base-content/50">{formatDuration(t.duration)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
