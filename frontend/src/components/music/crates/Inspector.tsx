import { useMemo } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import type { PlaylistItem } from '../../../musicPlaylists'
import { keyLabel, useSummaries } from '../../../musicMeta'
import { proxOf } from '../../../musicFits'
import { bridges, fitsAfter, joinColor, type Join } from './proximity'

const SHOWN = 14

/** One join as a coloured dot and its name. */
function JoinTag({ j }: { j: Join }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className="inline-block size-2 rounded-full" style={{ background: joinColor(j) }} aria-hidden="true" />
      {j.kindLabel ?? 'Key not known'}
    </span>
  )
}

interface Candidate { id: string; first: Join; then?: Join }

/**
 * The set editor's side panel: what fits at the selected spot. The target is the track at `at`
 * (what fits after it), or with `between` the join from it to the next track (what fits both sides).
 */
export default function Inspector({ items, byId, at, between, onInsert, onUnjoin }: {
  items: PlaylistItem[]
  byId: ReadonlyMap<string, MusicTrack>
  at: number
  between: boolean
  /** Put this library track at the target. */
  onInsert: (track: MusicTrack) => void
  /** Leave the join: target the track itself again. */
  onUnjoin: () => void
}) {
  const library = useMemo(() => [...byId.values()], [byId])
  const { get, v } = useSummaries(useMemo(() => library.map(t => t.id), [library]))
  const prox = (id: string) => { const t = byId.get(id); return t && proxOf(t, get(id)) }
  const a = items[at] && prox(items[at].track_id)
  const b = between && items[at + 1] ? prox(items[at + 1].track_id) : undefined
  const titleOf = (i?: PlaylistItem) => (i && (byId.get(i.track_id)?.title ?? i.title)) ?? 'Track'
  const rows = useMemo((): Candidate[] => {
    if (!a) return []
    const pool = library.map(t => proxOf(t, get(t.id)))
    const taken = items.map(i => i.track_id)
    if (b) return bridges(a, b, pool, SHOWN, taken).map(r => ({ id: r.id, first: r.before, then: r.after }))
    return fitsAfter(a, pool, { harmony: 'safe', tempo: 'any', genre: 'any' }, SHOWN, taken).map(r => ({ id: r.id, first: r.join }))
  }, [a?.id, b?.id, items, library, v]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return <p className="p-4 text-sm text-base-content/60">Add a track to see what fits next.</p>
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-sm leading-snug">
        {b ? <>Fits between <b>{titleOf(items[at])}</b> and <b>{titleOf(items[at + 1])}</b></> : <>Fits after <b>{titleOf(items[at])}</b></>}
        {b
          ? <button onClick={onUnjoin} className="ml-2 text-xs text-primary hover:underline">after the selection instead</button>
          : <span className="text-xs text-base-content/50"> · pick a track, or the + on a join</span>}
      </p>
      {!rows.length && <p className="py-6 text-center text-sm text-base-content/60">{b ? 'Nothing fits both sides.' : 'Nothing in the library fits after it yet.'}</p>}
      <ul className="flex flex-col">
        {rows.map(r => {
          const t = byId.get(r.id)!
          const s = get(r.id)
          return (
            <li key={r.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="block truncate text-xs text-base-content/60">
                  <JoinTag j={r.first} />
                  {r.then ? <> · then <JoinTag j={r.then} /></> : r.first.energy.step && ` · energy ${r.first.energy.step}`}
                  {(r.first.tempoJump || r.then?.tempoJump) && <em className="ml-1 not-italic text-warning">tempo</em>}
                </span>
              </span>
              {s?.camelot && <span className="rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-base-content/70">{keyLabel(s.key, s.camelot)}</span>}
              <button onClick={() => onInsert(t)} aria-label={`Insert ${t.title}`} className="btn btn-ghost btn-circle btn-sm text-primary">
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
