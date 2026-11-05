import { join } from './proximity'
import { isClash, type SetTrack } from './setBuilder'

const chip = (warn: boolean) => `rounded-full px-2 py-0.5 text-[11px] leading-none ${warn ? 'bg-warning/15 text-warning' : 'bg-white/5 text-base-content/60'}`

const name = (t: SetTrack) => {
  const r = t.harmony?.track
  return r ? `${r.tonic} ${r.mode}` : undefined
}

/** How a track joins the next one, as chips: key move, energy step, genre change, tempo jump; a clash gets a Fix button, and + puts a track between. */
export default function JoinLine({ a, b, theory, kept, onOpen, onFix, onInsert }: {
  a: SetTrack
  b: SetTrack
  theory: boolean
  /** The mixer chose to keep this clash: it is no longer flagged. */
  kept?: boolean
  onOpen?: () => void
  onFix?: () => void
  onInsert?: () => void
}) {
  const j = join(a, b)
  const clash = isClash(j) && !kept
  const keys = theory && name(a) && name(b) ? `${name(a)} → ${name(b)} · ` : ''
  return (
    <>
      {j.kindLabel && <button onClick={onOpen} aria-label="Open this join" className={`${chip(clash)} cursor-pointer hover:brightness-125`}>{keys}{j.kindLabel}{isClash(j) && kept ? ' · kept' : ''}{theory && j.shared !== null ? ` · ${j.shared} of 7 notes` : ''}</button>}
      {j.energy.step && <span className={chip(false)}>Energy {j.energy.step}</span>}
      {j.genreChange && <span className={chip(false)}>{a.genre} → {b.genre}</span>}
      {j.tempoJump && <span className={chip(true)}>Tempo {Math.round(a.bpm!)} → {Math.round(b.bpm!)}</span>}
      {clash && onFix && <button onClick={onFix} className="btn btn-warning btn-soft btn-xs h-5 min-h-0 px-2">Fix</button>}
      {onInsert && <button onClick={onInsert} aria-label="Put a track between" className="btn btn-ghost btn-xs h-5 min-h-0 w-5 p-0">+</button>}
    </>
  )
}
