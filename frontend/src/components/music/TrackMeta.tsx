import { energySteps, moodOf } from '../../harmony'
import { genreColor, genreShort, keyLabel, metaLine, refreshSummary, useAnalysing, useSummary } from '../../musicMeta'
import GenreTag from './crates/GenreTag'
import { openUnsure } from './harmony/unsure'

/** The spinner and word a row shows while its harmony and energy are being worked out. */
export function Analysing() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-base-content/50" title="Analysing its notes and energy. Harmony actions turn on when it's done.">
      <span className="loading loading-spinner loading-xs" aria-hidden="true" />
      Analysing…
    </span>
  )
}

/** A dot in the colour of the track's mood, named on hover; nothing while it has no mode. */
const MoodDot = ({ mode }: { mode?: string }) => {
  const m = moodOf(mode)
  return m ? <i title={m.word} className="inline-block size-2 shrink-0 rounded-full align-middle" style={{ background: m.color }} /> : null
}

/** Four rising steps, as many lit as the track's energy level; its name on hover. Nothing while it has no level. */
export function EnergyMeter({ level }: { level?: string }) {
  const n = energySteps(level)
  if (!n) return null
  return (
    <span role="img" aria-label={`Energy: ${level}`} title={`Energy: ${level}`} className="inline-flex items-end gap-px h-3 shrink-0 align-middle">
      {[1, 2, 3, 4].map(k => <i key={k} className={`w-[3px] rounded-[1px] ${k <= n ? 'bg-primary' : 'bg-white/15'}`} style={{ height: 3 + k * 2 }} />)}
    </span>
  )
}

/** A track's analysis on a list row, wide screens: tempo, key chip (muted when unsure), genre tag. */
export default function TrackMeta({ id, bpm, title }: { id: string; bpm?: number; title: string }) {
  const s = useSummary(id)
  const analysing = useAnalysing(id)
  const tempo = s?.bpm || bpm
  const unsure = !!s?.harmony?.track?.unsure
  return (
    <span className="hidden sm:flex items-center gap-2">
      {s?.genre && <GenreTag id={id} genre={s.genre} conf={s.genreConf ?? 1} source={s.genreSource} onChange={() => refreshSummary(id)} />}
      {analysing && <Analysing />}
      {!analysing && <MoodDot mode={s?.harmony?.track?.mode} />}
      {!analysing && s?.camelot && (
        <span className={`rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none tabular-nums ${(s.keyConf ?? 0) >= 0.5 ? 'text-base-content/70' : 'text-base-content/35'}`}>{keyLabel(s.key, s.camelot)}</span>
      )}
      {!analysing && unsure && (
        <button onClick={() => openUnsure(id, title)} aria-label={`Settle the mode of ${title} by ear`} title="Unsure of the mode: listen to both" className="btn btn-ghost btn-xs h-5 min-h-0 px-1.5 text-[11px] text-warning">?</button>
      )}
      {!analysing && <EnergyMeter level={s?.energyLevel} />}
      {tempo ? <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(tempo)} bpm</span> : null}
    </span>
  )
}

/** The same on phones, as one muted line to put after the artist: tempo · key · genre. */
export function MetaLine({ id, bpm, title }: { id: string; bpm?: number; title: string }) {
  const s = useSummary(id)
  const analysing = useAnalysing(id)
  const line = metaLine(s && { ...s, genre: undefined }, bpm)
  if (analysing) return <span className="sm:hidden text-base-content/40"> · <Analysing /></span>
  return line || s?.genre ? (
    <span className="sm:hidden text-base-content/40 tabular-nums">
      {s?.harmony?.track?.mode && <> · <MoodDot mode={s.harmony.track.mode} /></>}
      {s?.energyLevel && <> · <EnergyMeter level={s.energyLevel} /></>}
      {line && ` · ${line}`}
      {s?.harmony?.track?.unsure && (
        // Not a button: the row around it is one.
        <span role="button" tabIndex={0} aria-label={`Settle the mode of ${title} by ear`} className="px-1 font-semibold text-warning"
          onClick={e => { e.stopPropagation(); openUnsure(id, title) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openUnsure(id, title) } }}>?</span>
      )}
      {s?.genre && <> · <span className="font-medium" style={{ color: genreColor(s.genre) }}>{genreShort(s.genre)}</span></>}
    </span>
  ) : null
}
