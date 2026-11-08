import { useState } from 'react'
import { moodOf } from '../../../harmony'
import { EnergyLevel } from '../TrackMeta'
import type { MusicTrack } from '../../../musicLibrary'
import { genreColor, keyLabel, type Summary } from '../../../musicMeta'
import { addToQueue } from '../../../musicQueue'
import Keyboard from '../harmony/Keyboard'
import { parseReading } from '../harmony/scales'

const run = (p: Promise<void>) => { p.catch(() => {}) }

/** A library dot's card on a playlist's map: who it is, its key and energy, and what to do with it. */
export default function DotCard({ track, s, onPlay, onSet, onFits, insert }: {
  track: MusicTrack
  s?: Summary
  onPlay: () => void
  onSet: () => void
  onFits: () => void
  /** Puts the track into the playlist being mapped. */
  insert?: { label: string; onInsert: () => void }
}) {
  const [keys, setKeys] = useState(false)
  const r = s?.harmony?.track
  const read = r && parseReading(`${r.tonic} ${r.mode}`)
  const mood = moodOf(r?.mode)
  const item = 'btn btn-ghost btn-sm h-11 sm:h-8 justify-start'
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white/4 p-4">
      <div className="min-w-0 leading-tight">
        <p className="truncate font-semibold">{track.title}</p>
        <p className="truncate text-sm text-base-content/60">
          {[track.artist, s?.bpm && Math.round(s.bpm)].filter(Boolean).join(' · ')}
          {s?.genre && <> · <span style={{ color: genreColor(s.genre) }}>{s.genre}</span></>}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-base-content/70">
        {mood && <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: mood.color }} aria-hidden="true" />{mood.word}</span>}
        <span>{keyLabel(s?.key, s?.camelot)}</span>
        {s?.energyScale?.track != null && <span className="inline-flex items-center gap-1.5">· <EnergyLevel value={s.energyScale.track} /></span>}
      </p>
      {keys && read && <Keyboard notes={read.notes} home={read.home} listen="Hear it" />}
      <div className="flex flex-col">
        {insert && <button className="btn btn-primary btn-soft btn-sm h-11 sm:h-8 justify-start" onClick={insert.onInsert}>{insert.label}</button>}
        <button className={item} onClick={onPlay}>Play now</button>
        <button className={item} onClick={() => run(addToQueue(track))}>Add to queue</button>
        <button className={item} onClick={onFits}>Fits next</button>
        <button className={item} onClick={onSet}>Add to a playlist…</button>
        {read && <button className={item} aria-pressed={keys} onClick={() => setKeys(k => !k)}>Key card</button>}
      </div>
    </div>
  )
}
