import { useMemo, useState, type ReactNode } from 'react'
import { formatDuration, initials, type MusicTrack } from '../../musicLibrary'
import { post } from '../../musicQueue'
import {
  groupResults, hitPayload, saveHit, SEARCH_SOURCES, sourceLabel, useMusicSearch,
  type LibraryHit, type OnlineHit, type SearchResponse, type SearchSource,
} from '../../musicSearch'
import { playPayload } from './player'

const run = (p: Promise<void>) => { p.catch(() => {}) }
const blur = () => (document.activeElement as HTMLElement | null)?.blur()

/** One online result: press the row to play it, + for the queue or a library. */
export function OnlineRow({ hit }: { hit: OnlineHit }) {
  const [saved, setSaved] = useState<'' | 'saving' | 'saved' | 'error'>('')
  const save = () => {
    blur()
    setSaved('saving')
    saveHit(hit).then(() => setSaved('saved'), () => setSaved('error'))
  }
  return (
    <li className="flex items-center gap-1 rounded-xl hover:bg-white/5">
      <button onClick={() => run(playPayload([hitPayload(hit)]))} className="flex-1 min-w-0 flex items-center gap-3 px-3 h-14 text-left">
        {hit.thumb
          ? <img src={hit.thumb} alt="" loading="lazy" className="w-10 h-10 rounded-lg object-cover shrink-0 bg-white/5" />
          : <span className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{hit.title}</span>
          <span className="block truncate text-xs text-base-content/60">
            {[hit.artist, hit.kind === 'video' ? 'Video · plays as music' : sourceLabel(hit.source)].filter(Boolean).join(' · ')}
          </span>
        </span>
        {saved && <span className="text-[11px] text-base-content/50">{{ saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[saved]}</span>}
        <span className="w-10 text-right text-xs text-base-content/60 tabular-nums">{formatDuration(hit.duration)}</span>
      </button>
      <div className="dropdown dropdown-end">
        <button tabIndex={0} aria-label={`Add ${hit.title}`} className="btn btn-ghost btn-circle btn-sm mr-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
        </button>
        <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 w-52 rounded-xl bg-base-200 p-1 shadow-lg">
          <li><button onClick={() => { blur(); run(post({ tracks: [hitPayload(hit)] })) }}>Add to queue</button></li>
          <li><button onClick={save}>Save to library: This PC</button></li>
        </ul>
      </div>
    </li>
  )
}

const asPayload = (t: OnlineHit | LibraryHit) =>
  t.library === 'online' ? hitPayload(t as OnlineHit) : { library: t.library, track_id: t.track_id }

function TopCard({ top, byId }: { top: NonNullable<SearchResponse['top']>; byId: Map<string, MusicTrack> }) {
  const lib = top.kind === 'track' && top.library !== 'online' ? byId.get(top.track_id) : undefined
  const name = top.kind === 'artist' ? top.name : lib?.title ?? top.title ?? ''
  const sub = top.kind === 'artist'
    ? `${top.tracks.length} tracks in the results`
    : [lib?.artist ?? top.artist, lib ? 'In your library' : top.source && sourceLabel(top.source)].filter(Boolean).join(' · ')
  const thumb = top.thumb
  const play = () => run(playPayload(top.kind === 'artist' ? top.tracks.map(asPayload) : [asPayload(top as LibraryHit)]))
  return (
    <div className="rounded-2xl bg-white/5 p-4 flex items-center gap-4">
      {thumb
        ? <img src={thumb} alt="" className={`w-20 h-20 md:w-24 md:h-24 object-cover shrink-0 ${top.kind === 'artist' ? 'rounded-full' : 'rounded-2xl'}`} />
        : <div aria-hidden="true" className={`grid place-items-center w-20 h-20 md:w-24 md:h-24 shrink-0 bg-linear-to-br from-sky-500 to-indigo-700 text-2xl font-semibold text-white/90 ${top.kind === 'artist' ? 'rounded-full' : 'rounded-2xl'}`}>{initials(name)}</div>}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-base-content/60">Top match · {top.kind}</p>
        <p className="truncate text-xl font-semibold">{name}</p>
        <p className="truncate text-xs text-base-content/60 mb-2">{sub}</p>
        <button onClick={play} className="btn btn-primary btn-sm rounded-full">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          {top.kind === 'artist' ? 'Mix it' : 'Play now'}
        </button>
      </div>
    </div>
  )
}

/** The results view of the Music tab: source chips, top match, then the library and online sections. */
export default function MusicSearch({ query, byId, renderLibrary }: {
  query: string
  byId: Map<string, MusicTrack>
  renderLibrary: (tracks: MusicTrack[]) => ReactNode
}) {
  const [source, setSource] = useState<SearchSource>('all')
  const found = useMusicSearch(query, source)
  const grouped = useMemo(() => found && groupResults(found.res, byId), [found, byId])
  const errors = Object.entries(found?.res.errors ?? {})
  const pending: string[] = found?.pending ?? []
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Search in" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {SEARCH_SOURCES.map(s => (
          <button
            key={s.id}
            aria-pressed={source === s.id}
            onClick={() => setSource(s.id)}
            className={`btn btn-sm rounded-full shrink-0 ${source === s.id ? 'btn-primary' : 'btn-ghost bg-white/5'}`}
          >
            {s.label}
            {grouped && s.id !== 'all' && (pending.includes(s.id)
              ? <span className="loading loading-spinner loading-xs opacity-60" />
              : <span className="opacity-60 tabular-nums">{grouped.counts[s.id] ?? 0}</span>)}
          </button>
        ))}
      </div>
      {!found || !grouped ? (
        <p className="text-sm text-base-content/60 px-1">Searching…</p>
      ) : (
        <>
          {found.res.top && <TopCard top={found.res.top} byId={byId} />}
          {errors.map(([s, why]) => (
            <p key={s} className="text-xs text-base-content/60 px-1">{sourceLabel(s)} did not answer: {why}</p>
          ))}
          {pending.length > 0 && (
            <p className="text-xs text-base-content/60 px-1">Still searching {pending.map(sourceLabel).join(', ')}…</p>
          )}
          {grouped.library.length > 0 && (
            <section>
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">In your libraries</h3>
              {renderLibrary(grouped.library)}
            </section>
          )}
          {grouped.online.length > 0 && (
            <section>
              <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">Online</h3>
              <ul>{grouped.online.map(h => <OnlineRow key={h.track_id} hit={h} />)}</ul>
            </section>
          )}
          {!grouped.library.length && !grouped.online.length && !errors.length && !pending.length && (
            <p className="text-sm text-base-content/60 px-1">Nothing found for “{query.trim()}”.</p>
          )}
        </>
      )}
    </div>
  )
}
