import { useMemo, useState } from 'react'
import type { MusicTrack } from '../../../musicLibrary'
import type { PlaylistItem } from '../../../musicPlaylists'
import { moodOf } from '../../../harmony'
import { keyLabel, useSummaries, type Summary } from '../../../musicMeta'
import { proxOf } from '../../../musicFits'
import Keyboard from '../harmony/Keyboard'
import { MODES, modeNotes, NOTE, parseReading } from '../harmony/scales'
import { bridges, fitsAfter, join, joinColor, type Join, type ProxTrack } from './proximity'

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

const TABS = [['fits', 'Fits next'], ['notes', 'Notes']] as const
type Tab = (typeof TABS)[number][0]

/** The track's notes and mood, the other centres that use the same 7 notes, and how many library tracks share them. */
function Notes({ a, s, pool }: { a: ProxTrack; s?: Summary; pool: ProxTrack[] }) {
  const r = s?.harmony?.track && parseReading(`${s.harmony.track.tonic} ${s.harmony.track.mode}`)
  if (!r) return <p className="py-6 text-center text-sm text-base-content/60">No key known for this track yet.</p>
  const mood = moodOf(r.mode)
  const family = NOTE.flatMap((_, t) => MODES.filter(m => modeNotes(t, m.name).every(n => r.notes.includes(n)) && !(t === r.home && m.name === r.mode.toLowerCase())).map(m => ({ t, m })))
  const count = (n: number) => pool.filter(t => t.id !== a.id && join(a, t).shared === n).length
  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold" style={{ color: mood?.color }}>{r.word} <span className="text-sm font-normal text-base-content/60">{r.tonic} {r.mode}</span></div>
      <Keyboard notes={r.notes} home={r.home} width={260} />
      <div>
        <p className="text-xs text-base-content/50">Same notes, other centres</p>
        <p className="flex flex-wrap gap-1.5 pt-1">
          {family.map(({ t, m }) => <span key={t + m.name} className="rounded-full bg-white/5 px-2 py-0.5 text-xs" style={{ color: moodOf(m.name)?.color }}>{NOTE[t]} {m.name}</span>)}
        </p>
      </div>
      <div>
        <p className="text-xs text-base-content/50">In your library</p>
        <p className="text-sm">{count(7)} tracks share all 7 notes · {count(6)} share 6</p>
      </div>
    </div>
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
  const [tab, setTab] = useState<Tab>('fits')
  const pool = useMemo(() => library.map(t => proxOf(t, get(t.id))), [library, v]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo((): Candidate[] => {
    if (!a) return []
    const taken = items.map(i => i.track_id)
    if (b) return bridges(a, b, pool, SHOWN, taken).map(r => ({ id: r.id, first: r.before, then: r.after }))
    return fitsAfter(a, pool, { harmony: 'safe', tempo: 'any', genre: 'any' }, SHOWN, taken).map(r => ({ id: r.id, first: r.join }))
  }, [a?.id, b?.id, items, pool]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return <p className="p-4 text-sm text-base-content/60">Add a track to see what fits next.</p>
  return (
    <div className="flex flex-col gap-3 p-3">
      <div role="tablist" className="flex gap-1">
        {TABS.map(([k, name]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`btn btn-xs ${tab === k ? 'btn-primary btn-soft' : 'btn-ghost'}`}>{name}</button>)}
      </div>
      {tab === 'notes' ? <Notes a={a} s={get(a.id)} pool={pool} /> : <>
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
      </>}
    </div>
  )
}
