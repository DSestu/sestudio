import { keyDisplay } from '../../harmony'
import { genreColor, genreShort, metaLine, refreshSummary, useAnalysing, useSummary, type Summary } from '../../musicMeta'
import { useTheory } from '../../musicTheory'
import GenreTag from './crates/GenreTag'
import { openKeyCard } from './harmony/keyCardStore'
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

const Dot = ({ color }: { color: string }) => <i className="inline-block size-2 shrink-0 rounded-full align-middle" style={{ background: color }} />

/** The key at the chosen theory level: the mood word after a dot in its colour, or the key name; muted when unsure. */
export function KeyChip({ id, title, s }: { id: string; title: string; s?: Summary }) {
  const theory = useTheory()
  const k = keyDisplay(theory, s)
  if (!k) return null
  const inner = <>{k.color && <Dot color={k.color} />}{k.text}</>
  const cls = `inline-flex items-center gap-1.5 rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none tabular-nums ${(s?.keyConf ?? 0) >= 0.5 ? 'text-base-content/70' : 'text-base-content/35'}`
  // Plain keeps the label a label; the other levels open the key card from it.
  return theory.level === 'plain'
    ? <span className={cls}>{inner}</span>
    : <button onClick={() => openKeyCard(id, title)} aria-label={`Key card of ${title}`} className={cls}>{inner}</button>
}

/** A track's energy as a level, 0..100 on a fixed scale (SPEC-blend): a short amber bar and the number, no name.
 *  `bare` drops the number, for tight rows. Nothing while it has no reading. */
export function EnergyLevel({ value, bare }: { value?: number | null; bare?: boolean }) {
  if (value == null) return null
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span role="img" aria-label={`Energy ${v} of 100`} title={`Energy ${v} of 100`} className="inline-flex items-center gap-1 shrink-0 align-middle">
      <i className="relative block h-1.5 w-8 overflow-hidden rounded-full bg-white/10"><b className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, background: 'oklch(82% .11 75)' }} /></i>
      {!bare && <span className="text-[11px] tabular-nums text-base-content/50">{v}</span>}
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
      {!analysing && <KeyChip id={id} title={title} s={s} />}
      {!analysing && unsure && (
        <button onClick={() => openUnsure(id, title)} aria-label={`Settle the mode of ${title} by ear`} title="Unsure of the mode: listen to both" className="btn btn-ghost btn-xs h-5 min-h-0 px-1.5 text-[11px] text-warning">?</button>
      )}
      {!analysing && <EnergyLevel value={s?.energyScale?.track} />}
      {tempo ? <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(tempo)} bpm</span> : null}
    </span>
  )
}

/** The same on phones, as one muted line to put after the artist: tempo · key · genre. */
export function MetaLine({ id, bpm, title }: { id: string; bpm?: number; title: string }) {
  const s = useSummary(id)
  const analysing = useAnalysing(id)
  const theory = useTheory()
  const k = keyDisplay(theory, s)
  const line = metaLine(s && { ...s, genre: undefined, key: undefined, camelot: undefined, harmony: undefined }, bpm)
  if (analysing) return <span className="sm:hidden text-base-content/40"> · <Analysing /></span>
  return line || k || s?.genre ? (
    <span className="sm:hidden text-base-content/40 tabular-nums">
      {s?.energyScale?.track != null && <> · <EnergyLevel value={s.energyScale.track} bare /></>}
      {line && ` · ${line}`}
      {k && <> · {theory.level === 'plain' ? <>{k.color && <Dot color={k.color} />} {k.text}</> : (
        // Not a button: the row around it is one.
        <span role="button" tabIndex={0} aria-label={`Key card of ${title}`} className="underline decoration-dotted"
          onClick={e => { e.stopPropagation(); openKeyCard(id, title) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); openKeyCard(id, title) } }}>{k.color && <Dot color={k.color} />} {k.text}</span>
      )}</>}
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
