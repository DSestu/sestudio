import { useState } from 'react'
import type { MusicTrack } from '../../../../musicLibrary'
import { LENGTHS } from './join'
import Result from './Result'
import Seg from './Seg'
import TrackPicker from './TrackPicker'
import { updateBuild } from './store'
import { useBuilt, usePresets } from './useBuilt'

/** "From a track": the set grows from one track, over a length and a shape. */
export default function SeedWay({ seed, byId }: { seed?: string; byId: ReadonlyMap<string, MusicTrack> }) {
  const presets = usePresets()
  const names = Object.keys(presets)
  const [length, setLength] = useState(45)
  const [shape, setShape] = useState<string>()
  const preset = shape ?? names[0]
  const { built, error, busy } = useBuilt(seed && preset ? { preset, length: length * 60, start: seed } : null)
  const t = seed ? byId.get(seed) : undefined

  if (!t) return <TrackPicker byId={byId} onPick={id => updateBuild({ seed: id })} />
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 truncate text-sm">Start from <b>{t.title}</b> <button onClick={() => updateBuild({ seed: undefined })} className="link link-hover text-xs text-base-content/60">change</button></p>
        <Seg label="Length" options={LENGTHS.map(n => [n, `${n} min`])} value={length} onPick={setLength} />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Shape">
        {names.map(n => (
          <button key={n} onClick={() => setShape(n)} aria-pressed={n === preset} className={`btn btn-xs rounded-full ${n === preset ? 'btn-primary' : 'btn-ghost border-white/15'}`}>{n}</button>
        ))}
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {busy && !built && <p className="py-6 text-center text-sm text-base-content/60">Building…</p>}
      {built && (
        <div className={busy ? 'opacity-60' : ''}>
          <Result slots={built.slots} byId={byId} stats={{ duration: built.duration, clashes: built.clashes, tempoJumps: built.tempoJumps }} />
        </div>
      )}
    </div>
  )
}
