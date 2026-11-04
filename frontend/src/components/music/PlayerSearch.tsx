import { useMemo, useState } from 'react'
import { useDownloadedLibrary } from '../../downloadedLibrary'
import { useLibraryTracks } from '../../musicLibraries'
import { albumsOf, formatDuration, type MusicTrack } from '../../musicLibrary'
import { LINK_RE, setMusicQuery, useMusicQuery } from '../../musicQuery'
import { addToQueue } from '../../musicQueue'
import { SEARCH_FIELD } from '../../titleSearch'
import { SearchIcon } from '../search/SearchParts'
import MusicSearch from './MusicSearch'
import { closeThen, playFrom } from './player'
import { isPhone } from './timeline/mapping'

const run = (p: Promise<void>) => { p.catch(() => {}) }
const seeAll = () => closeThen(() => { window.location.hash = '#/music' })

function Rows({ tracks }: { tracks: MusicTrack[] }) {
  return (
    <ul>
      {tracks.map(t => (
        <li key={t.id} className="flex items-center gap-1 rounded-xl hover:bg-white/5">
          <button onClick={() => run(playFrom(tracks, t))} className="flex-1 min-w-0 flex items-center gap-3 px-3 h-12 text-left">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{t.title}</span>
              <span className="block truncate text-xs text-base-content/60">{t.artist}</span>
            </span>
            <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(t.duration)}</span>
          </button>
          <button aria-label={`Add ${t.title} to the queue`} onClick={() => run(addToQueue(t))} className="btn btn-ghost btn-circle btn-sm mr-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Results({ query }: { query: string }) {
  const titles = useDownloadedLibrary()
  const others = useLibraryTracks()
  const byId = useMemo(() => new Map([...albumsOf(titles).flatMap(a => a.tracks), ...others].map(t => [t.id, t])), [titles, others])
  return <MusicSearch query={query} byId={byId} renderLibrary={ts => <Rows tracks={ts} />} />
}

/** The expanded player's search: the Music page's field (same text), its results dropped over the stage. */
export default function PlayerSearch({ active, autoFocus = false }: { active: boolean; autoFocus?: boolean }) {
  const query = useMusicQuery()
  const [open, setOpen] = useState(false)
  const q = query.trim()
  return (
    <div className="relative flex-1 min-w-0 md:max-w-[53.75rem]" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <div className={SEARCH_FIELD}>
        <SearchIcon />
        <input
          autoFocus={autoFocus}
          type="search"
          value={query}
          onChange={e => { setMusicQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            // Esc closes the results first, the player only after.
            if (e.key === 'Escape' && open && q) { e.stopPropagation(); setOpen(false) }
            else if (e.key === 'Enter' && q) seeAll()
          }}
          aria-label="Search your libraries"
          placeholder={isPhone(innerWidth) ? 'Search or paste a link' : 'Search your libraries and online, or paste a link'}
          className="grow bg-transparent outline-none text-sm min-w-0"
        />
      </div>
      {open && active && q && (
        <div data-addp tabIndex={-1} style={{ background: 'hsl(205 62% 12% / 0.97)' }} className="absolute inset-x-0 top-full mt-2 z-20 glass rounded-2xl p-2 max-h-[min(60vh,560px)] overflow-y-auto overscroll-contain outline-none">
          {LINK_RE.test(q)
            ? <p className="px-3 py-2 text-sm text-base-content/70">Press Enter to open this link on the Music page.</p>
            : <Results query={q} />}
          <button onClick={seeAll} className="mt-1 w-full h-10 rounded-xl text-sm text-primary hover:bg-white/5">See all results on the Music page ↵</button>
        </div>
      )}
    </div>
  )
}
