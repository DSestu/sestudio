import ResponsiveModal from '../../ResponsiveModal'
import { useModalBack } from '../../../useModalBack'
import Keyboard from '../harmony/Keyboard'
import { NOTE, parseReading } from '../harmony/scales'
import { openHarmonyBasics } from '../harmony/store'
import { join } from './proximity'
import { isClash, type SetTrack } from './setBuilder'

const read = (t: SetTrack) => {
  const r = t.harmony?.track
  return r ? parseReading(`${r.tonic} ${r.mode}`) : undefined
}

const list = (pcs: number[]) => pcs.map(p => NOTE[p]).join(', ')

function Level({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-base-content/60">
      <span className="w-10">{label}</span>
      <span className="h-1.5 flex-1 rounded-full bg-white/8"><i className="block h-full rounded-full bg-primary" style={{ width: `${value ?? 0}%` }} /></span>
    </div>
  )
}

/** One join opened: what changes in the notes, the mood, the energy, the genre and the tempo, with a way to hear it. */
export default function JoinDialog({ a, b, titleA, titleB, kept, onFix, onClose }: {
  a: SetTrack
  b: SetTrack
  titleA: string
  titleB: string
  kept?: boolean
  /** Offered for a clash. */
  onFix?: () => void
  onClose: () => void
}) {
  useModalBack(true, onClose)
  const j = join(a, b)
  const clash = isClash(j) && !kept
  const [x, y] = [read(a), read(b)]
  const onlyA = x && y ? x.notes.filter(p => !y.notes.includes(p)) : []
  const onlyB = x && y ? y.notes.filter(p => !x.notes.includes(p)) : []
  const [ea, eb] = [a.energyScale?.outro ?? a.energyScale?.track, b.energyScale?.intro ?? b.energyScale?.track]
  return (
    <ResponsiveModal onClose={onClose} boxClassName="flex max-w-xl flex-col gap-4">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-base font-semibold leading-snug">{titleA} <span className="text-base-content/50">→</span> {titleB}</h2>
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-circle">✕</button>
      </div>
      <div>
        <div className={`text-xl font-semibold tracking-tight ${clash ? 'text-warning' : ''}`}>{j.kindLabel ?? 'Key not known yet'}</div>
        {j.shared !== null && (
          <p className="text-sm text-base-content/60">
            {j.shared} of 7 notes shared
            {onlyA.length > 0 && ` · ${list(onlyA)} in ${titleA} becomes ${list(onlyB)}`}
          </p>
        )}
      </div>
      {x && y && (
        <div className="flex flex-col gap-2">
          <Keyboard notes={x.notes} home={x.home} other={y.notes} otherHome={y.home} />
          <p className="text-xs text-base-content/50">Solid: in both. A: only in {titleA}. B: only in {titleB}.</p>
        </div>
      )}
      <dl className="grid gap-3 text-sm">
        {j.mood && (
          <div>
            <dt className="text-xs text-base-content/50">Mood</dt>
            <dd>{x?.word} → {y?.word} <span className="text-base-content/50">({j.mood === 'same' ? 'same brightness' : j.mood})</span> <button onClick={() => { onClose(); openHarmonyBasics(2) }} className="link text-xs">What is a mode?</button></dd>
          </div>
        )}
        {j.energy.step && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-base-content/50">Energy where they overlap</dt>
            <Level label="outro" value={ea} />
            <Level label="intro" value={eb} />
            <dd className="text-xs text-base-content/60">Energy {j.energy.step} across the join</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-base-content/50">Genre and tempo</dt>
          <dd>
            {j.genreChange ? `${a.genre} → ${b.genre}` : a.genre ?? 'Genre not known'}
            {a.bpm && b.bpm ? ` · ${Math.round(a.bpm)} → ${Math.round(b.bpm)} bpm` : ''}
            {j.tempoJump && <span className="ml-2 text-warning">tempo jump</span>}
          </dd>
        </div>
      </dl>
      {clash && (
        <div className="flex flex-wrap gap-2">
          {onFix && <button onClick={() => { onClose(); onFix() }} className="btn btn-primary btn-sm">Fits between</button>}
          <button onClick={() => { onClose(); openHarmonyBasics(1) }} className="btn btn-ghost btn-sm">Why does this clash?</button>
        </div>
      )}
    </ResponsiveModal>
  )
}
