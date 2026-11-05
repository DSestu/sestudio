import { useMemo, useState } from 'react'
import type { MusicTrack } from '../../../../musicLibrary'
import type { Arc } from '../harmonyApi'
import { GENRES } from '../setBuilder'
import { addChange, MAX_POINTS, MIN_POINTS, removeBlock, resample, setBlockGenre } from './arc'
import ArcEditor from './ArcEditor'
import Apply from './Apply'
import { LENGTHS } from './join'
import Result from './Result'
import Seg from './Seg'
import { useBuilt, usePresets } from './useBuilt'
import { useSummaries } from '../../../../musicMeta'

/** "Draw the arcs": energy, mood and genre over time; the set follows the lines. */
export default function ArcsWay({ byId }: { byId: ReadonlyMap<string, MusicTrack> }) {
  const presets = usePresets()
  const names = Object.keys(presets)
  // A preset sets all three lanes; the first edit makes the arc a custom one.
  const [preset, setPreset] = useState<string>()
  const [drawn, setDrawn] = useState<Arc>()
  const arc = drawn ?? presets[preset ?? names[0]]
  const [picked, setPicked] = useState<number>()
  const [length, setLength] = useState(45)
  const [variant, setVariant] = useState(0)
  const { built, error, busy } = useBuilt(arc ? { arc, length: length * 60, seed: variant } : null)
  const ids = useMemo(() => built?.slots.map(s => s.id) ?? [], [built])
  const { get } = useSummaries(ids)
  if (!arc) return <p className="py-6 text-center text-sm text-base-content/60">Loading…</p>

  const points = arc.energy.length
  const resize = (n: number) => setDrawn({ ...arc, energy: resample(arc.energy, n), mood: resample(arc.mood, n) })
  const genre = (g: Arc['genre']) => { setDrawn({ ...arc, genre: g }); setPicked(undefined) }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Shape">
        {names.map(n => {
          const on = !drawn && n === (preset ?? names[0])
          return <button key={n} onClick={() => { setDrawn(undefined); setPreset(n); setPicked(undefined) }} aria-pressed={on} className={`btn btn-xs rounded-full ${on ? 'btn-primary' : 'btn-ghost border-white/15'}`}>{n}</button>
        })}
        <button aria-pressed={!!drawn} disabled={!drawn} className={`btn btn-xs rounded-full ${drawn ? 'btn-primary' : 'btn-ghost border-white/15'}`}>Custom</button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Seg label="Length" options={LENGTHS.map(n => [n, `${n} min`])} value={length} onPick={setLength} />
        <button onClick={() => genre(addChange(arc.genre))} className="btn btn-xs btn-ghost border-white/15">+ Genre change</button>
        <span className="flex items-center gap-1 text-xs text-base-content/60">Points
          <button onClick={() => resize(points - 1)} disabled={points <= MIN_POINTS} aria-label="Fewer points" className="btn btn-xs btn-ghost btn-square">−</button>
          <button onClick={() => resize(points + 1)} disabled={points >= MAX_POINTS} aria-label="More points" className="btn btn-xs btn-ghost btn-square">+</button>
        </span>
      </div>
      <p className="text-xs text-base-content/60">Drag the dots. Drag a bar to move a genre change, click a genre block to change it.</p>
      <ArcEditor arc={arc} picked={picked} onPick={k => setPicked(p => (p === k ? undefined : k))} onChange={setDrawn} span={length * 60} blocks={ids.map(id => { const s = get(id); return { duration: byId.get(id)?.duration ?? 0, energy: s?.energyScale?.track, mood: s?.harmony?.track?.brightness ?? undefined, genre: s?.genre } })} />
      {picked !== undefined && arc.genre[picked] && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Genre of the block">
          {GENRES.map(g => (
            <button key={g} onClick={() => genre(setBlockGenre(arc.genre, picked, g))} aria-pressed={arc.genre[picked].g === g} className={`btn btn-xs rounded-full ${arc.genre[picked].g === g ? 'btn-primary' : 'btn-ghost border-white/15'}`}>{g}</button>
          ))}
          {arc.genre.length > 1 && <button onClick={() => genre(removeBlock(arc.genre, picked))} className="btn btn-xs btn-ghost text-error">Remove block</button>}
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {busy && !built && <p className="py-6 text-center text-sm text-base-content/60">Building…</p>}
      {built && (
        <div className={busy ? 'opacity-60' : ''}>
          <Result slots={built.slots} byId={byId} stats={{ duration: built.duration, clashes: built.clashes, tempoJumps: built.tempoJumps }}>
            <Apply ids={built.slots.map(s => s.id)} byId={byId} onAnother={() => setVariant(v => v + 1)} />
          </Result>
        </div>
      )}
    </div>
  )
}
