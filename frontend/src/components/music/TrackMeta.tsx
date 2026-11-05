import { genreColor, genreShort, keyLabel, metaLine, refreshSummary, useSummary } from '../../musicMeta'
import GenreTag from './crates/GenreTag'

/** A track's analysis on a list row, wide screens: tempo, key chip (muted when unsure), genre tag. */
export default function TrackMeta({ id, bpm }: { id: string; bpm?: number }) {
  const s = useSummary(id)
  const tempo = s?.bpm || bpm
  return (
    <span className="hidden sm:flex items-center gap-2">
      {s?.genre && <GenreTag id={id} genre={s.genre} conf={s.genreConf ?? 1} source={s.genreSource} onChange={() => refreshSummary(id)} />}
      {s?.camelot && (
        <span className={`rounded bg-white/8 px-1.5 py-0.5 text-[11px] leading-none tabular-nums ${(s.keyConf ?? 0) >= 0.5 ? 'text-base-content/70' : 'text-base-content/35'}`}>{keyLabel(s.key, s.camelot)}</span>
      )}
      {tempo ? <span className="text-[11px] text-base-content/40 tabular-nums">{Math.round(tempo)} bpm</span> : null}
    </span>
  )
}

/** The same on phones, as one muted line to put after the artist: tempo · key · genre. */
export function MetaLine({ id, bpm }: { id: string; bpm?: number }) {
  const s = useSummary(id)
  const line = metaLine(s && { ...s, genre: undefined }, bpm)
  return line || s?.genre ? (
    <span className="sm:hidden text-base-content/40 tabular-nums">
      {line && ` · ${line}`}
      {s?.genre && <> · <span className="font-medium" style={{ color: genreColor(s.genre) }}>{genreShort(s.genre)}</span></>}
    </span>
  ) : null
}
