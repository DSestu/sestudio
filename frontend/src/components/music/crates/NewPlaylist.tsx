import { useState, type ReactNode } from 'react'
import { formatDuration, type MusicTrack } from '../../../musicLibrary'
import { createWithTracks } from '../../../musicPlaylists'
import { toast } from '../toast'
import Apply from './build/Apply'
import ArcsWay from './build/ArcsWay'
import { LENGTHS } from './build/join'
import Seg from './build/Seg'
import TrackPicker from './build/TrackPicker'
import { usePresets } from './build/useBuilt'
import { buildSet } from './harmonyApi'

const icon = (d: string) => <svg className="size-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>

function Way({ title, text, icon, children }: { title: string; text: string; icon: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex gap-3 rounded-2xl border border-white/10 bg-white/3 p-4" aria-label={title}>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-base-content/60">{text}</p>
        </div>
        {children}
      </div>
    </section>
  )
}

/**
 * The draft page of a new playlist. Nothing is saved until it has a track: the
 * first one picked, the tracks of a build or of drawn arcs create it, and the
 * page then opens the real playlist (`onCreated`).
 */
export default function NewPlaylist({ byId, seed, onCreated }: { byId: ReadonlyMap<string, MusicTrack>; seed?: string; onCreated: (id: string) => void }) {
  const [first, setFirst] = useState(seed)
  const [length, setLength] = useState(45)
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const presets = usePresets()
  const preset = Object.keys(presets)[0]
  const start = first ? byId.get(first) : undefined

  /** Create the playlist with these tracks and open it; a failure is shown and thrown. */
  const save = async (ids: string[]) => {
    setError(undefined)
    try {
      const made = await createWithTracks(ids.flatMap(id => byId.get(id) ?? []).map(t => ({ library: t.library, track_id: t.id })))
      toast(`Created ${made.name}`)
      onCreated(made.id)
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
  }
  const job = (ids: () => Promise<string[]>) => {
    setBusy(true)
    ids().then(save).catch((e: Error) => { setError(e.message); setBusy(false) })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">New playlist</h2>
        <p className="text-sm text-base-content/60">Saved once it has a track.</p>
      </div>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <Way title="Start from a track" text="Pick one track and Fits next suggests what follows. Build a playlist from it in one go, or take the track alone and add one at a time." icon={icon('M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z')}>
        {start ? (
          <div className="flex flex-col gap-3">
            <p className="min-w-0 truncate text-sm">
              <b>{start.title}</b> <span className="text-base-content/60">{start.artist} · {formatDuration(start.duration)}</span>{' '}
              <button onClick={() => setFirst(undefined)} disabled={busy} className="link link-hover relative hit text-xs text-base-content/60">change</button>
            </p>
            <Seg label="Length" options={LENGTHS.map(n => [n, `${n} min`])} value={length} onPick={setLength} />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => job(() => buildSet({ preset, length: length * 60, start: start.id }).then(b => b.slots.map(s => s.id)))}
                disabled={busy || !preset} className="btn btn-primary min-h-11"
              >{busy ? 'Building…' : 'Build'}</button>
              <button onClick={() => job(() => Promise.resolve([start.id]))} disabled={busy} className="btn btn-ghost min-h-11">Just this track</button>
            </div>
          </div>
        ) : (
          <TrackPicker byId={byId} label="Pick the first track" onPick={setFirst} />
        )}
      </Way>

      <Way title="Draw the arcs" text="Shape the energy and mood over time and let the playlist fill itself. Edit any track afterwards." icon={icon('M3 17l5-6 4 4 8-10')}>
        {drawing ? (
          <ArcsWay byId={byId} actions={(ids, again) => <Apply ids={ids} byId={byId} onAnother={again} onCreate={save} />} />
        ) : (
          <div><button onClick={() => setDrawing(true)} className="btn min-h-11">Draw the arcs</button></div>
        )}
      </Way>

      <Way title="Add tracks yourself" text="Search your libraries and add tracks one by one. The first one saves the playlist." icon={icon('M12 5v14M5 12h14')}>
        <TrackPicker byId={byId} label="Search a track to add" onPick={id => job(() => Promise.resolve([id]))} />
      </Way>
    </div>
  )
}
